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

  // Get or generate clips for a given cache key (date for daily, sessionId for freeplay)
  async getDailyClips(
    cacheKey: string,
    song: Song,
    startTime: number
  ): Promise<CachedClip[]> {
    const keyDir = path.join(this.cacheDir, cacheKey);
    const filePrefix = `${song.id}_${Math.floor(startTime)}`;

    await fs.mkdir(keyDir, { recursive: true });

    // Check if all 6 clips already exist
    const clips: CachedClip[] = [];
    let allExist = true;

    for (let duration = 1; duration <= 6; duration++) {
      const clipPath = path.join(keyDir, `${filePrefix}_${duration}s.json`);
      try {
        const raw = await fs.readFile(clipPath, 'utf8');
        clips.push({ duration, data: JSON.parse(raw), path: clipPath });
      } catch {
        allExist = false;
        break;
      }
    }

    if (allExist) return clips;

    // Generate all 6 clips
    console.log(`Generating clips for key=${cacheKey}, song=${song.title}...`);
    const newClips = await this.generateClips(song, startTime, 6);

    for (let i = 0; i < newClips.length; i++) {
      const clipPath = path.join(keyDir, `${filePrefix}_${i + 1}s.json`);
      await fs.writeFile(clipPath, JSON.stringify(newClips[i]));
    }

    return newClips.map((clip, i) => ({
      duration: i + 1,
      data: clip,
      path: path.join(keyDir, `${filePrefix}_${i + 1}s.json`),
    }));
  }

  private async generateClips(
    song: Song,
    startTime: number,
    maxDuration: number
  ): Promise<ClipData[]> {
    const sourceFile = path.join(__dirname, '../../songs', song.filename);

    if (!fsSync.existsSync(sourceFile)) {
      throw new Error(`Song file not found: ${song.filename}`);
    }

    const clips: ClipData[] = [];

    for (let duration = 1; duration <= maxDuration; duration++) {
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