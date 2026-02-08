import crypto from 'crypto';
import { Database, Song, GuessResult, DailySong } from './database';

interface SessionSong {
  id: number;
  title: string;
  artist: string;
  startTime: number;
}

interface GameSessionData {
  id: string;
  songId: number;
  mode: 'daily' | 'freeplay';
  freeplayHard: boolean;
  date: string | null;
  guesses: GuessResult[];
  completed: boolean;
  won: boolean;
  song: SessionSong;
}

export interface GuessResponse extends GuessResult {
  completed: boolean;
  won: boolean;
  timedOut: boolean;
  correctAnswer: string | null;
  correctSong:
    | {
      title: string;
      artist: string;
      album: string | null;
    }
    | null;
  totalGuesses: number;
  maxGuesses: number | null;
}

export class GameLogic {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async getDailySong(date?: string): Promise<DailySong> {
    const gameDate = date ?? this.getTodayString();

    const existing = await this.db.getDailySong(gameDate);
    if (existing) return existing;

    const songs = await this.db.getAllSongs();
    if (songs.length === 0) throw new Error('No songs available');

    const seedValue = this.dateToSeed(gameDate);
    const songIndex = this.seededRandom(seedValue, 0, songs.length - 1);
    const selectedSong = songs[songIndex];

    const maxStartTime = Math.max(0, selectedSong.duration - 10);
    const startTime = this.seededRandom(seedValue + 1, 0, maxStartTime);

    await this.db.setDailySong(gameDate, selectedSong.id, startTime);
    const saved = await this.db.getDailySong(gameDate);
    if (saved) return saved;

    return { ...selectedSong, start_time: startTime, date: gameDate };
  }

  async getFreeplaySong(): Promise<Song & { start_time: number }> {
    const songs = await this.db.getAllSongs();
    if (songs.length === 0) throw new Error('No songs available');

    const song = songs[Math.floor(Math.random() * songs.length)];
    const maxStartTime = Math.max(0, song.duration - 10);
    const startTime = Math.random() * maxStartTime;

    return { ...song, start_time: startTime };
  }

  async createGameSession(
    mode: 'daily' | 'freeplay',
    clientId: string,
    options?: { freeplayHard?: boolean }
  ): Promise<GameSessionData> {
    const sessionId = this.generateSessionId(clientId);
    const freeplayHard = mode === 'freeplay' && options?.freeplayHard === true;

    let song: Song & { start_time: number };
    let gameDate: string | null = null;

    if (mode === 'daily') {
      song = await this.getDailySong();
      gameDate = this.getTodayString();
    } else {
      song = await this.getFreeplaySong();
    }

    const session: GameSessionData = {
      id: sessionId,
      songId: song.id,
      mode,
      freeplayHard,
      date: gameDate,
      guesses: [],
      completed: false,
      won: false,
      song: {
        id: song.id,
        title: song.title,
        artist: song.artist,
        startTime: song.start_time,
      },
    };

    await this.db.saveGameSession(
      sessionId, song.id, mode, freeplayHard, gameDate, song.start_time, [], false, false
    );

    return session;
  }

  async makeGuess(sessionId: string, guessedSong: Song): Promise<GuessResponse> {
    const session = await this.db.getGameSession(sessionId);
    if (!session) throw new Error('Game session not found');
    if (session.completed) throw new Error('Game already completed');

    const song = await this.db.getSongById(session.song_id);
    if (!song) throw new Error('Song not found');

    const guesses = session.guesses ?? [];
    const guessNumber = guesses.length + 1;
    const maxGuesses = this.getMaxGuesses(session.mode, session.freeplay_hard);
    if (maxGuesses !== null && guessNumber > maxGuesses) {
      throw new Error('Maximum guesses exceeded');
    }

    const isCorrect = guessedSong.id === song.id;
    const albumMatch =
      !isCorrect &&
      this.hasAlbum(guessedSong.album) &&
      this.hasAlbum(song.album) &&
      this.normalize(guessedSong.album) === this.normalize(song.album);
    const matchLevel: GuessResult['matchLevel'] = isCorrect
      ? 'correct_song'
      : albumMatch
        ? 'correct_album'
        : 'incorrect';
    const completed = isCorrect || (maxGuesses !== null && guessNumber >= maxGuesses);

    const guessResult: GuessResult = {
      guess: guessedSong.title,
      guessSongId: guessedSong.id,
      guessAlbum: guessedSong.album,
      matchLevel,
      correct: isCorrect,
      guessNumber,
    };

    guesses.push(guessResult);

    await this.db.saveGameSession(
      sessionId,
      session.song_id,
      session.mode,
      session.freeplay_hard,
      session.date,
      session.start_time,
      guesses,
      completed,
      isCorrect
    );

    return {
      ...guessResult,
      completed,
      won: isCorrect,
      timedOut: false,
      correctAnswer: completed ? song.title : null,
      correctSong: completed
        ? {
          title: song.title,
          artist: song.artist,
          album: song.album,
        }
        : null,
      totalGuesses: guesses.length,
      maxGuesses,
    };
  }

  async expireSession(sessionId: string): Promise<GuessResponse> {
    const session = await this.db.getGameSession(sessionId);
    if (!session) throw new Error('Game session not found');
    if (session.completed) throw new Error('Game already completed');

    const song = await this.db.getSongById(session.song_id);
    if (!song) throw new Error('Song not found');

    const guesses = session.guesses ?? [];
    const guessNumber = guesses.length + 1;
    const maxGuesses = this.getMaxGuesses(session.mode, session.freeplay_hard);
    if (maxGuesses !== null && guessNumber > maxGuesses) {
      throw new Error('Maximum guesses exceeded');
    }

    const guessResult: GuessResult = {
      guess: '(No guess)',
      guessSongId: -1,
      guessAlbum: null,
      matchLevel: 'incorrect',
      correct: false,
      guessNumber,
    };

    guesses.push(guessResult);

    await this.db.saveGameSession(
      sessionId,
      session.song_id,
      session.mode,
      session.freeplay_hard,
      session.date,
      session.start_time,
      guesses,
      true,
      false
    );

    return {
      ...guessResult,
      completed: true,
      won: false,
      timedOut: true,
      correctAnswer: song.title,
      correctSong: {
        title: song.title,
        artist: song.artist,
        album: song.album,
      },
      totalGuesses: guesses.length,
      maxGuesses,
    };
  }

  private getMaxGuesses(mode: 'daily' | 'freeplay', freeplayHard: boolean): number | null {
    if (mode === 'daily') return 6;
    return freeplayHard ? 1 : null;
  }

  private normalize(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase();
  }

  private hasAlbum(value: string | null | undefined): boolean {
    return this.normalize(value).length > 0;
  }

  private generateSessionId(clientId: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36);
    return crypto
      .createHash('sha256')
      .update(`${clientId}_${timestamp}_${random}`)
      .digest('hex')
      .substring(0, 16);
  }

  private getTodayString(): string {
    return new Date().toISOString().split('T')[0];
  }

  private dateToSeed(dateString: string): number {
    const secret = process.env.DAILY_SEED_SECRET || 'default_secret_change_me';
    const hash = crypto
      .createHash('sha256')
      .update(dateString + secret)
      .digest('hex');
    return parseInt(hash.substring(0, 8), 16);
  }

  private seededRandom(seed: number, min: number, max: number): number {
    const x = Math.sin(seed) * 10000;
    const random = x - Math.floor(x);
    return Math.floor(random * (max - min + 1)) + min;
  }
}
