class SwiftleGame {
    constructor() {
        this.sessionId = null;
        this.currentMode = 'daily';
        this.currentGuess = 1;
        this.gameCompleted = false;
        this.guesses = [];
        
        this.initializeElements();
        this.bindEvents();
        this.showStartScreen();
    }

    initializeElements() {
        // Mode buttons
        this.dailyModeBtn = document.getElementById('daily-mode');
        this.freeplayModeBtn = document.getElementById('freeplay-mode');
        
        // Game elements
        this.startScreen = document.getElementById('start-screen');
        this.gameArea = document.getElementById('game-area');
        this.loading = document.getElementById('loading');
        this.errorMessage = document.getElementById('error-message');
        
        // Game controls
        this.startGameBtn = document.getElementById('start-game');
        this.audioPlayer = document.getElementById('audio-player');
        this.clipDuration = document.getElementById('clip-duration');
        this.guessInput = document.getElementById('guess-input');
        this.submitGuessBtn = document.getElementById('submit-guess');
        this.guessesRemaining = document.getElementById('guesses-remaining');
        this.guessesList = document.getElementById('guesses-list');
        this.gameResult = document.getElementById('game-result');
        this.resultMessage = document.getElementById('result-message');
        this.playAgainBtn = document.getElementById('play-again');
        this.retryBtn = document.getElementById('retry-btn');
        
        this.errorText = document.getElementById('error-text');
    }

