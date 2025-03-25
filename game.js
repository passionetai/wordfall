// Game variables
let currentWord = '';
let inputText = '';
let score = 0;
let level = 1;
let lives = 5;
let gameOver = false;
let fallSpeed = 0.5;
let baseSpeed = 0.5;
let usedWords = new Set();
let lastWord = '';

const wordList = [
    // Level 1 words (7+ letters)
    ['butterfly', 'dinosaur', 'universe', 'mountain', 'sunshine', 'elephant', 'dolphin'],
    // Level 2 words (6-7 letters)
    ['rainbow', 'penguin', 'octopus', 'dragon', 'monkey', 'planet'],
    // Level 3 words (5-6 letters)
    ['house', 'train', 'plant', 'smile', 'dance', 'happy'],
    // Level 4 words (4-5 letters)
    ['fish', 'bird', 'play', 'jump', 'swim', 'read'],
    // Level 5 words (3-4 letters)
    ['cat', 'dog', 'run', 'hat', 'sun', 'map']
];

// Three.js variables
let scene, camera, renderer, wordObject, particles, particleSystem;
let wordPosition = { x: 0, y: 0, z: 0 };
let wordVelocity = { y: 0 };

// Initialize the game
init();

function init() {
    // Set up Three.js scene
    setupScene();
    
    // Set up event listeners
    setupEventListeners();
    
    // Create the first word
    createNewWord();
    
    // Start the game loop
    animate();
}

function setupScene() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111122);
    
    // Create camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 10;
    camera.position.y = 0;
    
    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('game-container').appendChild(renderer.domElement);
    
    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0x404040);
    scene.add(ambientLight);
    
    // Add directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);
    
    // Create particle system for background
    createParticleSystem();
    
    // Handle window resize
    window.addEventListener('resize', onWindowResize);
}

function createParticleSystem() {
    const particleCount = 1000;
    particles = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
        // Random positions
        positions[i * 3] = (Math.random() - 0.5) * 200;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 200;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
        
        // Random colors
        colors[i * 3] = 0.2 + Math.random() * 0.3; // R
        colors[i * 3 + 1] = 0.3 + Math.random() * 0.3; // G
        colors[i * 3 + 2] = 0.5 + Math.random() * 0.5; // B
        
        // Random sizes
        sizes[i] = 0.5 + Math.random() * 1.5;
    }
    
    particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particles.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    particles.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    const particleMaterial = new THREE.PointsMaterial({
        size: 1,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        sizeAttenuation: true
    });
    
    particleSystem = new THREE.Points(particles, particleMaterial);
    scene.add(particleSystem);
}

function setupEventListeners() {
    // Keyboard input
    document.addEventListener('keydown', handleKeyPress);
    
    // Game over restart
    document.getElementById('game-over').addEventListener('click', restartGame);
}

function createNewWord() {
    // Get a random word for the current level
    const levelIndex = Math.min(level - 1, wordList.length - 1);
    const words = wordList[levelIndex];
    
    // Filter out previously used words and the last word used
    const availableWords = words.filter(word => !usedWords.has(word) && word !== lastWord);
    
    // If all words have been used, clear the used words set but keep lastWord check
    if (availableWords.length === 0) {
        usedWords.clear();
        currentWord = words.find(word => word !== lastWord) || words[0];
    } else {
        currentWord = availableWords[Math.floor(Math.random() * availableWords.length)];
    }
    
    // Store the current word as lastWord for next comparison
    lastWord = currentWord;
    usedWords.add(currentWord);
    inputText = '';
    
    // Update UI
    document.getElementById('word-display').textContent = currentWord;
    document.getElementById('input-display').textContent = '';
    
    // Create 3D word object
    if (wordObject) {
        scene.remove(wordObject);
    }
    
    // Create a 3D text mesh
    const loader = new THREE.FontLoader();
    loader.load('https://threejs.org/examples/fonts/helvetiker_regular.typeface.json', function(font) {
        const geometry = new THREE.TextGeometry(currentWord, {
            font: font,
            size: 0.5,
            height: 0.2,
            curveSegments: 12,
            bevelEnabled: true,
            bevelThickness: 0.03,
            bevelSize: 0.02,
            bevelOffset: 0,
            bevelSegments: 5
        });
        
        const material = new THREE.MeshPhongMaterial({
            color: 0x44aaff,
            specular: 0x111111,
            shininess: 30,
            flatShading: true
        });
        
        wordObject = new THREE.Mesh(geometry, material);
        wordObject.position.set(0, 5, 0);
        scene.add(wordObject);
        
        // Random color for the word
        wordObject.material.color.setHSL(Math.random(), 0.7, 0.7);
    });
    
    // Reset word position
    wordPosition = { x: 0, y: 5, z: 0 };
    wordVelocity.y = -fallSpeed * (level * 0.1);
}

function animate() {
    requestAnimationFrame(animate);
    
    if (!gameOver) {
        // Update particles for background animation
        const particlePositions = particles.attributes.position.array;
        for (let i = 0; i < particlePositions.length; i += 3) {
            particlePositions[i + 1] -= 0.05;
            if (particlePositions[i + 1] < -100) {
                particlePositions[i + 1] = 100;
                particlePositions[i] = (Math.random() - 0.5) * 200;
                particlePositions[i + 2] = (Math.random() - 0.5) * 200;
            }
        }
        particles.attributes.position.needsUpdate = true;
        
        // Update word position
        if (wordObject) {
            wordPosition.y += wordVelocity.y;
            wordObject.position.copy(wordPosition);
            
            // Rotate word slightly for visual effect
            wordObject.rotation.x += 0.005;
            wordObject.rotation.y += 0.01;
            
            // Check if word has fallen out of view
            if (wordPosition.y < -5) {
                handleGameOver();
            }
        }
    }
    
    renderer.render(scene, camera);
}

