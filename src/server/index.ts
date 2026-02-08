import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

import { Database } from './database';
import { GameLogic } from './gameLogic';
import { ClipCache } from './clipCache';

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database();
const clipCache = new ClipCache();
const gameLogic = new GameLogic(db);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));

// Start a new game
app.post('/api/game/start', async (req, res) => {
  try {
    const { mode = 'daily', clientId = 'anonymous' } = req.body;

    if (mode !== 'daily' && mode !== 'freeplay') {
      return res.status(400).json({ error: 'Invalid game mode' });
    }

    const session = await gameLogic.createGameSession(mode, clientId);

    const maxGuesses = mode === 'freeplay' ? 1 : 6;
    res.json({
      sessionId: session.id,
      mode: session.mode,
      maxGuesses,
      guessesRemaining: maxGuesses,
      completed: false,
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
    const guess = parseInt(guessNumber, 10);

    if (guess < 1 || guess > 6) {
      return res.status(400).json({ error: 'Invalid guess number' });
    }

    const session = await db.getGameSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Game session not found' });
    }

    const currentGuess = (session.guesses ?? []).length;

    // Daily: can access clip for current guess + 1 (progressive reveal)
    // Freeplay: only clip 6 (the single 6s clip)
    if (session.mode === 'daily') {
      if (guess > currentGuess + 1) {
        return res.status(403).json({ error: 'Cannot access future clips' });
      }
    } else {
      if (guess !== 6) {
        return res.status(400).json({ error: 'Freeplay only has a 6s clip' });
      }
    }

    const song = await db.getSongById(session.song_id);
    if (!song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Both modes: use start_time stored on the session
    const startTime = session.start_time;
    const cacheKey = session.mode === 'daily' ? session.date! : session.id;
    const clips = await clipCache.getDailyClips(cacheKey, song, startTime);
    const clip = clips.find((c) => c.duration === guess);

    if (!clip?.data?.audioData) {
      return res.status(500).json({ error: 'Audio clip not available' });
    }

    const audioBuffer = Buffer.from(clip.data.audioData, 'base64');

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audioBuffer.length),
      'Cache-Control': 'public, max-age=3600',
    });

    res.send(audioBuffer);
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

    res.json({ ...result, guessesRemaining: 6 - result.totalGuesses });
  } catch (error: any) {
    console.error('Error making guess:', error);

    if (error.message === 'Game session not found') {
      return res.status(404).json({ error: error.message });
    }
    if (
      error.message === 'Game already completed' ||
      error.message === 'Maximum guesses exceeded'
    ) {
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
      guesses: session.guesses ?? [],
      guessesRemaining: 6 - (session.guesses ?? []).length,
      completed: session.completed,
      won: session.won,
      correctAnswer: session.completed ? song?.title : null,
    });
  } catch (error) {
    console.error('Error getting game status:', error);
    res.status(500).json({ error: 'Failed to get game status' });
  }
});

// Songs list (admin)
app.get('/api/admin/songs', async (_req, res) => {
  try {
    const songs = await db.getAllSongs();
    res.json(songs);
  } catch (error) {
    console.error('Error getting songs:', error);
    res.status(500).json({ error: 'Failed to get songs' });
  }
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Swiftle server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to play!`);

  // Freeplay clips are generated on-demand per session
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  db.close();
  clipCache.stop();
  process.exit(0);
});