    bindEvents() {
        // Mode selection
        this.dailyModeBtn.addEventListener('click', () => this.setMode('daily'));
        this.freeplayModeBtn.addEventListener('click', () => this.setMode('freeplay'));
        
        // Game controls
        this.startGameBtn.addEventListener('click', () => this.startNewGame());
        this.submitGuessBtn.addEventListener('click', () => this.submitGuess());
        this.playAgainBtn.addEventListener('click', () => this.startNewGame());
        this.retryBtn.addEventListener('click', () => this.hideError());
        
        // Input handling
        this.guessInput.addEventListener('input', () => {
            const hasText = this.guessInput.value.trim().length > 0;
            this.submitGuessBtn.disabled = !hasText || this.gameCompleted;
        });
        
        this.guessInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !this.submitGuessBtn.disabled) {
                this.submitGuess();
            }
        });

        // Audio events
        this.audioPlayer.addEventListener('loadstart', () => {
            this.audioPlayer.style.opacity = '0.5';
        });
        
        this.audioPlayer.addEventListener('canplay', () => {
            this.audioPlayer.style.opacity = '1';
        });

        this.audioPlayer.addEventListener('error', () => {
            this.showError('Failed to load audio clip');
        });
    }

    setMode(mode) {
        this.currentMode = mode;
        
        // Update button states
        this.dailyModeBtn.classList.toggle('active', mode === 'daily');
        this.freeplayModeBtn.classList.toggle('active', mode === 'freeplay');
    }

    showStartScreen() {
        this.hideAll();
        this.startScreen.classList.remove('hidden');
    }

    showGameArea() {
        this.hideAll();
        this.gameArea.classList.remove('hidden');
    }

    showLoading() {
        this.hideAll();
        this.loading.classList.remove('hidden');
    }

    showError(message) {
        this.errorText.textContent = message;
        this.errorMessage.classList.remove('hidden');
    }

    hideError() {
        this.errorMessage.classList.add('hidden');
    }

    hideAll() {
        this.startScreen.classList.add('hidden');
        this.gameArea.classList.add('hidden');
        this.loading.classList.add('hidden');
        this.gameResult.classList.add('hidden');
    }

    async startNewGame() {
        this.showLoading();
        this.resetGameState();
        
        try {
            const response = await fetch('/api/game/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    mode: this.currentMode,
                    clientId: this.getClientId()
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to start game');
            }

            const data = await response.json();
            this.sessionId = data.sessionId;
            
            await this.loadAudioClip();
            this.showGameArea();
            this.guessInput.focus();
            
        } catch (error) {
            console.error('Error starting game:', error);
            this.showError(error.message);
        }
    }

    async loadAudioClip() {
        if (!this.sessionId) return;
        
        try {
            const audioUrl = `/api/game/${this.sessionId}/audio/${this.currentGuess}`;
            
            // Preload the audio
            const audio = new Audio(audioUrl);
            audio.addEventListener('canplaythrough', () => {
                this.audioPlayer.src = audioUrl;
                this.clipDuration.textContent = `${this.currentGuess}s`;
            });
            
            audio.addEventListener('error', () => {
                this.showError('Failed to load audio clip');
            });
            
            audio.load();
            
        } catch (error) {
            console.error('Error loading audio:', error);
            this.showError('Failed to load audio');
        }
    }

    async submitGuess() {
        const guess = this.guessInput.value.trim();
        if (!guess || this.gameCompleted) return;

        this.submitGuessBtn.disabled = true;
        this.guessInput.disabled = true;

        try {
            const response = await fetch(`/api/game/${this.sessionId}/guess`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ guess })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to submit guess');
            }

            const result = await response.json();
            this.handleGuessResult(result);
            
        } catch (error) {
            console.error('Error submitting guess:', error);
            this.showError(error.message);
            this.submitGuessBtn.disabled = false;
            this.guessInput.disabled = false;
        }
    }

    handleGuessResult(result) {
        // Add guess to the list
        this.addGuessToList(result);
        
        // Update UI
        this.guessesRemaining.textContent = result.guessesRemaining;
        this.guessInput.value = '';
        this.guessInput.disabled = false;

        if (result.completed) {
            this.gameCompleted = true;
            this.showGameResult(result);
        } else {
            this.currentGuess++;
            this.loadAudioClip();
            this.guessInput.focus();
        }
        
        // Re-enable submit button for next guess
        this.submitGuessBtn.disabled = this.gameCompleted;
    }

    addGuessToList(result) {
        const guessItem = document.createElement('div');
        guessItem.className = `guess-item ${result.correct ? 'correct' : 'incorrect'}`;
        
        guessItem.innerHTML = `
            <div class="guess-number">${result.guessNumber}</div>
            <div class="guess-text">"${result.guess}"</div>
            <div class="guess-result">${result.correct ? '✅ Correct!' : '❌ Incorrect'}</div>
        `;
        
        this.guessesList.appendChild(guessItem);
        
        // Scroll to the new guess
        guessItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    showGameResult(result) {
        this.gameResult.classList.remove('hidden');
        this.gameResult.className = `game-result ${result.won ? 'won' : 'lost'}`;
        
        if (result.won) {
            this.resultMessage.innerHTML = `
                🎉 Congratulations! 🎉<br>
                You guessed it in ${result.totalGuesses} ${result.totalGuesses === 1 ? 'try' : 'tries'}!<br>
                The song was: <strong>"${result.correctAnswer}"</strong>
            `;
        } else {
            this.resultMessage.innerHTML = `
                😞 Game Over 😞<br>
                The song was: <strong>"${result.correctAnswer}"</strong><br>
                Better luck next time!
            `;
        }
    }

    resetGameState() {
        this.sessionId = null;
        this.currentGuess = 1;
        this.gameCompleted = false;
        this.guesses = [];
        
        // Reset UI
        this.guessesRemaining.textContent = '6';
        this.clipDuration.textContent = '0s';
        this.guessesList.innerHTML = '';
        this.guessInput.value = '';
        this.guessInput.disabled = false;
        this.submitGuessBtn.disabled = true;
        this.audioPlayer.src = '';
        
        this.hideError();
    }

    getClientId() {
        // Generate or retrieve a client ID for session management
        let clientId = localStorage.getItem('swiftle_client_id');
        if (!clientId) {
            clientId = 'client_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
            localStorage.setItem('swiftle_client_id', clientId);
        }
        return clientId;
    }

    // Utility method to check if game is available
    async checkGameAvailability() {
        try {
            const response = await fetch('/api/health');
            return response.ok;
        } catch {
            return false;
        }
    }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const game = new SwiftleGame();
    
    // Check if the server is available
    game.checkGameAvailability().then(available => {
        if (!available) {
            game.showError('Game server is not available. Please try again later.');
        }
    });
});

// Add some keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Escape to go back to start screen (if not in a game)
    if (e.key === 'Escape' && !game?.sessionId) {
        game?.showStartScreen();
    }
    
    // Space to play/pause audio (if audio is loaded)
    if (e.key === ' ' && document.activeElement !== document.getElementById('guess-input')) {
        e.preventDefault();
        const audio = document.getElementById('audio-player');
        if (audio && audio.src) {
            if (audio.paused) {
                audio.play();
            } else {
                audio.pause();
            }
        }
    }
});