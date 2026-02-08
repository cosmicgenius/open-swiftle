class SwiftleGame {
    constructor() {
        this.sessionId = null;
        this.currentMode = 'daily';
        this.currentGuess = 1;
        this.maxGuesses = 6;
        this.gameCompleted = false;
        this.guesses = [];
        this.preloadedAudioUrl = null; // Object URL for preloaded audio
        this.allSongs = [];
        this.songsById = new Map();
        this.songsLoaded = false;
        this.freeplayTimeoutId = null;
        this.freeplayIntervalId = null;
        this.freeplayRoundToken = 0;
        this.freeplayHardMode = false;
        this.freeplayScore = 0;
        this.freeplayBestScore = Number(localStorage.getItem('swiftle_freeplay_best_score') || 0);

        this.initializeElements();
        this.bindEvents();
        this.bootstrapFromRoute();
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
        this.guessSearchInput = document.getElementById('guess-search');
        this.guessSelect = document.getElementById('guess-select');
        this.submitGuessBtn = document.getElementById('submit-guess');
        this.guessesRemaining = document.getElementById('guesses-remaining');
        this.guessCounter = document.getElementById('guess-counter');
        this.guessesList = document.getElementById('guesses-list');
        this.gameResult = document.getElementById('game-result');
        this.resultMessage = document.getElementById('result-message');
        this.playAgainBtn = document.getElementById('play-again');
        this.retryBtn = document.getElementById('retry-btn');
        this.errorText = document.getElementById('error-text');
        this.freeplayProgressWrap = document.getElementById('freeplay-progress-wrap');
        this.freeplayProgressBar = document.getElementById('freeplay-progress-bar');
        this.freeplayScoreRow = document.getElementById('freeplay-score');
        this.freeplayScoreValue = document.getElementById('freeplay-score-value');
        this.freeplayBestScoreValue = document.getElementById('freeplay-best-score-value');
        this.freeplayOptions = document.getElementById('freeplay-options');
        this.freeplayHardModeInput = document.getElementById('freeplay-hard-mode');
    }

    bindEvents() {
        this.dailyModeBtn.addEventListener('click', () => this.navigateTo('/'));
        this.freeplayModeBtn.addEventListener('click', () => this.navigateTo('/freeplay'));
        this.startGameBtn.addEventListener('click', () => this.startNewGame());
        this.submitGuessBtn.addEventListener('click', () => this.submitGuess());
        this.playAgainBtn.addEventListener('click', () => this.startNewGame());
        this.retryBtn.addEventListener('click', () => this.hideError());

        this.guessSearchInput.addEventListener('input', () => {
            this.renderSongOptions(this.guessSearchInput.value);
        });

        this.guessSearchInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            if (!this.submitGuessBtn.disabled) {
                this.submitGuess();
                return;
            }
            if (this.guessSelect.options.length > 1) {
                this.guessSelect.selectedIndex = 1;
                this.updateSubmitState();
            }
        });

        this.guessSelect.addEventListener('change', () => {
            this.updateSubmitState();
        });
    }

    bootstrapFromRoute() {
        const path = window.location.pathname;
        if (path === '/freeplay') {
            this.setMode('freeplay');
            this.configureStartScreenForFreeplay();
            this.showStartScreen();
            return;
        }

        this.setMode('daily');
        this.startNewGame();
    }

    navigateTo(pathname) {
        if (window.location.pathname === pathname) {
            window.location.reload();
            return;
        }
        window.location.assign(pathname);
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

    async startNewGame(keepFreeplayScore = false) {
        this.showLoading();
        this.resetGameState();

        try {
            this.currentMode = this.getSelectedModeFromUI();
            if (this.currentMode !== 'freeplay' || !keepFreeplayScore) {
                this.freeplayScore = 0;
            }
            this.freeplayHardMode = this.currentMode === 'freeplay' && this.getFreeplayHardMode();
            await this.ensureSongsLoaded();

            const response = await fetch('/api/game/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: this.currentMode,
                    clientId: this.getClientId(),
                    freeplayHard: this.freeplayHardMode
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to start game');
            }

            const data = await response.json();
            this.sessionId = data.sessionId;
            this.currentMode = data.mode;
            this.freeplayHardMode = data.freeplayHard === true;
            this.maxGuesses = data.maxGuesses;
            this.renderCounter();

            if (data.mode === 'freeplay') {
                this.setHistoryVisible(false);
                await this.startFreeplayRound();
            } else {
                this.setHistoryVisible(true);
                this.audioPlayer.controls = true;
                this.audioPlayer.style.display = '';
                this.freeplayProgressWrap.classList.add('hidden');
                this.freeplayScoreRow.classList.add('hidden');
                this.clipDuration.textContent = `${this.currentGuess}s revealed`;
                await this.preloadAudioClip(this.currentGuess);
                this.showGameArea();
                this.guessSearchInput.focus();
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
        this.freeplayRoundToken += 1;
        const roundToken = this.freeplayRoundToken;
        this.clearFreeplayTimers();

        try {
            await this.preloadAudioClip(6);
            this.showGameArea();
            this.audioPlayer.controls = false;
            this.audioPlayer.style.display = 'none';
            this.freeplayProgressWrap.classList.remove('hidden');
            this.freeplayScoreRow.classList.remove('hidden');
            this.renderCounter();
            this.renderFreeplayScore();
            this.guessSelect.disabled = false;
            this.guessSearchInput.focus();
            this.clipDuration.textContent = '';
            this.startFreeplayCountdown(roundToken);

            // Auto-play the 6s clip
            try {
                this.audioPlayer.currentTime = 0;
                await this.audioPlayer.play();
            } catch {
                // If autoplay is blocked, keep controls visible and let user play manually.
            }
        } catch (error) {
            console.error('Freeplay error:', error);
            this.showError('Failed to load freeplay round');
        }
    }

    async submitGuess() {
        const selectedSongId = Number(this.guessSelect.value);
        const selectedSong = this.songsById.get(selectedSongId);
        if (!selectedSong || this.gameCompleted) {
            this.showError('Select a valid song from the list before submitting.');
            return;
        }

        this.submitGuessBtn.disabled = true;
        this.guessSelect.disabled = true;

        try {
            const response = await fetch(`/api/game/${this.sessionId}/guess`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guessSongId: selectedSong.id })
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
            this.guessSelect.disabled = false;
        }
    }

    handleGuessResult(result) {
        this.addGuessToList(result);
        this.renderCounter(result.guessesRemaining);
        this.guessSearchInput.value = '';
        this.renderSongOptions('');
        this.guessSelect.value = '';
        this.guessSelect.disabled = false;
        this.submitGuessBtn.disabled = true;

        if (result.completed) {
            this.gameCompleted = true;
            this.guessSelect.disabled = true;
            this.clearFreeplayTimers();

            if (this.currentMode === 'freeplay' && result.won) {
                this.freeplayScore += 1;
                if (this.freeplayScore > this.freeplayBestScore) {
                    this.freeplayBestScore = this.freeplayScore;
                    localStorage.setItem('swiftle_freeplay_best_score', String(this.freeplayBestScore));
                }
                this.renderFreeplayScore();
                setTimeout(() => {
                    if (this.currentMode === 'freeplay') this.startNewGame(true);
                }, 250);
                return;
            }

            this.showGameResult(result);
        } else {
            if (this.currentMode === 'daily') {
                this.currentGuess++;
                this.clipDuration.textContent = `${this.currentGuess}s revealed`;
                this.preloadAudioClip(this.currentGuess);
            }
            this.guessSearchInput.focus();
        }

        this.submitGuessBtn.disabled = this.gameCompleted;
    }

    addGuessToList(result) {
        if (result.timedOut) return;
        if (this.currentMode === 'freeplay') return;

        const guessItem = document.createElement('div');
        guessItem.className = `guess-item ${result.matchLevel}`;

        const feedbackText =
            result.matchLevel === 'correct_song'
                ? 'Correct song'
                : result.matchLevel === 'correct_album'
                    ? 'Correct album'
                    : 'Incorrect';

        guessItem.innerHTML = `
            <div class="guess-number">${result.guessNumber}</div>
            <div class="guess-text">"${result.guess}"</div>
            <div class="guess-result">${feedbackText}</div>
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
                The song was: <strong>"${result.correctSong.title}"</strong>
            `;
        } else if (result.timedOut) {
            this.resultMessage.innerHTML = `
                Time's Up<br>
                The song was: <strong>"${result.correctSong.title}"</strong><br>
                Score: <strong>${this.freeplayScore}</strong> • Best: <strong>${this.freeplayBestScore}</strong>
            `;
        } else {
            this.resultMessage.innerHTML = `
                Game Over<br>
                The song was: <strong>"${result.correctSong.title}"</strong><br>
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
        this.clearFreeplayTimers();

        if (this.preloadedAudioUrl) {
            URL.revokeObjectURL(this.preloadedAudioUrl);
            this.preloadedAudioUrl = null;
        }

        this.guessesRemaining.textContent = '6';
        this.clipDuration.textContent = '0s revealed';
        this.guessesList.innerHTML = '';
        this.guessSearchInput.value = '';
        this.guessSelect.value = '';
        this.guessSelect.disabled = false;
        this.submitGuessBtn.disabled = true;
        this.audioPlayer.src = '';
        this.audioPlayer.style.display = '';
        this.audioPlayer.controls = true;
        this.audioPlayer.onended = null;
        this.freeplayProgressWrap.classList.add('hidden');
        this.setFreeplayProgress(100);
        this.freeplayScoreRow.classList.add('hidden');
        this.freeplayOptions.classList.add('hidden');
        this.playAgainBtn.style.display = '';

        if (this.songsLoaded) {
            this.renderSongOptions('');
        }

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

    formatSongOption(song) {
        const albumText = song.album ? ` (${song.album})` : '';
        return `${song.title}${albumText}`;
    }

    getSelectedModeFromUI() {
        return this.freeplayModeBtn.classList.contains('active') ? 'freeplay' : 'daily';
    }

    async ensureSongsLoaded() {
        if (this.songsLoaded) return;

        const response = await fetch('/api/admin/songs');
        if (!response.ok) {
            throw new Error('Failed to load songs list');
        }

        const songs = await response.json();
        this.allSongs = songs;
        this.songsById.clear();
        this.allSongs.forEach((song) => {
            this.songsById.set(song.id, song);
        });
        this.renderSongOptions('');

        this.songsLoaded = true;
    }

    configureStartScreenForFreeplay() {
        const heading = this.startScreen.querySelector('h2');
        const description = this.startScreen.querySelector('p');
        if (heading) heading.textContent = 'Freeplay';
        if (description) {
            description.textContent =
                'Click start to hear a 6-second clip immediately. Guess as many as you can before time runs out.';
        }
        this.freeplayOptions.classList.remove('hidden');
        this.startGameBtn.textContent = 'Start Freeplay';
    }

    startFreeplayCountdown(roundToken) {
        const startedAt = Date.now();
        const durationMs = 6000;

        this.freeplayIntervalId = setInterval(() => {
            if (roundToken !== this.freeplayRoundToken || this.gameCompleted) return;
            const elapsed = Date.now() - startedAt;
            const remainingMs = Math.max(0, durationMs - elapsed);
            const pct = (remainingMs / durationMs) * 100;
            this.setFreeplayProgress(pct);
        }, 150);

        this.freeplayTimeoutId = setTimeout(() => {
            if (roundToken !== this.freeplayRoundToken || this.gameCompleted) return;
            this.handleFreeplayTimeout();
        }, durationMs);
    }

    setFreeplayProgress(percent) {
        this.freeplayProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }

    clearFreeplayTimers() {
        if (this.freeplayTimeoutId) {
            clearTimeout(this.freeplayTimeoutId);
            this.freeplayTimeoutId = null;
        }
        if (this.freeplayIntervalId) {
            clearInterval(this.freeplayIntervalId);
            this.freeplayIntervalId = null;
        }
    }

    async handleFreeplayTimeout() {
        if (!this.sessionId || this.currentMode !== 'freeplay' || this.gameCompleted) return;

        try {
            this.submitGuessBtn.disabled = true;
            this.guessSelect.disabled = true;

            const response = await fetch(`/api/game/${this.sessionId}/timeout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to process timeout');
            }

            const result = await response.json();
            this.handleGuessResult(result);
        } catch (error) {
            console.error('Freeplay timeout error:', error);
            this.showError(error.message || 'Failed to process timeout');
        }
    }

    renderCounter(guessesRemainingOverride) {
        if (this.currentMode === 'freeplay') {
            if (this.freeplayHardMode) {
                const remaining =
                    guessesRemainingOverride !== undefined && guessesRemainingOverride !== null
                        ? guessesRemainingOverride
                        : this.maxGuesses;
                this.guessCounter.innerHTML = `Hard mode guesses remaining: <span id="guesses-remaining">${remaining}</span>`;
                this.guessesRemaining = this.guessCounter.querySelector('#guesses-remaining');
            } else {
                this.guessCounter.innerHTML = 'Time-limited freeplay';
                this.guessesRemaining = document.createElement('span');
            }
            return;
        }

        const remaining =
            guessesRemainingOverride !== undefined && guessesRemainingOverride !== null
                ? guessesRemainingOverride
                : this.maxGuesses;
        this.guessCounter.innerHTML = `Guesses remaining: <span id="guesses-remaining">${remaining}</span>`;
        this.guessesRemaining = this.guessCounter.querySelector('#guesses-remaining');
    }

    setHistoryVisible(visible) {
        this.guessesList.classList.toggle('hidden', !visible);
    }

    renderFreeplayScore() {
        this.freeplayScoreValue.textContent = String(this.freeplayScore);
        this.freeplayBestScoreValue.textContent = String(this.freeplayBestScore);
    }

    getFreeplayHardMode() {
        return this.freeplayHardModeInput?.checked === true;
    }

    updateSubmitState() {
        const selectedSongId = Number(this.guessSelect.value);
        this.submitGuessBtn.disabled = !this.songsById.get(selectedSongId) || this.gameCompleted;
    }

    normalizeSearch(value) {
        return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    getSongMatchScore(song, normalizedQuery) {
        if (!normalizedQuery) return 1000;

        const normalizedTitle = this.normalizeSearch(song.title);
        const normalizedAlbum = this.normalizeSearch(song.album || '');
        const normalizedCombined = this.normalizeSearch(this.formatSongOption(song));

        if (normalizedTitle === normalizedQuery) return 0;
        if (normalizedTitle.startsWith(normalizedQuery)) return 1;
        if (normalizedTitle.includes(normalizedQuery)) return 2;
        if (normalizedAlbum.startsWith(normalizedQuery)) return 3;
        if (normalizedCombined.includes(normalizedQuery)) return 4;
        return null;
    }

    renderSongOptions(queryText) {
        const normalizedQuery = this.normalizeSearch(queryText);
        const queryLength = normalizedQuery.length;

        const ranked = this.allSongs
            .map((song) => ({
                song,
                score: this.getSongMatchScore(song, normalizedQuery)
            }))
            .filter((entry) => entry.score !== null)
            .sort((a, b) => {
                if (a.score !== b.score) return a.score - b.score;
                const aLengthDelta = Math.abs(a.song.title.length - queryLength);
                const bLengthDelta = Math.abs(b.song.title.length - queryLength);
                if (aLengthDelta !== bLengthDelta) return aLengthDelta - bLengthDelta;
                if (a.song.title.length !== b.song.title.length) return a.song.title.length - b.song.title.length;
                return a.song.title.localeCompare(b.song.title);
            })
            .slice(0, 100);

        this.guessSelect.innerHTML = '<option value="">Select a song...</option>';
        ranked.forEach(({ song }) => {
            const option = document.createElement('option');
            option.value = String(song.id);
            option.textContent = this.formatSongOption(song);
            this.guessSelect.appendChild(option);
        });

        if (normalizedQuery && ranked.length > 0) {
            this.guessSelect.selectedIndex = 1;
        } else {
            this.guessSelect.selectedIndex = 0;
        }

        this.updateSubmitState();
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
