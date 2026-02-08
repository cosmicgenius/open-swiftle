import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { Song } from './database';

export interface ClipData {
  songId: number;
  startTime: number;
  duration: number;
  audioData: string; // base64 encoded
  generatedAt: string;
  format: string;
  size: number;
}

export interface CachedClip {
  duration: number;
  data: ClipData;
  path: string;
}

export interface ClipCacheOptions {
  ttlMs?: number;
}

export class ClipCache {
  private cacheDir: string;

  constructor() {
    this.cacheDir = path.join(__dirname, '../../audio/cache');
    this.initializeCache();
  }

  private async initializeCache(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      console.log('Clip cache initialized');
    } catch (error) {
      console.error('Failed to initialize clip cache:', error);
    }
  }

  // Get or generate clips for a given cache key (for example: date for daily, shared key for freeplay)
  async getClips(
    cacheKey: string,
    song: Song,
    startTime: number,
    durations: number[],
    options?: ClipCacheOptions
  ): Promise<CachedClip[]> {
    const keyDir = path.join(this.cacheDir, cacheKey);
    const filePrefix = `${song.id}_${Math.floor(startTime)}`;
    const sortedDurations = [...durations].sort((a, b) => a - b);

    await fs.mkdir(keyDir, { recursive: true });

    // Check if all requested clips already exist
    const clips: CachedClip[] = [];
    const missing: number[] = [];

    for (const duration of sortedDurations) {
      const clipPath = path.join(keyDir, `${filePrefix}_${duration}s.json`);
      try {
        const raw = await fs.readFile(clipPath, 'utf8');
        const parsed = JSON.parse(raw) as ClipData;
        if (this.isExpired(parsed.generatedAt, options?.ttlMs)) {
          missing.push(duration);
          continue;
        }
        clips.push({ duration, data: parsed, path: clipPath });
      } catch {
        missing.push(duration);
      }
    }

    if (missing.length === 0) return clips;

    console.log(
      `Generating clips for key=${cacheKey}, song=${song.title}, durations=${missing.join(',')}...`
    );
    const newClips = await this.generateClips(song, startTime, missing);

    for (const clip of newClips) {
      const clipPath = path.join(keyDir, `${filePrefix}_${clip.duration}s.json`);
      await fs.writeFile(clipPath, JSON.stringify(clip));
      clips.push({
        duration: clip.duration,
        data: clip,
        path: clipPath,
      });
    }

    return clips.sort((a, b) => a.duration - b.duration);
  }

  private isExpired(generatedAt: string | undefined, ttlMs: number | undefined): boolean {
    if (!ttlMs || ttlMs <= 0) return false;
    if (!generatedAt) return true;
    const generatedAtMs = Date.parse(generatedAt);
    if (!Number.isFinite(generatedAtMs)) return true;
    return Date.now() - generatedAtMs > ttlMs;
  }

  private async generateClips(
    song: Song,
    startTime: number,
    durations: number[]
  ): Promise<ClipData[]> {
    const sourceFile = path.join(__dirname, '../../songs', song.filename);

    if (!fsSync.existsSync(sourceFile)) {
      throw new Error(`Song file not found: ${song.filename}`);
    }

    const clips: ClipData[] = [];

    for (const duration of durations) {
      const audioBuffer = await this.extractClip(sourceFile, startTime, duration);

      clips.push({
        songId: song.id,
        startTime,
        duration,
        audioData: audioBuffer.toString('base64'),
        generatedAt: new Date().toISOString(),
        format: 'mp3',
        size: audioBuffer.length,
      });
    }

    console.log(`Generated ${clips.length} clips for: ${song.artist} - ${song.title}`);
    return clips;
  }

  private extractClip(
    sourceFile: string,
    startTime: number,
    duration: number
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      ffmpeg(sourceFile)
        .setStartTime(startTime)
        .setDuration(duration)
        .audioCodec('libmp3lame')
        .audioBitrate(128)
        .audioChannels(2)
        .audioFrequency(44100)
        .format('mp3')
        .on('error', (err) => reject(err))
        .pipe()
        .on('data', (chunk: Buffer) => chunks.push(chunk))
        .on('end', () => resolve(Buffer.concat(chunks)))
        .on('error', (err: Error) => reject(err));
    });
  }

  stop(): void {
    // No background processes to stop anymore
  }
}
