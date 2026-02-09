export class SwiftleGame {
    constructor(initialMode = 'daily') {
        this.sessionId = null;
        this.currentMode = initialMode;
        this.initialMode = initialMode;
        this.currentGuess = 1;
        this.maxGuesses = 6;
        this.gameCompleted = false;
        this.guesses = [];
        this.preloadedAudioUrl = null; // Object URL for preloaded audio
        this.allSongs = [];
        this.songsById = new Map();
        this.songsLoaded = false;
        this.filteredSongs = [];
        this.selectedSongId = null;
        this.activeSuggestionIndex = -1;
        this.dailyGuessHistory = [];
        this.freeplayTimeoutId = null;
        this.freeplayIntervalId = null;
        this.freeplayRoundToken = 0;
        this.freeplayFeedbackTimeoutId = null;
        this.freeplayHardMode = false;
        this.freeplayScore = 0;
        this.freeplayBestScore = Number(localStorage.getItem('swiftle_freeplay_best_score') || 0);

        this.initializeElements();
        this.bindEvents();
        this.bootstrapForPage();
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
        this.dailyAudioShell = document.getElementById('daily-audio-shell');
        this.dailyPlayPauseBtn = document.getElementById('daily-play-pause');
        this.dailyAudioTime = document.getElementById('daily-audio-time');
        this.dailyAudioProgress = document.getElementById('daily-audio-progress');
        this.dailyAudioProgressFill = document.getElementById('daily-audio-progress-fill');
        this.clipDuration = document.getElementById('clip-duration');
        this.audioInfo = this.clipDuration?.parentElement || null;
        this.guessSearchInput = document.getElementById('guess-search');
        this.guessSuggestions = document.getElementById('guess-suggestions');
        this.guessInputAnchor = document.getElementById('guess-input-anchor');
        this.guessInputArea = document.getElementById('guess-input-area');
        this.submitGuessBtn = document.getElementById('submit-guess');
        this.guessesRemaining = document.getElementById('guesses-remaining');
        this.guessCounter = document.getElementById('guess-counter');
        this.dailyGuessTrack = document.getElementById('daily-guess-track');
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
        if (this.dailyModeBtn) {
            this.dailyModeBtn.addEventListener('click', () => this.navigateTo('/'));
        }
        if (this.freeplayModeBtn) {
            this.freeplayModeBtn.addEventListener('click', () => this.navigateTo('/freeplay'));
        }
        this.startGameBtn.addEventListener('click', () => this.startNewGame());
        this.submitGuessBtn.addEventListener('click', () => this.submitGuess());
        this.playAgainBtn.addEventListener('click', () => this.handlePlayAgain());
        this.retryBtn.addEventListener('click', () => this.hideError());
        if (this.dailyPlayPauseBtn) {
            this.dailyPlayPauseBtn.addEventListener('click', () => this.toggleDailyPlayback());
        }
        if (this.dailyAudioProgress) {
            this.dailyAudioProgress.addEventListener('click', (event) => this.seekDailyClip(event));
        }
        if (this.audioPlayer) {
            this.audioPlayer.addEventListener('timeupdate', () => this.updateDailyAudioUI());
            this.audioPlayer.addEventListener('loadedmetadata', () => this.updateDailyAudioUI());
            this.audioPlayer.addEventListener('play', () => this.updateDailyAudioUI());
            this.audioPlayer.addEventListener('pause', () => this.updateDailyAudioUI());
            this.audioPlayer.addEventListener('ended', () => this.updateDailyAudioUI());
        }

        this.guessSearchInput.addEventListener('input', () => {
            this.renderSongSuggestions(this.guessSearchInput.value);
        });

        this.guessSearchInput.addEventListener('focus', () => {
            this.renderSongSuggestions(this.guessSearchInput.value);
        });

        this.guessSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.moveSuggestionSelection(1);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.moveSuggestionSelection(-1);
                return;
            }
            if (e.key === 'Escape') {
                this.hideSuggestions();
                return;
            }
            if (e.key !== 'Enter') return;

            e.preventDefault();
            if (this.filteredSongs.length > 0) {
                this.selectedSongId = this.filteredSongs[0].id;
            }

            if (!this.submitGuessBtn.disabled && this.selectedSongId != null) {
                this.submitGuess();
                return;
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.guess-search-wrap')) {
                this.hideSuggestions();
            }
        });
    }

    bootstrapForPage() {
        if (this.initialMode === 'freeplay') {
            this.setMode('freeplay');
            this.configureStartScreenForFreeplay();
            this.showStartScreen();
            return;
        }

        this.setMode('daily');
        void this.resumeDailySessionOrStart();
    }

    async resumeDailySessionOrStart() {
        const storedSessionId = this.getStoredDailySessionId();
        if (!storedSessionId) {
            await this.startNewGame();
            return;
        }

        this.showLoading();
        this.resetGameState();

        try {
            await this.ensureSongsLoaded();
            const response = await fetch(`/api/game/${storedSessionId}/status`);
            if (!response.ok) {
                throw new Error('Stored daily session is unavailable');
            }

            const status = await response.json();
            if (status.mode !== 'daily') {
                throw new Error('Stored session is not daily');
            }

            this.sessionId = status.sessionId;
            this.currentMode = 'daily';
            this.maxGuesses = status.maxGuesses ?? 6;
            this.gameCompleted = status.completed === true;
            this.dailyGuessHistory = this.mapDailyGuessHistory(status.guesses ?? []);

            const totalGuesses = this.dailyGuessHistory.length;
            this.currentGuess = this.gameCompleted
                ? Math.min(6, Math.max(1, totalGuesses))
                : Math.min(6, totalGuesses + 1);

            this.setHistoryVisible(true);
            this.setDailyAudioVisible(true);
            this.setClipDurationVisible(true);
            this.audioPlayer.controls = true;
            this.audioPlayer.style.display = '';
            this.freeplayProgressWrap.classList.add('hidden');
            this.freeplayScoreRow.classList.add('hidden');
            this.updateClipDurationLabel(this.currentGuess);
            this.renderDailyGuessTrack();
            this.renderCounter(status.guessesRemaining);
            this.guessInputArea?.classList.remove('hidden');

            await this.preloadAudioClip(this.currentGuess);
            this.showGameArea();

            if (this.gameCompleted) {
                this.guessSearchInput.disabled = true;
                this.submitGuessBtn.disabled = true;
                this.guessInputArea?.classList.add('hidden');
                const tries = totalGuesses === 1 ? 'try' : 'tries';
                this.gameResult.classList.remove('hidden');
                this.gameResult.className = `game-result ${status.won ? 'won' : 'lost'}`;
                this.resultMessage.innerHTML = status.won
                    ? `Congratulations!<br>You guessed it in ${totalGuesses} ${tries}!<br>The song was: <strong>"${status.correctAnswer || 'Unknown'}"</strong>`
                    : `Game Over<br>The song was: <strong>"${status.correctAnswer || 'Unknown'}"</strong><br>Better luck next time!`;
                this.playAgainBtn.style.display = 'none';
                return;
            }

            this.guessSearchInput.focus();
        } catch {
            this.clearStoredDailySessionId();
            await this.startNewGame();
        }
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
        if (this.dailyModeBtn) {
            this.dailyModeBtn.classList.toggle('active', mode === 'daily');
        }
        if (this.freeplayModeBtn) {
            this.freeplayModeBtn.classList.toggle('active', mode === 'freeplay');
        }
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

    handlePlayAgain() {
        if (this.currentMode === 'freeplay') {
            this.resetGameState();
            this.setMode('freeplay');
            this.configureStartScreenForFreeplay();
            this.showStartScreen();
            return;
        }
        this.startNewGame();
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
            if (data.mode === 'daily') {
                this.storeDailySessionId(data.sessionId);
            }
            this.renderCounter();

            if (data.mode === 'freeplay') {
                this.setHistoryVisible(false);
                this.setDailyAudioVisible(false);
                this.setClipDurationVisible(true);
                await this.startFreeplayRound();
            } else {
                this.setHistoryVisible(true);
                this.setDailyAudioVisible(true);
                this.setClipDurationVisible(true);
                this.audioPlayer.controls = true;
                this.audioPlayer.style.display = '';
                this.freeplayProgressWrap.classList.add('hidden');
                this.freeplayScoreRow.classList.add('hidden');
                this.updateClipDurationLabel(this.currentGuess);
                this.renderDailyGuessTrack();
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
            this.updateDailyAudioUI();
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
            this.setDailyAudioVisible(false);
            this.audioPlayer.controls = false;
            this.audioPlayer.style.display = 'none';
            this.freeplayProgressWrap.classList.remove('hidden');
            this.freeplayScoreRow.classList.remove('hidden');
            this.renderCounter();
            this.renderFreeplayScore();
            this.guessSearchInput.disabled = false;
            this.guessSearchInput.focus();
            this.updateClipDurationLabel(6);
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
        const selectedSong = this.songsById.get(this.selectedSongId);
        if (!selectedSong || this.gameCompleted) {
            this.showError('Select a valid song from the list before submitting.');
            return;
        }

        this.submitGuessBtn.disabled = true;
        this.guessSearchInput.disabled = true;
        this.hideSuggestions();

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
            this.guessSearchInput.disabled = false;
        }
    }

    handleGuessResult(result) {
        if (this.currentMode === 'freeplay') {
            if (result.timedOut) {
                this.flashFreeplayFeedback(false);
            } else {
                this.flashFreeplayFeedback(result.correct === true);
            }
        }

        this.addGuessToTrack(result);
        this.renderCounter(result.guessesRemaining);
        this.guessSearchInput.value = '';
        this.selectedSongId = null;
        this.activeSuggestionIndex = -1;
        this.renderSongSuggestions('');
        this.guessSearchInput.disabled = false;
        this.submitGuessBtn.disabled = true;

        if (result.completed) {
            this.gameCompleted = true;
            this.guessSearchInput.disabled = true;
            this.guessInputArea?.classList.add('hidden');
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
                }, 500);
                return;
            }

            this.showGameResult(result);
        } else {
            if (this.currentMode === 'daily') {
                this.currentGuess++;
                this.updateClipDurationLabel(this.currentGuess);
                this.renderDailyGuessTrack();
                this.preloadAudioClip(this.currentGuess);
            }
            this.guessSearchInput.focus();
        }

        this.submitGuessBtn.disabled = this.gameCompleted;
    }

    addGuessToTrack(result) {
        if (result.timedOut) return;
        if (this.currentMode !== 'daily') return;

        this.dailyGuessHistory.push({
            guessNumber: result.guessNumber,
            guess: result.guess,
            matchLevel: result.matchLevel,
            feedbackText: this.getDailyFeedbackText(result.matchLevel)
        });
        this.renderDailyGuessTrack();
    }

    mapDailyGuessHistory(guesses) {
        return guesses.map((guess) => ({
            guessNumber: guess.guessNumber,
            guess: guess.guess,
            matchLevel: guess.matchLevel,
            feedbackText: this.getDailyFeedbackText(guess.matchLevel)
        }));
    }

    getDailyFeedbackText(matchLevel) {
        return matchLevel === 'correct_song'
            ? 'Correct song'
            : matchLevel === 'correct_album'
                ? 'Correct album'
                : 'Incorrect';
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
        this.dailyGuessHistory = [];
        this.clearFreeplayTimers();
        if (this.freeplayFeedbackTimeoutId) {
            clearTimeout(this.freeplayFeedbackTimeoutId);
            this.freeplayFeedbackTimeoutId = null;
        }

        if (this.preloadedAudioUrl) {
            URL.revokeObjectURL(this.preloadedAudioUrl);
            this.preloadedAudioUrl = null;
        }

        this.guessesRemaining.textContent = '6';
        this.clipDuration.textContent = '';
        this.guessSearchInput.value = '';
        this.selectedSongId = null;
        this.activeSuggestionIndex = -1;
        this.guessSearchInput.disabled = false;
        this.submitGuessBtn.disabled = true;
        this.guessInputArea?.classList.remove('hidden');
        this.audioPlayer.src = '';
        this.audioPlayer.style.display = '';
        this.audioPlayer.controls = true;
        this.audioPlayer.onended = null;
        this.updateDailyAudioUI();
        this.freeplayProgressWrap.classList.add('hidden');
        this.setFreeplayProgress(100);
        this.freeplayScoreRow.classList.add('hidden');
        this.freeplayOptions.classList.add('hidden');
        this.playAgainBtn.style.display = '';
        this.hideSuggestions();
        this.gameArea.classList.remove('freeplay-flash-win', 'freeplay-flash-loss');
        this.renderDailyGuessTrack();

        if (this.songsLoaded) {
            this.renderSongSuggestions('');
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

    getTodayUtcDateString() {
        return new Date().toISOString().split('T')[0];
    }

    getDailySessionStorageKey() {
        return `swiftle_daily_session_${this.getTodayUtcDateString()}`;
    }

    getStoredDailySessionId() {
        return localStorage.getItem(this.getDailySessionStorageKey());
    }

    storeDailySessionId(sessionId) {
        localStorage.setItem(this.getDailySessionStorageKey(), sessionId);
    }

    clearStoredDailySessionId() {
        localStorage.removeItem(this.getDailySessionStorageKey());
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
        return song.title;
    }

    getSelectedModeFromUI() {
        if (!this.dailyModeBtn || !this.freeplayModeBtn) {
            return this.currentMode;
        }
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
        this.renderSongSuggestions('');

        this.songsLoaded = true;
    }

    configureStartScreenForFreeplay() {
        const heading = this.startScreen.querySelector('h2');
        const description = this.startScreen.querySelector('p');
        if (heading) heading.textContent = 'Freeplay';
        if (description) {
            description.textContent =
                'Click start to hear a 6-second clip. If you get it before it ends, a new clip begins immediately. Guess as many as you can.';
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

    flashFreeplayFeedback(isSuccess) {
        if (!this.gameArea) return;
        if (this.freeplayFeedbackTimeoutId) {
            clearTimeout(this.freeplayFeedbackTimeoutId);
            this.freeplayFeedbackTimeoutId = null;
        }

        this.gameArea.classList.remove('freeplay-flash-win', 'freeplay-flash-loss');
        this.gameArea.classList.add(isSuccess ? 'freeplay-flash-win' : 'freeplay-flash-loss');

        this.freeplayFeedbackTimeoutId = setTimeout(() => {
            this.gameArea.classList.remove('freeplay-flash-win', 'freeplay-flash-loss');
            this.freeplayFeedbackTimeoutId = null;
        }, 500);
    }

    setDailyAudioVisible(visible) {
        if (!this.dailyAudioShell) return;
        this.dailyAudioShell.classList.toggle('hidden', !visible);
    }

    toggleDailyPlayback() {
        if (!this.audioPlayer || this.currentMode !== 'daily') return;
        if (this.audioPlayer.paused) {
            this.audioPlayer.play().catch(() => {});
        } else {
            this.audioPlayer.pause();
        }
    }

    seekDailyClip(event) {
        if (!this.audioPlayer || this.currentMode !== 'daily' || !this.dailyAudioProgress) return;
        const duration = Number.isFinite(this.audioPlayer.duration) ? this.audioPlayer.duration : 0;
        if (duration <= 0) return;

        const rect = this.dailyAudioProgress.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        const clamped = Math.max(0, Math.min(1, ratio));
        this.audioPlayer.currentTime = duration * clamped;
        this.updateDailyAudioUI();
    }

    updateDailyAudioUI() {
        if (!this.audioPlayer) return;
        const duration = Number.isFinite(this.audioPlayer.duration) ? this.audioPlayer.duration : 0;
        const current = Number.isFinite(this.audioPlayer.currentTime) ? this.audioPlayer.currentTime : 0;
        const progressPct = duration > 0 ? (current / duration) * 100 : 0;

        if (this.dailyAudioProgressFill) {
            this.dailyAudioProgressFill.style.width = `${Math.max(0, Math.min(100, progressPct))}%`;
        }
        if (this.dailyPlayPauseBtn) {
            this.dailyPlayPauseBtn.textContent = this.audioPlayer.paused ? 'PLAY' : 'PAUSE';
        }
        if (this.dailyAudioTime) {
            this.dailyAudioTime.textContent = `${this.formatTime(current)} / ${this.formatTime(duration)}`;
        }
    }

    formatTime(seconds) {
        const safe = Math.max(0, Math.floor(seconds || 0));
        const mins = Math.floor(safe / 60);
        const secs = String(safe % 60).padStart(2, '0');
        return `${mins}:${secs}`;
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
            this.guessSearchInput.disabled = true;

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
            this.guessCounter.classList.remove('hidden');
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

        this.guessCounter.classList.add('hidden');
        const remaining =
            guessesRemainingOverride !== undefined && guessesRemainingOverride !== null
                ? guessesRemainingOverride
                : this.maxGuesses;
        this.guessCounter.innerHTML = `Guesses remaining: <span id="guesses-remaining">${remaining}</span>`;
        this.guessesRemaining = this.guessCounter.querySelector('#guesses-remaining');
    }

    setHistoryVisible(visible) {
        if (!this.dailyGuessTrack) return;
        this.dailyGuessTrack.classList.toggle('hidden', !visible);
        if (!visible) {
            this.restoreGuessInputArea();
        }
    }

    restoreGuessInputArea() {
        if (!this.guessInputAnchor || !this.guessInputArea) return;
        const targetParent = this.guessInputAnchor.parentElement;
        if (this.guessInputArea.parentElement !== targetParent) {
            this.guessInputAnchor.insertAdjacentElement('afterend', this.guessInputArea);
        }
    }

    renderFreeplayScore() {
        this.freeplayScoreValue.textContent = String(this.freeplayScore);
        this.freeplayBestScoreValue.textContent = String(this.freeplayBestScore);
    }

    updateClipDurationLabel(revealedSeconds) {
        if (!this.clipDuration) return;
        const seconds = Math.max(1, Math.min(6, Number(revealedSeconds) || 1));
        this.clipDuration.textContent = `${seconds}s revealed`;
    }

    setClipDurationVisible(visible) {
        if (!this.audioInfo) return;
        this.audioInfo.classList.toggle('hidden', !visible);
    }

    getFreeplayHardMode() {
        return this.freeplayHardModeInput?.checked === true;
    }

    updateSubmitState() {
        const selectedSong = this.songsById.get(this.selectedSongId);
        this.submitGuessBtn.disabled = !selectedSong || this.gameCompleted || this.guessSearchInput.disabled;
    }

    normalizeSearch(value) {
        return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    getSongMatchScore(song, normalizedQuery) {
        if (!normalizedQuery) return 1000;

        const normalizedTitle = this.normalizeSearch(song.title);

        if (normalizedTitle === normalizedQuery) return 0;
        if (normalizedTitle.startsWith(normalizedQuery)) return 1;
        if (normalizedTitle.includes(normalizedQuery)) return 2;
        return null;
    }

    renderSongSuggestions(queryText) {
        if (!this.guessSuggestions) return;

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

        this.filteredSongs = ranked.map(({ song }) => song);

        if (this.filteredSongs.length > 0 && !this.filteredSongs.some((song) => song.id === this.selectedSongId)) {
            this.selectedSongId = this.filteredSongs[0].id;
            this.activeSuggestionIndex = 0;
        }
        if (this.filteredSongs.length === 0) {
            this.selectedSongId = null;
            this.activeSuggestionIndex = -1;
        }

        this.guessSuggestions.innerHTML = '';
        this.filteredSongs.forEach((song, index) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'guess-suggestion';
            if (song.id === this.selectedSongId || index === this.activeSuggestionIndex) {
                item.classList.add('active');
            }
            item.textContent = this.formatSongOption(song);
            item.addEventListener('click', () => {
                this.selectedSongId = song.id;
                this.guessSearchInput.value = song.title;
                this.activeSuggestionIndex = index;
                this.hideSuggestions();
                this.updateSubmitState();
            });
            this.guessSuggestions.appendChild(item);
        });

        if (document.activeElement === this.guessSearchInput && this.filteredSongs.length > 0) {
            this.guessSuggestions.classList.remove('hidden');
        } else {
            this.guessSuggestions.classList.add('hidden');
        }

        this.updateSubmitState();
    }

    moveSuggestionSelection(direction) {
        if (this.filteredSongs.length === 0) return;
        if (this.activeSuggestionIndex < 0) {
            this.activeSuggestionIndex = 0;
        } else {
            const max = this.filteredSongs.length - 1;
            this.activeSuggestionIndex = Math.max(0, Math.min(max, this.activeSuggestionIndex + direction));
        }
        const activeSong = this.filteredSongs[this.activeSuggestionIndex];
        this.selectedSongId = activeSong.id;
        this.guessSearchInput.value = activeSong.title;
        this.renderSongSuggestions(this.guessSearchInput.value);
    }

    hideSuggestions() {
        if (this.guessSuggestions) {
            this.guessSuggestions.classList.add('hidden');
        }
    }

    renderDailyGuessTrack() {
        if (!this.dailyGuessTrack || this.currentMode !== 'daily') {
            this.restoreGuessInputArea();
            return;
        }

        this.dailyGuessTrack.innerHTML = '';
        let mountedCurrentInput = false;
        for (let guessNumber = 1; guessNumber <= 6; guessNumber++) {
            const box = document.createElement('div');
            box.className = 'daily-guess-box';

            const previous = this.dailyGuessHistory.find((entry) => entry.guessNumber === guessNumber);
            if (previous) {
                box.classList.add(previous.matchLevel);
                box.innerHTML = `
                    <div class="daily-guess-header">Guess ${guessNumber}</div>
                    <div class="daily-guess-title">${previous.guess}</div>
                    <div class="daily-guess-status">${previous.feedbackText}</div>
                `;
            } else if (guessNumber === this.currentGuess && !this.gameCompleted) {
                box.classList.add('active');
                const guessesLeft = Math.max(0, this.maxGuesses - this.currentGuess + 1);
                box.innerHTML = `
                    <div class="daily-guess-header">Guess ${guessNumber}</div>
                    <div class="daily-guess-title"></div>
                    <div class="daily-guess-status">${this.currentGuess}s clip • ${guessesLeft} left</div>
                `;
                const inlineInputHost = document.createElement('div');
                inlineInputHost.className = 'daily-inline-guess-host';
                box.appendChild(inlineInputHost);
                if (this.guessInputArea) {
                    inlineInputHost.appendChild(this.guessInputArea);
                    mountedCurrentInput = true;
                }
            } else {
                box.innerHTML = `
                    <div class="daily-guess-header">Guess ${guessNumber}</div>
                    <div class="daily-guess-title"></div>
                `;
            }

            this.dailyGuessTrack.appendChild(box);
        }

        if (!mountedCurrentInput) {
            this.restoreGuessInputArea();
        }
    }
}
