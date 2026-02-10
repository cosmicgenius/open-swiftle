import { Database, Song } from './database';
import { ClipCache } from './clipCache';

interface FreeplayPoolOptions {
  cacheKey: string;
  ttlMs: number;
  refreshMs: number;
  minSize: number;
  maxSize: number;
  clipSeconds: number;
}

interface FreeplayEntry {
  song: Song;
  startTime: number;
  preparedAt: number;
  key: string;
}

export interface FreeplayRound {
  song: Song;
  startTime: number;
}

export class FreeplayPool {
  private readonly db: Database;
  private readonly clipCache: ClipCache;
  private readonly options: FreeplayPoolOptions;
  private entries: FreeplayEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private started = false;

  constructor(db: Database, clipCache: ClipCache, options: FreeplayPoolOptions) {
    this.db = db;
    this.clipCache = clipCache;
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.fillToMinSize();
    console.log(
      `Freeplay pool started: size=${this.entries.length}, refreshMs=${this.options.refreshMs}, ttlMs=${this.options.ttlMs}`
    );

    this.timer = setInterval(() => {
      void this.refreshTick();
    }, this.options.refreshMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
  }

  async getRound(): Promise<FreeplayRound> {
    if (!this.started) {
      await this.start();
    }

    this.pruneExpired();
    if (this.entries.length === 0) {
      await this.addEntry();
    }

    const idx = Math.floor(Math.random() * this.entries.length);
    const selected = this.entries[idx];
    return {
      song: selected.song,
      startTime: selected.startTime,
    };
  }

  private async refreshTick(): Promise<void> {
    try {
      const before = this.entries.length;
      this.pruneExpired();
      await this.addEntry();
      await this.fillToMinSize();

      if (this.entries.length > this.options.maxSize) {
        this.entries = this.entries.slice(this.entries.length - this.options.maxSize);
      }

      console.log(
        `Freeplay pool refresh tick: sizeBefore=${before}, sizeAfter=${this.entries.length}`
      );
    } catch (error) {
      console.error('Failed to refresh freeplay pool:', error);
    }
  }

  private async fillToMinSize(): Promise<void> {
    let attempts = 0;
    const maxAttempts = Math.max(this.options.minSize * 10, 50);
    while (this.entries.length < this.options.minSize && attempts < maxAttempts) {
      attempts += 1;
      await this.addEntry();
    }
  }

  private pruneExpired(): void {
    const now = Date.now();
    this.entries = this.entries.filter((entry) => now - entry.preparedAt <= this.options.ttlMs);
  }

  private async addEntry(): Promise<void> {
    const songs = await this.db.getAllSongs();
    if (songs.length === 0) {
      throw new Error('No songs available for freeplay pool');
    }

    const selection = this.pickRandomSongAndStart(songs);
    await this.clipCache.getClips(
      this.options.cacheKey,
      selection.song,
      selection.startTime,
      [this.options.clipSeconds],
      { ttlMs: this.options.ttlMs }
    );

    const key = `${selection.song.id}_${Math.floor(selection.startTime)}`;
    const existingIdx = this.entries.findIndex((entry) => entry.key === key);
    const newEntry: FreeplayEntry = {
      song: selection.song,
      startTime: selection.startTime,
      preparedAt: Date.now(),
      key,
    };

    if (existingIdx >= 0) {
      this.entries[existingIdx] = newEntry;
      console.log(`Freeplay pool refreshed entry: key=${key}`);
      return;
    }

    this.entries.push(newEntry);
    console.log(`Freeplay pool added entry: key=${key}, size=${this.entries.length}`);
  }

  private pickRandomSongAndStart(songs: Song[]): { song: Song; startTime: number } {
    const song = songs[Math.floor(Math.random() * songs.length)];
    const maxStartTime = Math.max(0, song.duration - (this.options.clipSeconds + 4));
    const startTime = Math.random() * maxStartTime;
    return { song, startTime };
  }
}