function handleKeyPress(event) {
    if (gameOver) return;
    
    const key = event.key.toLowerCase();
    
    // Only accept letter keys
    if (key.length === 1 && key.match(/[a-z]/)) {
        if (key === currentWord[inputText.length]) {
            inputText += key;
            
            // Update input display
            document.getElementById('input-display').textContent = inputText;
            
            // Update 3D word appearance
            if (wordObject) {
                // Change color to show progress
                const progress = inputText.length / currentWord.length;
                wordObject.material.color.setHSL(progress, 0.7, 0.7);
                
                // Add a little "pop" effect when correct key is pressed
                wordObject.scale.set(1.1, 1.1, 1.1);
                setTimeout(() => {
                    if (wordObject) wordObject.scale.set(1, 1, 1);
                }, 100);
            }
            
            // Word completed
            if (inputText.length === currentWord.length) {
                handleWordComplete();
            }
        }
    }
}

function handleWordComplete() {
    // Increase score
    score += 10 * level;
    document.getElementById('score').textContent = `Score: ${score}`;
    
    // Increment fall speed for each completed word
    fallSpeed += 0.05;
    
    // Check for level up (every 5 words)
    if (score >= level * 50) {
        level++;
        document.getElementById('level').textContent = `Level: ${level}`;
        
        // Add visual effect for level up
        if (wordObject) {
            wordObject.material.emissive.setHex(0xffff00);
            wordObject.material.emissiveIntensity = 1;
            setTimeout(() => {
                if (wordObject) wordObject.material.emissiveIntensity = 0;
            }, 500);
        }
    }
    
    // Create new word
    createNewWord();
}

function handleGameOver() {
    if (lives > 1) {
        // Checkpoint restart
        lives--;
        document.getElementById('lives').textContent = `Lives: ${lives}`;
        document.getElementById('game-over-text').textContent = 'Try Again!';
        document.getElementById('restart-text').textContent = 'Click to continue';
    } else {
        // Complete game over
        lives = 0;
        document.getElementById('lives').textContent = `Lives: ${lives}`;
        document.getElementById('game-over-text').textContent = 'Game Over!';
        document.getElementById('restart-text').textContent = 'Click to restart';
    }
    
    gameOver = true;
    document.getElementById('game-over').style.display = 'block';
    
    // Explode the word for visual effect
    if (wordObject) {
        explodeWord(wordObject);
        wordObject = null;
    }
}

function explodeWord(wordMesh) {
    if (!wordMesh) return;
    
    // Convert the word mesh into particles
    const geometry = wordMesh.geometry;
    const material = wordMesh.material.clone();
    material.vertexColors = false;
    
    // Create particles for each vertex
    const particles = new THREE.BufferGeometry();
    const positions = new Float32Array(geometry.attributes.position.count * 3);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    const sizes = new Float32Array(geometry.attributes.position.count);
    
    for (let i = 0; i < geometry.attributes.position.count; i++) {
        positions[i * 3] = geometry.attributes.position.array[i * 3];
        positions[i * 3 + 1] = geometry.attributes.position.array[i * 3 + 1];
        positions[i * 3 + 2] = geometry.attributes.position.array[i * 3 + 2];
        
        colors[i * 3] = material.color.r;
        colors[i * 3 + 1] = material.color.g;
        colors[i * 3 + 2] = material.color.b;
        
        sizes[i] = 0.2;
    }
    
    particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particles.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    particles.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    const particleMaterial = new THREE.PointsMaterial({
        size: 0.2,
        color: material.color,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        sizeAttenuation: true
    });
    
    const particleSystem = new THREE.Points(particles, particleMaterial);
    particleSystem.position.copy(wordMesh.position);
    scene.add(particleSystem);
    
    // Remove the original word
    scene.remove(wordMesh);
    
    // Animate the explosion
    const explosionSpeed = 0.1;
    const gravity = -0.01;
    const velocities = [];
    
    for (let i = 0; i < positions.length / 3; i++) {
        velocities.push({
            x: (Math.random() - 0.5) * explosionSpeed,
            y: Math.random() * explosionSpeed,
            z: (Math.random() - 0.5) * explosionSpeed
        });
    }
    
    let opacity = 1;
    const animateExplosion = () => {
        const particlePositions = particles.attributes.position.array;
        
        for (let i = 0; i < particlePositions.length / 3; i++) {
            particlePositions[i * 3] += velocities[i].x;
            particlePositions[i * 3 + 1] += velocities[i].y;
            particlePositions[i * 3 + 2] += velocities[i].z;
            
            velocities[i].y += gravity;
        }
        
        particles.attributes.position.needsUpdate = true;
        opacity -= 0.02;
        particleMaterial.opacity = opacity;
        
        if (opacity > 0) {
            requestAnimationFrame(animateExplosion);
        } else {
            scene.remove(particleSystem);
        }
    };
    
    animateExplosion();
}

function restartGame() {
    if (!gameOver) return;
    
    // Reset game variables
    if (lives <= 0) {
        // Complete restart
        score = 0;
        level = 1;
        lives = 5;
        usedWords.clear();
        lastWord = '';
        
        // Reset UI
        document.getElementById('score').textContent = 'Score: 0';
        document.getElementById('level').textContent = 'Level: 1';
        document.getElementById('lives').textContent = 'Lives: 5';
    }
    
    // Reset speed
    fallSpeed = baseSpeed;
    
    gameOver = false;
    document.getElementById('game-over').style.display = 'none';
    
    // Create new word
    createNewWord();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
