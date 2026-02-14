import fs from 'fs/promises';
import path from 'path';

import { Database, Song } from './database';
import { ClipCache } from './clipCache';

interface FreeplayCacheOptions {
  cacheKey: string;
  clipSeconds: number;
  warmupIntervalMs: number;
}

interface FreeplayCachedEntry {
  songId: number;
  startTime: number;
  key: string;
}

export interface FreeplayRound {
  song: Song;
  startTime: number;
}

export class FreeplayCache {
  private readonly db: Database;
  private readonly clipCache: ClipCache;
  private readonly options: FreeplayCacheOptions;
  private readonly cacheKeyDir: string;

  private started = false;
  private warmupTimer: NodeJS.Timeout | null = null;
  private warmupRunning = false;

  private songsById = new Map<number, Song>();
  private availableEntries: FreeplayCachedEntry[] = [];
  private availableKeys = new Set<string>();
  private warmupQueue: FreeplayCachedEntry[] = [];

  constructor(db: Database, clipCache: ClipCache, options: FreeplayCacheOptions) {
    this.db = db;
    this.clipCache = clipCache;
    this.options = options;
    this.cacheKeyDir = path.join(__dirname, '../../audio/cache', options.cacheKey);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await fs.mkdir(this.cacheKeyDir, { recursive: true });
    await this.loadSongs();
    await this.loadExistingCacheEntries();
    this.buildWarmupQueue();

    console.log(
      `Freeplay cache started: available=${this.availableEntries.length}, pendingWarmup=${this.warmupQueue.length}, warmupIntervalMs=${this.options.warmupIntervalMs}`
    );

    if (this.options.warmupIntervalMs > 0 && this.warmupQueue.length > 0) {
      this.warmupTimer = setInterval(() => {
        void this.runWarmupTick();
      }, this.options.warmupIntervalMs);
    }
  }

  stop(): void {
    if (this.warmupTimer) {
      clearInterval(this.warmupTimer);
      this.warmupTimer = null;
    }
    this.started = false;
  }

  async getRound(): Promise<FreeplayRound> {
    if (!this.started) {
      await this.start();
    }

    if (this.availableEntries.length === 0) {
      throw new Error('No freeplay clips cached yet');
    }

    const idx = Math.floor(Math.random() * this.availableEntries.length);
    const selected = this.availableEntries[idx];
    const song = this.songsById.get(selected.songId);

    if (!song) {
      throw new Error(`Cached freeplay entry references missing song id=${selected.songId}`);
    }

    return {
      song,
      startTime: selected.startTime,
    };
  }

  private async loadSongs(): Promise<void> {
    const songs = await this.db.getAllSongs();
    this.songsById = new Map(songs.map((song) => [song.id, song]));
  }

  private async loadExistingCacheEntries(): Promise<void> {
    const files = await fs.readdir(this.cacheKeyDir, { withFileTypes: true });
    this.availableEntries = [];
    this.availableKeys = new Set<string>();

    for (const file of files) {
      if (!file.isFile()) continue;
      const parsed = this.parseClipFilename(file.name);
      if (!parsed) continue;
      if (parsed.duration !== this.options.clipSeconds) continue;
      if (!this.songsById.has(parsed.songId)) continue;

      const entry: FreeplayCachedEntry = {
        songId: parsed.songId,
        startTime: parsed.startTime,
        key: this.entryKey(parsed.songId, parsed.startTime),
      };

      if (this.availableKeys.has(entry.key)) continue;
      this.availableKeys.add(entry.key);
      this.availableEntries.push(entry);
    }
  }

  private buildWarmupQueue(): void {
    this.warmupQueue = [];

    for (const song of this.songsById.values()) {
      const maxStartTime = Math.max(0, song.duration - (this.options.clipSeconds + 4));
      const maxStartSecond = Math.floor(maxStartTime);

      for (let startTime = 0; startTime <= maxStartSecond; startTime += 1) {
        const key = this.entryKey(song.id, startTime);
        if (this.availableKeys.has(key)) continue;

        this.warmupQueue.push({
          songId: song.id,
          startTime,
          key,
        });
      }
    }

    this.shuffle(this.warmupQueue);
  }

  private async runWarmupTick(): Promise<void> {
    if (this.warmupRunning) return;
    if (this.warmupQueue.length === 0) {
      if (this.warmupTimer) {
        clearInterval(this.warmupTimer);
        this.warmupTimer = null;
      }
      console.log('Freeplay cache warmup complete');
      return;
    }

    this.warmupRunning = true;
    try {
      const next = this.warmupQueue.shift();
      if (!next) return;

      const song = this.songsById.get(next.songId);
      if (!song) return;

      await this.clipCache.getClips(
        this.options.cacheKey,
        song,
        next.startTime,
        [this.options.clipSeconds]
      );

      if (!this.availableKeys.has(next.key)) {
        this.availableKeys.add(next.key);
        this.availableEntries.push(next);
      }

      if (this.availableEntries.length % 100 === 0 || this.warmupQueue.length === 0) {
        console.log(
          `Freeplay cache warmup progress: available=${this.availableEntries.length}, pending=${this.warmupQueue.length}`
        );
      }
    } catch (error) {
      console.error('Failed freeplay cache warmup tick:', error);
    } finally {
      this.warmupRunning = false;
    }
  }

  private parseClipFilename(filename: string): { songId: number; startTime: number; duration: number } | null {
    const match = filename.match(/^(\d+)_(\d+)_(\d+)s\.json$/);
    if (!match) return null;

    const songId = Number(match[1]);
    const startTime = Number(match[2]);
    const duration = Number(match[3]);

    if (!Number.isInteger(songId) || songId <= 0) return null;
    if (!Number.isInteger(startTime) || startTime < 0) return null;
    if (!Number.isInteger(duration) || duration <= 0) return null;

    return { songId, startTime, duration };
  }

  private entryKey(songId: number, startTime: number): string {
    return `${songId}_${startTime}`;
  }

  private shuffle<T>(items: T[]): void {
    for (let idx = items.length - 1; idx > 0; idx -= 1) {
      const swapIdx = Math.floor(Math.random() * (idx + 1));
      const temp = items[idx];
      items[idx] = items[swapIdx];
      items[swapIdx] = temp;
    }
  }
}
