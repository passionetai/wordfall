/* Word Fall — 3D background layer (Three.js r128 from cdnjs).

   A dark cyberpunk city of instanced box buildings with neon window
   strips, scrolling toward the camera, with fog, rain/data streaks and
   UnrealBloomPass glow. The painted skyline sits behind it as a far
   backdrop plane.

   This file only draws pixels. It never reads or changes game rules:
   game.js's Renderer calls WordfallBG3D.frame(dt, view) once per frame
   with a read-only description of what to show.

   If WebGL or the CDN is unavailable, init() resolves false, `ready`
   stays false, and the game keeps its original 2D skyline background. */
(function () {
    'use strict';

    const THREE_URL  = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    const POSTFX_URL = 'vendor/three-postfx-r128.js';
    const SKYLINE_URL = 'assets/img/bg-skyline.png';

    // World layout (units are roughly metres).
    const LEN = 260;           // length of the recycled city corridor
    const NEAR = 12;           // buildings wrap once this far behind camera
    const AVENUE = 13;         // half-width of the clear avenue down the middle
    const FOG_NEAR = 35, FOG_FAR = 230;
    const FOG_COLOR = [0.027, 0.035, 0.078];
    const BASE_SPEED = 16;     // corridor scroll speed (units / second)
    // Window texture tile: 16 columns x 64 floors, 8px per window cell.
    const WIN_COLS = 16, WIN_FLOORS = 64, WIN_PX = 8;
    const WIN_TILE_W = WIN_COLS * 1.4, WIN_TILE_H = WIN_FLOORS * 1.8; // world units
    const CAM_Y = 24;          // flying above the avenue, below the tallest towers
    const LOOK_Y = 13;         // look slightly down the avenue

    const BG = { ready: false, failed: false };
    window.WordfallBG3D = BG;

    let THREE, canvas, renderer, scene, camera, composer, bloomPass;
    let buildingMat, groundMat, rainMat, backdropMat, backdrop;
    let scroll = 0, time = 0, speed = BASE_SPEED;
    // Graphics setting. Low = no bloom, no rain, half the buildings.
    const CITY_COUNT = 160;
    let quality = 'high';
    // Event reactions (all decay back to rest on their own).
    let shake = 0;             // camera shake amplitude
    let pulse = 0;             // bloom / glow pulse
    let bossMix = 0;           // 0 = normal city, 1 = boss-wave red
    const BOSS_TINT = [1.0, 0.3, 0.36];
    const BOSS_FOG = [0.07, 0.012, 0.022];
    const BLOOM_BASE = 0.85;
    let fogColor = null, tintVec = null;   // shared by every material
    let viewW = 0, viewH = 0;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.async = true;
            if (/^https?:/.test(src)) s.crossOrigin = 'anonymous';
            s.onload = resolve;
            s.onerror = () => reject(new Error('could not load ' + src));
            document.head.appendChild(s);
        });
    }

    function webglAvailable() {
        try {
            const c = document.createElement('canvas');
            return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
        } catch (e) { return false; }
    }

    // Small seeded RNG so the city layout is the same every load.
    function rng(seed) {
        let s = seed >>> 0;
        return () => {
            s = (s + 0x6D2B79F5) >>> 0;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ---------- Shaders ----------
    const FOG_GLSL = `
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;
    `;
    // Shared corridor wrap: slides a z position toward the camera by the
    // accumulated scroll and wraps it back to the far end.
    const WRAP_GLSL = `
        uniform float uScroll;
        uniform float uLen;
        uniform float uNear;
        float wrapZ(float z) { return mod(z + uScroll, uLen) - uLen + uNear; }
    `;

    const BUILDING_VS = `
        ${WRAP_GLSL}
        ${FOG_GLSL}
        attribute vec3 aColor;
        attribute float aSeed;
        varying vec3 vLocal;
        varying vec3 vSize;
        varying vec3 vN;
        varying vec3 vColor;
        varying float vSeed;
        varying float vFog;
        void main() {
            vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
            vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
            float baseZ = instanceMatrix[3].z;
            wp.z += wrapZ(baseZ) - baseZ;
            vLocal = (position + vec3(0.5, 0.0, 0.5)) * sc;
            vSize = sc;
            vN = normal;
            vColor = aColor;
            vSeed = aSeed;
            vec4 mv = viewMatrix * wp;
            vFog = smoothstep(uFogNear, uFogFar, -mv.z);
            gl_Position = projectionMatrix * mv;
        }
    `;
    const BUILDING_FS = `
        ${FOG_GLSL}
        uniform float uTime;
        uniform float uGlow;
        uniform vec3 uTint;
        uniform sampler2D uWin;   // R = neon strips, G = single windows
        varying vec3 vLocal;
        varying vec3 vSize;
        varying vec3 vN;
        varying vec3 vColor;
        varying float vSeed;
        varying float vFog;
        void main() {
            vec3 base = vec3(0.018, 0.022, 0.045);
            vec3 col = base;
            if (vN.y < 0.5) {
                // Side face: u runs along the face, y up the building.
                float u = abs(vN.x) > 0.5 ? vLocal.z : vLocal.x;
                float faceW = abs(vN.x) > 0.5 ? vSize.z : vSize.x;
                float edge = step(0.6, u) * step(u, faceW - 0.6);
                // Window pattern comes from a mipmapped texture so it stays
                // clean (no shimmer) at every distance. Each building reads
                // a different patch of it.
                vec2 uv = vec2(u / ${WIN_TILE_W.toFixed(2)} + vSeed * 3.7,
                               vLocal.y / ${WIN_TILE_H.toFixed(2)} + fract(vSeed * 7.31));
                vec2 m = texture2D(uWin, uv).rg * edge;
                float flicker = 0.85 + 0.15 * sin(uTime * (1.0 + vSeed * 3.0) + vSeed * 20.0);
                // Neon rim along the roofline.
                float rim = smoothstep(vSize.y - 0.4, vSize.y - 0.05, vLocal.y);
                col += vColor * (m.r * 0.9 * flicker + rim * 0.55) * uGlow;
                col += mix(vColor, vec3(1.0, 0.85, 0.7), 0.5) * m.g * 0.22;
                // Faint vertical shading so faces read as solid.
                col *= 0.8 + 0.2 * abs(vN.x);
            } else {
                col = base * 1.6;
            }
            col *= uTint;
            col = mix(col, uFogColor, vFog);
            gl_FragColor = vec4(col, 1.0);
        }
    `;

    const GROUND_VS = `
        ${FOG_GLSL}
        varying vec3 vW;
        varying float vFog;
        void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vW = wp.xyz;
            vec4 mv = viewMatrix * wp;
            vFog = smoothstep(uFogNear, uFogFar, -mv.z);
            gl_Position = projectionMatrix * mv;
        }
    `;
    const GROUND_FS = `
        ${FOG_GLSL}
        uniform float uScroll;
        uniform float uGlow;
        uniform vec3 uTint;
        varying vec3 vW;
        varying float vFog;
        void main() {
            float z = vW.z - uScroll;
            float gz = abs(fract(z / 10.0) - 0.5);
            float gx = abs(fract(vW.x / 10.0) - 0.5);
            float line = smoothstep(0.47, 0.5, max(gz, gx));
            // Magenta lane dashes down the middle of the avenue.
            float lane = step(abs(vW.x), 0.25) * step(0.5, fract(z / 6.0));
            vec3 col = vec3(0.012, 0.016, 0.035);
            col += vec3(0.0, 0.55, 0.65) * line * 0.35 * uGlow;
            col += vec3(1.0, 0.18, 0.6) * lane * 0.8 * uGlow;
            col *= uTint;
            col = mix(col, uFogColor, vFog);
            gl_FragColor = vec4(col, 1.0);
        }
    `;

    const RAIN_VS = `
        ${WRAP_GLSL}
        ${FOG_GLSL}
        uniform float uTime;
        uniform float uHeight;
        attribute float aEnd;
        varying float vA;
        varying float vKind;
        void main() {
            // position.xyz holds per-streak random seeds in [0,1).
            vec3 s = position;
            float x = (s.x - 0.5) * 90.0;
            float fall = 22.0 + s.z * 18.0;
            float y = mod(s.y * uHeight - uTime * fall, uHeight);
            float z = wrapZ(s.z * uLen);
            float len = 0.9 + s.x * 1.6;
            vec3 p = vec3(x, y + aEnd * len, z - aEnd * 0.6);
            vec4 mv = viewMatrix * vec4(p, 1.0);
            vA = (1.0 - smoothstep(uFogNear, uFogFar, -mv.z)) * mix(0.15, 1.0, aEnd);
            vKind = step(0.88, s.y);
            gl_Position = projectionMatrix * mv;
        }
    `;
    const RAIN_FS = `
        uniform vec3 uTint;
        varying float vA;
        varying float vKind;
        void main() {
            vec3 c = mix(vec3(0.35, 0.85, 1.0), vec3(1.0, 0.25, 0.7), vKind);
            gl_FragColor = vec4(c * uTint * vA * 0.55, 1.0);
        }
    `;

    const BACKDROP_VS = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;
    const BACKDROP_FS = `
        uniform sampler2D uMap;
        uniform float uHasMap;
        uniform float uDim;
        uniform float uHue;
        uniform vec3 uTint;
        uniform vec3 uFogColor;
        varying vec2 vUv;
        vec3 hueRotate(vec3 c, float a) {
            // Same idea as CSS hue-rotate(): rotate around the grey axis.
            const vec3 k = vec3(0.57735);
            float ca = cos(a);
            return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
        }
        void main() {
            vec3 col = uFogColor;
            if (uHasMap > 0.5) {
                col = texture2D(uMap, vUv).rgb;
                col = hueRotate(col, uHue) * uDim * uTint;
            }
            // Melt the lower edge into the fog so the city blends into it.
            col = mix(uFogColor, col, smoothstep(0.08, 0.45, vUv.y));
            gl_FragColor = vec4(col, 1.0);
        }
    `;

    function fogUniforms() {
        return {
            uFogColor: { value: fogColor },
            uFogNear: { value: FOG_NEAR },
            uFogFar: { value: FOG_FAR },
        };
    }
    function wrapUniforms() {
        return { uScroll: { value: 0 }, uLen: { value: LEN }, uNear: { value: NEAR } };
    }

    // ---------- Scene ----------
    // Procedural window texture: R channel = continuous neon strips on some
    // floors, G channel = scattered single lit windows on the others.
    function windowTexture() {
        const c = document.createElement('canvas');
        c.width = WIN_COLS * WIN_PX; c.height = WIN_FLOORS * WIN_PX;
        const g = c.getContext('2d');
        g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
        const r = rng(99);
        for (let f = 0; f < WIN_FLOORS; f++) {
            const y = f * WIN_PX;
            if (r() < 0.27) {
                g.fillStyle = '#f00';
                g.fillRect(0, y + 4, c.width, 1);
                continue;
            }
            for (let col = 0; col < WIN_COLS; col++) {
                if (r() < 0.16) {
                    g.fillStyle = '#0f0';
                    g.fillRect(col * WIN_PX + 3, y + 3, 2, 3);
                }
            }
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        return tex;
    }

    function buildCity(count) {
        const geo = new THREE.BoxGeometry(1, 1, 1);
        geo.translate(0, 0.5, 0);
        const mesh = new THREE.InstancedMesh(geo, buildingMat, count);
        mesh.frustumCulled = false;   // instances move in the shader
        const colors = new Float32Array(count * 3);
        const seeds = new Float32Array(count);
        const r = rng(1337);
        const cyan = [0.0, 0.94, 1.0], magenta = [1.0, 0.18, 0.59], warm = [1.0, 0.6, 0.25];
        const m = new THREE.Matrix4();
        for (let i = 0; i < count; i++) {
            const side = i % 2 ? 1 : -1;
            // Most buildings line the avenue; the rest fill in behind them.
            const back = r() < 0.35;
            const x = side * (AVENUE + 4 + (back ? 16 + r() * 40 : r() * 10));
            const z = r() * LEN;
            const wdt = 5 + r() * 7, dep = 5 + r() * 8;
            const hgt = back ? 25 + r() * 55 : 8 + r() * 34;
            m.makeScale(wdt, hgt, dep);
            m.setPosition(x, 0, z);
            mesh.setMatrixAt(i, m);
            const pick = r();
            const c = pick < 0.46 ? cyan : (pick < 0.92 ? magenta : warm);
            colors.set(c, i * 3);
            seeds[i] = r();
        }
        geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
        geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
        mesh.instanceMatrix.needsUpdate = true;
        return mesh;
    }

    function buildRain(count) {
        const pos = new Float32Array(count * 2 * 3);
        const end = new Float32Array(count * 2);
        const r = rng(4242);
        for (let i = 0; i < count; i++) {
            const a = r(), b = r(), c = r();
            pos.set([a, b, c, a, b, c], i * 6);
            end[i * 2] = 0; end[i * 2 + 1] = 1;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
        const lines = new THREE.LineSegments(geo, rainMat);
        lines.frustumCulled = false;
        return lines;
    }

    function build() {
        THREE = window.THREE;
        if (!THREE || !THREE.EffectComposer || !THREE.UnrealBloomPass) throw new Error('three.js unavailable');

        canvas = document.getElementById('bg3d');
        if (!canvas) throw new Error('missing #bg3d canvas');
        renderer = new THREE.WebGLRenderer({
            canvas, antialias: false, alpha: false, stencil: false,
            powerPreference: 'high-performance',
        });
        renderer.setClearColor(new THREE.Color(FOG_COLOR[0], FOG_COLOR[1], FOG_COLOR[2]), 1);

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(62, 1, 0.5, 400);
        camera.position.set(0, CAM_Y, 0);
        camera.lookAt(0, LOOK_Y, -100);

        fogColor = new THREE.Color(FOG_COLOR[0], FOG_COLOR[1], FOG_COLOR[2]);
        tintVec = new THREE.Vector3(1, 1, 1);
        const tint = () => ({ value: tintVec });
        buildingMat = new THREE.ShaderMaterial({
            vertexShader: BUILDING_VS, fragmentShader: BUILDING_FS,
            uniforms: Object.assign(fogUniforms(), wrapUniforms(), {
                uTime: { value: 0 }, uGlow: { value: 1 }, uTint: tint(),
                uWin: { value: windowTexture() },
            }),
        });
        groundMat = new THREE.ShaderMaterial({
            vertexShader: GROUND_VS, fragmentShader: GROUND_FS,
            uniforms: Object.assign(fogUniforms(), { uScroll: { value: 0 }, uGlow: { value: 1 }, uTint: tint() }),
        });
        rainMat = new THREE.ShaderMaterial({
            vertexShader: RAIN_VS, fragmentShader: RAIN_FS,
            uniforms: Object.assign(fogUniforms(), wrapUniforms(), {
                uTime: { value: 0 }, uHeight: { value: 70 }, uTint: tint(),
            }),
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        backdropMat = new THREE.ShaderMaterial({
            vertexShader: BACKDROP_VS, fragmentShader: BACKDROP_FS,
            uniforms: Object.assign(fogUniforms(), {
                uMap: { value: null }, uHasMap: { value: 0 }, uDim: { value: 0.6 },
                uHue: { value: 0 }, uTint: tint(),
            }),
            depthTest: false, depthWrite: false,
        });

        // Far painted skyline, drawn first so the 3D city sits in front of it.
        backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), backdropMat);
        backdrop.renderOrder = -10;
        backdrop.frustumCulled = false;
        scene.add(backdrop);
        new THREE.TextureLoader().load(SKYLINE_URL, (tex) => {
            tex.minFilter = THREE.LinearFilter;
            backdropMat.uniforms.uMap.value = tex;
            backdropMat.uniforms.uHasMap.value = 1;
            BG._imgAspect = tex.image.width / tex.image.height;
            fitBackdrop();
        });

        const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, LEN + 40), groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(0, 0, NEAR - LEN / 2);
        scene.add(ground);

        BG.city = buildCity(CITY_COUNT);
        scene.add(BG.city);
        BG.rain = buildRain(1600);
        scene.add(BG.rain);

        composer = new THREE.EffectComposer(renderer);
        composer.addPass(new THREE.RenderPass(scene, camera));
        bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM_BASE, 0.55, 0.2);
        composer.addPass(bloomPass);

        applyQuality();
        resize(window.innerWidth, window.innerHeight);

        canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            BG.ready = false;   // game falls straight back to the 2D skyline
            canvas.classList.remove('on');
        });
    }

    // Size the backdrop to "cover" the view at its distance, like the 2D
    // background's cover-fit, lifted so its rooftops clear the horizon.
    function fitBackdrop() {
        if (!backdrop) return;
        const dist = LEN - NEAR + 20;
        const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.08;
        const w = h * camera.aspect;
        const ia = BG._imgAspect || 1.78;
        let pw = w, ph = w / ia;
        if (ph < h) { ph = h; pw = h * ia; }
        backdrop.scale.set(pw, ph, 1);
        backdrop.position.set(0, CAM_Y - dist * (CAM_Y - LOOK_Y) / 100 + ph * 0.12, -dist);
    }

    function applyQuality() {
        const high = quality === 'high';
        BG.city.count = high ? CITY_COUNT : CITY_COUNT / 2;
        BG.rain.visible = high;
        bloomPass.enabled = high;
        if (viewW) resize(viewW, viewH);
    }

    function resize(w, h) {
        if (!renderer) return;
        viewW = w; viewH = h;
        const dpr = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.25 : 1);
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
        composer.setPixelRatio(dpr);
        composer.setSize(w, h);
        camera.aspect = w / Math.max(1, h);
        camera.updateProjectionMatrix();
        fitBackdrop();
    }

    // ---------- Public API ----------
    BG.setQuality = function (q) {
        quality = q === 'low' ? 'low' : 'high';
        if (renderer) applyQuality();
    };

    BG.init = function (opts) {
        if (opts && opts.quality) quality = opts.quality === 'low' ? 'low' : 'high';
        if (BG.ready || BG._initing) return BG._initing || Promise.resolve(BG.ready);
        if (!webglAvailable()) {
            BG.failed = true;
            BG._initing = Promise.resolve(false);
            return BG._initing;
        }
        BG._initing = loadScript(THREE_URL)
            .then(() => loadScript(POSTFX_URL))
            .then(() => {
                build();
                // Render one frame before revealing so the fade-in isn't black.
                render(0);
                BG.ready = true;
                canvas.classList.add('on');
                return true;
            })
            .catch((err) => {
                BG.failed = true;
                console.warn('[Word Fall] 3D background disabled — using 2D skyline:', err.message);
                return false;
            });
        return BG._initing;
    };

    // Debug handle for tests/tuning only.
    BG._debug = () => ({ renderer, composer, bloomPass, camera, scene });

    BG.resize = function (w, h) { if (BG.ready || renderer) resize(w, h); };

    // Gameplay events, detected by game.js from read-only state.
    //   lifeLost      -> camera shake
    //   detonated     -> bigger camera shake
    //   wordDestroyed -> brief bloom pulse
    BG.event = function (name) {
        if (name === 'lifeLost') shake = Math.max(shake, 1.0);
        else if (name === 'detonated') shake = Math.max(shake, 1.8);
        else if (name === 'wordDestroyed') pulse = Math.min(1.4, pulse + 1);
    };

    // view: { state, hue, freeze, boss, reduceMotion } — read-only snapshot.
    BG.frame = function (dtMs, view) {
        if (!BG.ready) return;
        const dt = Math.min(0.064, dtMs / 1000);
        time += dt;

        // Boss waves: ease into a red city and a slower, heavier scroll.
        bossMix += ((view.boss ? 1 : 0) - bossMix) * Math.min(1, dt * 2);
        let target = BASE_SPEED * (1 - 0.55 * bossMix);
        if (view.state === 'paused') target = 0;
        else if (view.state === 'gameover') target = BASE_SPEED * 0.35;
        if (view.freeze) target *= 0.25;
        if (view.reduceMotion) target *= 0.5;
        speed += (target - speed) * Math.min(1, dt * 2.5);
        scroll += speed * dt;

        tintVec.set(
            1 + (BOSS_TINT[0] - 1) * bossMix,
            1 + (BOSS_TINT[1] - 1) * bossMix,
            1 + (BOSS_TINT[2] - 1) * bossMix);
        fogColor.setRGB(
            FOG_COLOR[0] + (BOSS_FOG[0] - FOG_COLOR[0]) * bossMix,
            FOG_COLOR[1] + (BOSS_FOG[1] - FOG_COLOR[1]) * bossMix,
            FOG_COLOR[2] + (BOSS_FOG[2] - FOG_COLOR[2]) * bossMix);

        // Word destroyed: a quick swell of glow that fades in ~0.3s.
        pulse *= Math.exp(-dt * 7);
        bloomPass.strength = BLOOM_BASE + pulse * 0.9;
        // Low has no bloom, so its neon runs a little hotter to compensate.
        const glow = quality === 'high' ? 1 : 1.2;
        buildingMat.uniforms.uGlow.value = glow + pulse * 0.35;
        groundMat.uniforms.uGlow.value = glow + pulse * 0.5;

        buildingMat.uniforms.uScroll.value = scroll;
        buildingMat.uniforms.uTime.value = time;
        groundMat.uniforms.uScroll.value = scroll;
        rainMat.uniforms.uScroll.value = scroll;
        rainMat.uniforms.uTime.value = time;
        backdropMat.uniforms.uHue.value = (view.hue || 0) * Math.PI / 180;

        // Gentle drift so the flight feels alive, plus life-lost shake.
        // Reduce Motion (game setting) turns both off.
        const drift = view.reduceMotion ? 0 : 1;
        shake = view.reduceMotion ? 0 : shake * Math.exp(-dt * 5);
        const jx = (Math.random() - 0.5) * shake * 1.6;
        const jy = (Math.random() - 0.5) * shake * 1.2;
        camera.position.x = Math.sin(time * 0.13) * 0.9 * drift + jx;
        camera.position.y = CAM_Y + Math.sin(time * 0.21) * 0.45 * drift + jy;
        camera.lookAt(camera.position.x * 0.4, LOOK_Y, -100);
        camera.rotation.z += Math.sin(time * 0.1) * 0.012 * drift + (Math.random() - 0.5) * shake * 0.03;

        render(dt);
    };

    // High goes through the bloom composer; Low draws straight to screen.
    function render(dt) {
        if (quality === 'high') composer.render(dt);
        else renderer.render(scene, camera);
    }
})();
