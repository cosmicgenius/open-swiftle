import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { Database } from '../server/database';

function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration ?? 0);
    });
  });
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

    const files = fs
      .readdirSync(songsDir)
      .filter((file) => file.endsWith('.mp3') || file.endsWith('.wav'));

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

    for (const filename of files) {
      try {
        const nameWithoutExt = path.parse(filename).name;
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

        const filePath = path.join(songsDir, filename);
        const duration = await getAudioDuration(filePath);

        const existingSongs = await db.getAllSongs();
        const exists = existingSongs.some(
          (song) =>
            song.filename === filename ||
            (song.artist === artist && song.title === title)
        );

        if (exists) {
          console.log(`  Skipped: ${artist} - ${title} (already exists)`);
          skipped++;
        } else {
          await db.addSong(title, artist, filename, duration);
          console.log(`  Added: ${artist} - ${title} (${Math.round(duration)}s)`);
          added++;
        }
      } catch (error: any) {
        console.error(`  Error processing ${filename}:`, error.message);
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