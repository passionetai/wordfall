const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game-container',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: false
        }
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

const game = new Phaser.Game(config);

let currentWord;
let wordText;
let scoreText;
let levelText;
let gameOverText;
let inputText = '';
let score = 0;
let level = 1;
let fallSpeed = 50;
let gameOver = false;
let lives = 5;
let maxLives = 5;
let livesText;

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

// Keep track of previously used words to prevent repetition
let usedWords = new Set();
let lastWord = '';
let baseSpeed = 50;

function preload() {
    // Load background image from assets folder
    this.load.image('background', 'assets/background.png');
}

let backgroundImage;

function create() {
    // Add the background image
    backgroundImage = this.add.tileSprite(400, 300, 800, 600, 'background');
    backgroundImage.setDisplaySize(800, 600);

    // Add semi-transparent black overlay
    const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000);
    overlay.setAlpha(0.7);

    // Initialize score text
    scoreText = this.add.text(16, 16, 'Score: 0', {
        fontSize: '32px',
        fill: '#fff'
    });

    // Initialize level text
    levelText = this.add.text(16, 56, 'Level: 1', {
        fontSize: '32px',
        fill: '#fff'
    });

    // Initialize lives text
    livesText = this.add.text(16, 96, 'Lives: 5', {
        fontSize: '32px',
        fill: '#fff'
    });

    // Initialize game over text (hidden by default)
    gameOverText = this.add.text(400, 300, 'Game Over!\nClick to restart', {
        fontSize: '64px',
        fill: '#ff0000',
        align: 'center'
    });
    gameOverText.setOrigin(0.5);
    gameOverText.setVisible(false);

    // Start listening for keyboard input
    this.input.keyboard.on('keydown', handleKeyPress);

    // Add click listener for restart
    this.input.on('pointerdown', restartGame);

    // Create the first word
    createNewWord(this);
}

function update() {
    if (gameOver) return;

    // Scroll the background
    backgroundImage.tilePositionY -= 0.5;

    // Move the word down
    if (wordText) {
        wordText.y += fallSpeed * (level * 0.1) / 60;

        // Check if word has hit the bottom
        if (wordText.y >= 550) {
            handleGameOver();
        }
    }
}

function createNewWord(scene) {
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
    
    // Add the word to used words set
    usedWords.add(currentWord);
    inputText = '';

    // Create or update the word text
    if (wordText) {
        wordText.destroy();
    }

    wordText = scene.add.text(400, 50, currentWord, {
        fontSize: '40px',
        fill: '#fff'
    });
    wordText.setOrigin(0.5);
}

function handleWordComplete() {
    // Increase score
    score += 10 * level;
    scoreText.setText(`Score: ${score}`);

    // Increment fall speed for each completed word
    fallSpeed += 2;

    // Check for level up (every 5 words)
    if (score >= level * 50) {
        level++;
        levelText.setText(`Level: ${level}`);
    }

    // Create new word
    createNewWord(wordText.scene);
}

function restartGame() {
    if (!gameOver) return;

    // Reset game variables
    if (lives <= 0) {
        // Complete restart
        score = 0;
        level = 1;
        lives = maxLives;
        // Clear used words and last word for fresh start
        usedWords.clear();
        lastWord = '';
        // Reset UI for complete restart
        scoreText.setText('Score: 0');
        levelText.setText('Level: 1');
        livesText.setText(`Lives: ${lives}`);
    }
    
    // Reset fall speed to base speed on each restart
    fallSpeed = baseSpeed;
    
    gameOver = false;
    inputText = '';
    gameOverText.setVisible(false);

    // Start new word
    createNewWord(game.scene.scenes[0]);
}

function handleKeyPress(event) {
    if (gameOver) return;

    const key = event.key.toLowerCase();

    // Only accept letter keys
    if (key.length === 1 && key.match(/[a-z]/)) {
        if (key === currentWord[inputText.length]) {
            inputText += key;

            // Update the word display by removing typed letters
            const remainingLetters = currentWord.slice(inputText.length);
            wordText.setText(remainingLetters);

            // Word completed
            if (inputText.length === currentWord.length) {
                handleWordComplete();
            }
        }
    }
}

function handleGameOver() {
    if (lives > 1) {
        // Checkpoint restart
        lives--;
        livesText.setText(`Lives: ${lives}`);
        gameOverText.setText('Restart from Checkpoint\nClick to continue');
    } else {
        // Complete game over
        lives = 0;
        livesText.setText(`Lives: ${lives}`);
        gameOverText.setText('Game Over\nClick to Start Again');
    }
    gameOver = true;
    gameOverText.setVisible(true);
    if (wordText) wordText.destroy();
}

function restartGame() {
    if (!gameOver) return;

    // Reset game variables
    if (lives <= 0) {
        // Complete restart
        score = 0;
        level = 1;
        lives = maxLives;
        // Clear used words and last word for fresh start
        usedWords.clear();
        lastWord = '';
        // Reset UI for complete restart
        scoreText.setText('Score: 0');
        levelText.setText('Level: 1');
        livesText.setText(`Lives: ${lives}`);
    }
    
    // Reset fall speed to base speed on each restart
    fallSpeed = baseSpeed;
    
    gameOver = false;
    inputText = '';
    gameOverText.setVisible(false);

    // Start new word
    createNewWord(game.scene.scenes[0]);
}