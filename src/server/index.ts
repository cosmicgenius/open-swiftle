import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

import { Database } from './database';
import { GameLogic } from './gameLogic';
import { ClipCache } from './clipCache';
import { FreeplayPool } from './freeplayPool';

const app = express();
const PORT = process.env.PORT || 3000;

function installTimestampedConsoleLog(): void {
  const originalLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    originalLog(`[${new Date().toISOString()}]`, ...args);
  };
}

installTimestampedConsoleLog();

const db = new Database();
const clipCache = new ClipCache();
const gameLogic = new GameLogic(db);
const FREEPLAY_SHARED_CACHE_KEY = 'freeplay-shared';
const FREEPLAY_CLIP_TTL_MS = Number(process.env.FREEPLAY_CLIP_TTL_MS || 5 * 60 * 1000);
const FREEPLAY_POOL_REFRESH_MS = Number(process.env.FREEPLAY_POOL_REFRESH_MS || 5 * 60 * 1000);
const FREEPLAY_POOL_MIN_SIZE = Number(process.env.FREEPLAY_POOL_MIN_SIZE || 12);
const FREEPLAY_POOL_MAX_SIZE = Number(process.env.FREEPLAY_POOL_MAX_SIZE || 30);
const FREEPLAY_AUDIO_MAX_AGE_SECONDS = Number(process.env.FREEPLAY_AUDIO_MAX_AGE_SECONDS || 60);
const freeplayPool = new FreeplayPool(db, clipCache, {
  cacheKey: FREEPLAY_SHARED_CACHE_KEY,
  ttlMs: FREEPLAY_CLIP_TTL_MS,
  refreshMs: FREEPLAY_POOL_REFRESH_MS,
  minSize: FREEPLAY_POOL_MIN_SIZE,
  maxSize: FREEPLAY_POOL_MAX_SIZE,
});

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

function createRateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, RateLimitEntry>();

  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    current.count += 1;
    if (current.count > maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Rate limit exceeded. Please retry shortly.' });
      return;
    }

    next();
  };
}

const startLimiter = createRateLimiter(30, 60_000);
const audioLimiter = createRateLimiter(180, 60_000);
const guessLimiter = createRateLimiter(60, 60_000);
const timeoutLimiter = createRateLimiter(60, 60_000);
const statusLimiter = createRateLimiter(120, 60_000);
const songsLimiter = createRateLimiter(30, 60_000);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));
app.set('trust proxy', 1);

// Start a new game
app.post('/api/game/start', startLimiter, async (req, res) => {
  try {
    const { mode = 'daily', clientId = 'anonymous', freeplayHard = false } = req.body;

    if (mode !== 'daily' && mode !== 'freeplay') {
      return res.status(400).json({ error: 'Invalid game mode' });
    }

    const freeplayRound =
      mode === 'freeplay'
        ? await freeplayPool.getRound()
        : undefined;
    const session = await gameLogic.createGameSession(mode, clientId, {
      freeplayHard: Boolean(freeplayHard),
      freeplayRound,
    });

    const maxGuesses = mode === 'daily' ? 6 : session.freeplayHard ? 1 : null;
    res.json({
      sessionId: session.id,
      mode: session.mode,
      freeplayHard: session.freeplayHard,
      maxGuesses,
      guessesRemaining: maxGuesses === null ? null : maxGuesses,
      completed: false,
    });
  } catch (error) {
    console.error('Error starting game:', error);
    res.status(500).json({ error: 'Failed to start game' });
  }
});

// Get audio clip for current guess
app.get('/api/game/:sessionId/audio/:guessNumber', audioLimiter, async (req, res) => {
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
    const cacheKey = session.mode === 'daily' ? session.date! : FREEPLAY_SHARED_CACHE_KEY;
    const clipDurations = session.mode === 'daily' ? [1, 2, 3, 4, 5, 6] : [6];
    const clips = await clipCache.getClips(cacheKey, song, startTime, clipDurations, {
      ttlMs: session.mode === 'freeplay' ? FREEPLAY_CLIP_TTL_MS : undefined,
    });
    const clip = clips.find((c) => c.duration === guess);

    if (!clip?.data?.audioData) {
      return res.status(500).json({ error: 'Audio clip not available' });
    }

    const audioBuffer = Buffer.from(clip.data.audioData, 'base64');

    const maxAgeSeconds =
      session.mode === 'freeplay' ? FREEPLAY_AUDIO_MAX_AGE_SECONDS : 3600;
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audioBuffer.length),
      'Cache-Control': `public, max-age=${maxAgeSeconds}`,
    });

    res.send(audioBuffer);
  } catch (error) {
    console.error('Error serving audio:', error);
    res.status(500).json({ error: 'Failed to serve audio' });
  }
});

// Make a guess
app.post('/api/game/:sessionId/guess', guessLimiter, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { guessSongId } = req.body;
    const parsedGuessSongId = Number(guessSongId);

    if (!Number.isInteger(parsedGuessSongId) || parsedGuessSongId <= 0) {
      return res.status(400).json({ error: 'Invalid guess. Select a song from the list.' });
    }

    const guessedSong = await db.getSongById(parsedGuessSongId);
    if (!guessedSong) {
      return res.status(400).json({ error: 'Invalid guess. Song does not exist.' });
    }

    const result = await gameLogic.makeGuess(sessionId, guessedSong);
    res.json({
      ...result,
      guessesRemaining:
        result.maxGuesses === null
          ? null
          : Math.max(0, result.maxGuesses - result.totalGuesses),
    });
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

// Expire a session (used for freeplay round timeout)
app.post('/api/game/:sessionId/timeout', timeoutLimiter, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await db.getGameSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Game session not found' });
    }
    if (session.mode !== 'freeplay') {
      return res.status(400).json({ error: 'Timeout endpoint is only valid for freeplay mode' });
    }

    const result = await gameLogic.expireSession(sessionId);
    res.json({
      ...result,
      guessesRemaining:
        result.maxGuesses === null
          ? null
          : Math.max(0, result.maxGuesses - result.totalGuesses),
    });
  } catch (error: any) {
    console.error('Error expiring session:', error);

    if (error.message === 'Game session not found') {
      return res.status(404).json({ error: error.message });
    }
    if (
      error.message === 'Game already completed' ||
      error.message === 'Maximum guesses exceeded'
    ) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to expire session' });
  }
});

// Get game status
app.get('/api/game/:sessionId/status', statusLimiter, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await db.getGameSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Game session not found' });
    }

    const song = await db.getSongById(session.song_id);
    const maxGuesses = session.mode === 'daily' ? 6 : session.freeplay_hard ? 1 : null;

    res.json({
      sessionId: session.id,
      mode: session.mode,
      freeplayHard: session.freeplay_hard,
      guesses: session.guesses ?? [],
      maxGuesses,
      guessesRemaining:
        maxGuesses === null ? null : Math.max(0, maxGuesses - (session.guesses ?? []).length),
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
app.get('/api/admin/songs', songsLimiter, async (_req, res) => {
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

// Serve frontend routes
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

app.get('/freeplay', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../public/freeplay.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Swiftle server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to play!`);
  void freeplayPool.start().catch((error) => {
    console.error('Failed to start freeplay pool:', error);
  });
  console.log(
    `Freeplay pool active (shared cache key="${FREEPLAY_SHARED_CACHE_KEY}", ttl=${FREEPLAY_CLIP_TTL_MS}ms, refresh=${FREEPLAY_POOL_REFRESH_MS}ms)`
  );
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  freeplayPool.stop();
  db.close();
  clipCache.stop();
  process.exit(0);
});
