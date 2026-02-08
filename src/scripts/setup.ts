import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { Database } from '../server/database';

interface SongFileEntry {
  absolutePath: string;
  relativePath: string;
}

function getAudioMetadata(filePath: string): Promise<{ duration: number; album: string | null }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      else {
        const rawAlbum = metadata.format.tags?.album ?? metadata.format.tags?.ALBUM ?? null;
        resolve({
          duration: metadata.format.duration ?? 0,
          album: typeof rawAlbum === 'string' ? rawAlbum.trim() || null : null,
        });
      }
    });
  });
}

function collectAudioFiles(baseDir: string): SongFileEntry[] {
  const entries: SongFileEntry[] = [];

  const walk = (currentDir: string) => {
    const dirEntries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of dirEntries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.mp3') && !entry.name.endsWith('.wav')) continue;

      const relativePath = path.relative(baseDir, absolutePath);
      entries.push({ absolutePath, relativePath });
    }
  };

  walk(baseDir);
  return entries;
}

async function setupDatabase(): Promise<void> {
  console.log('Setting up Open Swiftle...');

  const db = new Database();

  try {
    console.log('Database initialized');

    const songsDir = path.join(__dirname, '../../songs');

    if (!fs.existsSync(songsDir)) {
      fs.mkdirSync(songsDir, { recursive: true });
      console.log(`Created songs directory: ${songsDir}`);
    }

    const files = collectAudioFiles(songsDir);

    if (files.length === 0) {
      console.log('No song files found in songs/ directory');
      console.log('  Add MP3 or WAV files to songs/ and run this script again');
      console.log('  Files should be named: "Artist - Song Title.extension"');
      console.log('  Example: "Taylor Swift - Love Story.mp3"');
      return;
    }

    console.log(`Found ${files.length} song files:`);

    let added = 0;
    let skipped = 0;

    for (const file of files) {
      try {
        const normalizedRelativePath = file.relativePath.replace(/\\/g, '/');
        const nameWithoutExt = path.parse(normalizedRelativePath).name;
        const parts = nameWithoutExt.split(' - ');

        let artist: string;
        let title: string;

        if (parts.length >= 2) {
          artist = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
        } else {
          artist = 'Taylor Swift';
          title = nameWithoutExt;
        }

        const { duration, album: tagAlbum } = await getAudioMetadata(file.absolutePath);
        const topLevelDir = normalizedRelativePath.includes('/')
          ? normalizedRelativePath.split('/')[0]
          : null;
        const album = topLevelDir ?? tagAlbum;

        const existingSongs = await db.getAllSongs();
        const existingSong = existingSongs.find(
          (song) =>
            song.filename === normalizedRelativePath ||
            (song.artist === artist &&
              song.title === title &&
              (song.album ?? null) === (album ?? null))
        );

        if (existingSong) {
          if (!existingSong.album && album) {
            await db.updateSongAlbum(existingSong.id, album);
            console.log(`  Updated album: ${artist} - ${title} -> ${album}`);
          } else {
            console.log(`  Skipped: ${artist} - ${title} (already exists)`);
          }
          skipped++;
        } else {
          await db.addSong(title, artist, album, normalizedRelativePath, duration);
          const albumInfo = album ? ` | album: ${album}` : '';
          console.log(`  Added: ${artist} - ${title} (${Math.round(duration)}s)${albumInfo}`);
          added++;
        }
      } catch (error: any) {
        console.error(`  Error processing ${file.relativePath}:`, error.message);
      }
    }

    console.log(`\nSetup complete!`);
    console.log(`  ${added} songs added`);
    console.log(`  ${skipped} songs skipped (duplicates)`);

    if (added > 0) {
      console.log('\nReady to play! Run: npm start');
    }
  } catch (error) {
    console.error('Setup failed:', error);
  } finally {
    db.close();
  }
}

setupDatabase()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Setup failed:', error);
    process.exit(1);
  });
