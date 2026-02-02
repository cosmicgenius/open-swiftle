const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

const Database = require('./database');
const AudioProcessor = require('./audioProcessor');
const GameLogic = require('./gameLogic');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize components
const db = new Database();
const audioProcessor = new AudioProcessor();
const gameLogic = new GameLogic(db, audioProcessor);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/audio/clips', express.static('audio/clips'));

// Routes

// Start a new game
app.post('/api/game/start', async (req, res) => {
  try {
    const { mode = 'daily', clientId = 'anonymous' } = req.body;
    
    if (!['daily', 'freeplay'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid game mode' });
    }

    const session = await gameLogic.createGameSession(mode, clientId);
    
    res.json({
      sessionId: session.id,
      mode: session.mode,
      guessesRemaining: 6,
      completed: false
    });
  } catch (error) {
    console.error('Error starting game:', error);
    res.status(500).json({ error: 'Failed to start game' });
  }
});

// Get audio clip for current guess
app.get('/api/game/:sessionId/audio/:guessNumber', async (req, res) => {
  try {
    const { sessionId, guessNumber } = req.params;
    const guess = parseInt(guessNumber);
    
    if (guess < 1 || guess > 6) {
      return res.status(400).json({ error: 'Invalid guess number' });
    }

    const session = await db.getGameSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Game session not found' });
    }

    // Only allow access to clips up to current guess + 1
    const currentGuess = (session.guesses || []).length;
    if (guess > currentGuess + 1) {
      return res.status(403).json({ error: 'Cannot access future clips' });
    }

    const song = await db.getSongById(session.song_id);
    if (!song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Get daily song info for start time
    let startTime = 0;
    if (session.mode === 'daily') {
      const dailySong = await db.getDailySong(session.date);
      startTime = dailySong?.start_time || 0;
    } else {
      // For freeplay, we need to store start time in session or generate consistently
      // For now, use a simple hash of sessionId for consistency
      const sessionHash = require('crypto').createHash('md5').update(sessionId).digest('hex');
      const hashNum = parseInt(sessionHash.substring(0, 8), 16);
      startTime = (hashNum % Math.max(1, Math.floor(song.duration - 10))) || 0;
    }

    const sourceFile = path.join(__dirname, '../songs', song.filename);
    
    if (!fs.existsSync(sourceFile)) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    const clipFile = await audioProcessor.createClip(
      sourceFile, 
      song.id, 
      startTime, 
      guess, 
      guess
    );

    res.sendFile(clipFile);
  } catch (error) {
    console.error('Error serving audio:', error);
    res.status(500).json({ error: 'Failed to serve audio' });
  }
});

// Make a guess
app.post('/api/game/:sessionId/guess', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { guess } = req.body;

    if (!guess || typeof guess !== 'string') {
      return res.status(400).json({ error: 'Invalid guess' });
    }

    const result = await gameLogic.makeGuess(sessionId, guess);
    
    res.json({
      ...result,
      guessesRemaining: 6 - result.totalGuesses
    });
  } catch (error) {
    console.error('Error making guess:', error);
    
    if (error.message === 'Game session not found') {
      return res.status(404).json({ error: error.message });
    }
    
    if (error.message === 'Game already completed' || 
        error.message === 'Maximum guesses exceeded') {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to process guess' });
  }
});

// Get game status
app.get('/api/game/:sessionId/status', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await db.getGameSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Game session not found' });
    }

    const song = await db.getSongById(session.song_id);
    
    res.json({
      sessionId: session.id,
      mode: session.mode,
      guesses: session.guesses || [],
      guessesRemaining: 6 - (session.guesses || []).length,
      completed: session.completed,
      won: session.won,
      correctAnswer: session.completed ? song?.title : null
    });
  } catch (error) {
    console.error('Error getting game status:', error);
    res.status(500).json({ error: 'Failed to get game status' });
  }
});

// Get songs list (admin endpoint)
app.get('/api/admin/songs', async (req, res) => {
  try {
    const songs = await db.getAllSongs();
    res.json(songs);
  } catch (error) {
    console.error('Error getting songs:', error);
    res.status(500).json({ error: 'Failed to get songs' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Swiftle server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to play!`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  db.close();
  process.exit(0);
});

module.exports = app;