const crypto = require('crypto');

class GameLogic {
  constructor(database, audioProcessor) {
    this.db = database;
    this.audioProcessor = audioProcessor;
  }

  // Generate a consistent daily song based on date
  async getDailySong(date = null) {
    const gameDate = date || this.getTodayString();
    
    // Check if we already have a daily song for this date
    let dailySong = await this.db.getDailySong(gameDate);
    if (dailySong) {
      return dailySong;
    }

    // Generate new daily song
    const songs = await this.db.getAllSongs();
    if (songs.length === 0) {
      throw new Error('No songs available');
    }

    // Use date as seed for consistent randomization
    const seedValue = this.dateToSeed(gameDate);
    const songIndex = this.seededRandom(seedValue, 0, songs.length - 1);
    const selectedSong = songs[songIndex];

    // Generate random start time within the song (leave room for 6 seconds)
    const maxStartTime = Math.max(0, selectedSong.duration - 10); // 10 seconds buffer
    const startTime = this.seededRandom(seedValue + 1, 0, maxStartTime);

    // Save to database
    await this.db.setDailySong(gameDate, selectedSong.id, startTime);
    
    return {
      ...selectedSong,
      start_time: startTime,
      date: gameDate
    };
  }

  async getFreeplaySong() {
    const songs = await this.db.getAllSongs();
    if (songs.length === 0) {
      throw new Error('No songs available');
    }

    // Random selection for freeplay
    const songIndex = Math.floor(Math.random() * songs.length);
    const selectedSong = songs[songIndex];

    // Random start time
    const maxStartTime = Math.max(0, selectedSong.duration - 10);
    const startTime = Math.random() * maxStartTime;

    return {
      ...selectedSong,
      start_time: startTime
    };
  }

  async createGameSession(mode, clientId) {
    const sessionId = this.generateSessionId(clientId);
    
    let song;
    let gameDate = null;
    
    if (mode === 'daily') {
      song = await this.getDailySong();
      gameDate = this.getTodayString();
    } else {
      song = await this.getFreeplaySong();
    }

    const session = {
      id: sessionId,
      songId: song.id,
      mode,
      date: gameDate,
      guesses: [],
      completed: false,
      won: false,
      song: {
        id: song.id,
        title: song.title,
        artist: song.artist,
        startTime: song.start_time
      }
    };

    await this.db.saveGameSession(
      sessionId, 
      song.id, 
      mode, 
      gameDate, 
      [], 
      false, 
      false
    );

    return session;
  }

  async makeGuess(sessionId, guess) {
    const session = await this.db.getGameSession(sessionId);
    if (!session) {
      throw new Error('Game session not found');
    }

    if (session.completed) {
      throw new Error('Game already completed');
    }

    const song = await this.db.getSongById(session.song_id);
    if (!song) {
      throw new Error('Song not found');
    }

    const guesses = session.guesses || [];
    const guessNumber = guesses.length + 1;

    if (guessNumber > 6) {
      throw new Error('Maximum guesses exceeded');
    }

    const isCorrect = this.isCorrectGuess(guess.trim(), song.title);
    const completed = isCorrect || guessNumber >= 6;

    const guessResult = {
      guess: guess.trim(),
      correct: isCorrect,
      guessNumber
    };

    guesses.push(guessResult);

    await this.db.saveGameSession(
      sessionId,
      session.song_id,
      session.mode,
      session.date,
      guesses,
      completed,
      isCorrect
    );

    return {
      ...guessResult,
      completed,
      won: isCorrect,
      correctAnswer: completed ? song.title : null,
      totalGuesses: guesses.length
    };
  }

  isCorrectGuess(guess, correctTitle) {
    const normalize = (str) => str.toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ')     // Normalize whitespace
      .trim();

    const normalizedGuess = normalize(guess);
    const normalizedTitle = normalize(correctTitle);

    // Exact match
    if (normalizedGuess === normalizedTitle) {
      return true;
    }

    // Check if guess contains all significant words from title
    const guessWords = normalizedGuess.split(' ').filter(w => w.length > 2);
    const titleWords = normalizedTitle.split(' ').filter(w => w.length > 2);

    if (titleWords.length === 0) return false;

    const matchedWords = titleWords.filter(word => 
      guessWords.some(guessWord => 
        guessWord.includes(word) || word.includes(guessWord)
      )
    );

    return matchedWords.length >= Math.min(titleWords.length, 2);
  }

  generateSessionId(clientId) {
    const timestamp = Date.now();
    const random = Math.random().toString(36);
    return crypto.createHash('sha256')
      .update(`${clientId}_${timestamp}_${random}`)
      .digest('hex')
      .substring(0, 16);
  }

  getTodayString() {
    return new Date().toISOString().split('T')[0];
  }

  dateToSeed(dateString) {
    // Convert date + secret to a consistent seed
    const secret = process.env.DAILY_SEED_SECRET || 'default_secret_change_me';
    const combined = dateString + secret;
    
    // Create a more robust hash-based seed
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(combined).digest('hex');
    
    // Convert first 8 characters of hash to integer
    return parseInt(hash.substring(0, 8), 16);
  }

  seededRandom(seed, min, max) {
    // Simple seeded random number generator
    const x = Math.sin(seed) * 10000;
    const random = x - Math.floor(x);
    return Math.floor(random * (max - min + 1)) + min;
  }
}

module.exports = GameLogic;