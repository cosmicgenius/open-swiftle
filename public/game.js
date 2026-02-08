class SwiftleGame {
    constructor() {
        this.sessionId = null;
        this.currentMode = 'daily';
        this.currentGuess = 1;
        this.maxGuesses = 6;
        this.gameCompleted = false;
        this.guesses = [];
        this.preloadedAudioUrl = null; // Object URL for preloaded audio

        this.initializeElements();
        this.bindEvents();
        this.showStartScreen();
    }

    initializeElements() {
        this.dailyModeBtn = document.getElementById('daily-mode');
        this.freeplayModeBtn = document.getElementById('freeplay-mode');
        this.startScreen = document.getElementById('start-screen');
        this.gameArea = document.getElementById('game-area');
        this.loading = document.getElementById('loading');
        this.errorMessage = document.getElementById('error-message');
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
        this.dailyModeBtn.addEventListener('click', () => this.setMode('daily'));
        this.freeplayModeBtn.addEventListener('click', () => this.setMode('freeplay'));
        this.startGameBtn.addEventListener('click', () => this.startNewGame());
        this.submitGuessBtn.addEventListener('click', () => this.submitGuess());
        this.playAgainBtn.addEventListener('click', () => this.startNewGame());
        this.retryBtn.addEventListener('click', () => this.hideError());

        this.guessInput.addEventListener('input', () => {
            const hasText = this.guessInput.value.trim().length > 0;
            this.submitGuessBtn.disabled = !hasText || this.gameCompleted;
        });

        this.guessInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !this.submitGuessBtn.disabled) {
                this.submitGuess();
            }
        });
    }

    setMode(mode) {
        this.currentMode = mode;
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
                headers: { 'Content-Type': 'application/json' },
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
            this.maxGuesses = data.maxGuesses;
            this.guessesRemaining.textContent = String(this.maxGuesses);

            if (this.currentMode === 'freeplay') {
                await this.startFreeplayRound();
            } else {
                await this.preloadAudioClip(this.currentGuess);
                this.showGameArea();
                this.guessInput.focus();
            }
        } catch (error) {
            console.error('Error starting game:', error);
            this.showError(error.message);
        }
    }

    // --- Audio preloading: fetch as blob so playback is instant ---

    async preloadAudioClip(guessNumber) {
        if (!this.sessionId) return;

        const audioUrl = `/api/game/${this.sessionId}/audio/${guessNumber}`;
        this.clipDuration.textContent = `${guessNumber}s`;

        try {
            const resp = await fetch(audioUrl);
            if (!resp.ok) throw new Error('Failed to fetch audio');

            const blob = await resp.blob();

            // Revoke previous object URL to avoid memory leak
            if (this.preloadedAudioUrl) {
                URL.revokeObjectURL(this.preloadedAudioUrl);
            }

            this.preloadedAudioUrl = URL.createObjectURL(blob);
            this.audioPlayer.src = this.preloadedAudioUrl;
        } catch (error) {
            console.error('Error preloading audio:', error);
            this.showError('Failed to load audio clip');
        }
    }

    // --- Freeplay: auto-play 6s clip, then prompt for guess ---

    async startFreeplayRound() {
        try {
            await this.preloadAudioClip(6);
            this.showGameArea();

            // Hide the audio controls - force playback
            this.audioPlayer.style.display = 'none';
            this.clipDuration.textContent = 'Listen carefully...';
            this.guessInput.disabled = true;
            this.submitGuessBtn.disabled = true;

            // Auto-play the 6s clip
            await this.audioPlayer.play();

            // When clip ends, enable guessing
            this.audioPlayer.onended = () => {
                this.audioPlayer.style.display = '';
                this.clipDuration.textContent = '6s (one chance!)';
                this.guessInput.disabled = false;
                this.guessInput.focus();
            };
        } catch (error) {
            console.error('Freeplay error:', error);
            // If autoplay is blocked, show controls and let user play manually
            this.audioPlayer.style.display = '';
            this.clipDuration.textContent = '6s - press play, then guess!';
            this.guessInput.disabled = false;
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
                headers: { 'Content-Type': 'application/json' },
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
        this.addGuessToList(result);
        this.guessesRemaining.textContent = String(result.guessesRemaining);
        this.guessInput.value = '';
        this.guessInput.disabled = false;

        if (result.completed) {
            this.gameCompleted = true;
            this.showGameResult(result);
        } else {
            // Daily mode: reveal next clip
            this.currentGuess++;
            this.preloadAudioClip(this.currentGuess);
            this.guessInput.focus();
        }

        this.submitGuessBtn.disabled = this.gameCompleted;
    }

    addGuessToList(result) {
        const guessItem = document.createElement('div');
        guessItem.className = `guess-item ${result.correct ? 'correct' : 'incorrect'}`;

        guessItem.innerHTML = `
            <div class="guess-number">${result.guessNumber}</div>
            <div class="guess-text">"${result.guess}"</div>
            <div class="guess-result">${result.correct ? 'Correct!' : 'Incorrect'}</div>
        `;

        this.guessesList.appendChild(guessItem);
        guessItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    showGameResult(result) {
        this.gameResult.classList.remove('hidden');
        this.gameResult.className = `game-result ${result.won ? 'won' : 'lost'}`;

        if (result.won) {
            const tries = result.totalGuesses === 1 ? 'try' : 'tries';
            this.resultMessage.innerHTML = `
                Congratulations!<br>
                You guessed it in ${result.totalGuesses} ${tries}!<br>
                The song was: <strong>"${result.correctAnswer}"</strong>
            `;
        } else {
            this.resultMessage.innerHTML = `
                Game Over<br>
                The song was: <strong>"${result.correctAnswer}"</strong><br>
                Better luck next time!
            `;
        }

        // Show play again for freeplay, not for daily
        this.playAgainBtn.style.display =
            this.currentMode === 'freeplay' ? '' : 'none';
    }

    resetGameState() {
        this.sessionId = null;
        this.currentGuess = 1;
        this.maxGuesses = 6;
        this.gameCompleted = false;
        this.guesses = [];

        if (this.preloadedAudioUrl) {
            URL.revokeObjectURL(this.preloadedAudioUrl);
            this.preloadedAudioUrl = null;
        }

        this.guessesRemaining.textContent = '6';
        this.clipDuration.textContent = '0s';
        this.guessesList.innerHTML = '';
        this.guessInput.value = '';
        this.guessInput.disabled = false;
        this.submitGuessBtn.disabled = true;
        this.audioPlayer.src = '';
        this.audioPlayer.style.display = '';
        this.audioPlayer.onended = null;
        this.playAgainBtn.style.display = '';

        this.hideError();
    }

    getClientId() {
        let clientId = localStorage.getItem('swiftle_client_id');
        if (!clientId) {
            clientId = 'client_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
            localStorage.setItem('swiftle_client_id', clientId);
        }
        return clientId;
    }

    async checkGameAvailability() {
        try {
            const response = await fetch('/api/health');
            return response.ok;
        } catch {
            return false;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.game = new SwiftleGame();

    window.game.checkGameAvailability().then(available => {
        if (!available) {
            window.game.showError('Game server is not available. Please try again later.');
        }
    });
});