const fs = require('fs');
const path = require('path');
const Database = require('../server/database');
const AudioProcessor = require('../server/audioProcessor');

async function setupDatabase() {
    console.log('Setting up Open Swiftle...');
    
    const db = new Database();
    const audioProcessor = new AudioProcessor();
    
    try {
        console.log('✓ Database initialized');
        
        // Scan for song files
        const songsDir = path.join(__dirname, '../songs');
        
        if (!fs.existsSync(songsDir)) {
            fs.mkdirSync(songsDir, { recursive: true });
            console.log(`✓ Created songs directory: ${songsDir}`);
        }
        
        const files = fs.readdirSync(songsDir).filter(file => 
            file.endsWith('.mp3') || file.endsWith('.wav')
        );
        
        if (files.length === 0) {
            console.log('⚠️  No song files found in songs/ directory');
            console.log('   Add MP3 or WAV files to songs/ and run this script again');
            console.log('   Files should be named: "Artist - Song Title.extension"');
            console.log('   Example: "Taylor Swift - Love Story.mp3"');
            return;
        }
        
        console.log(`Found ${files.length} song files:`);
        
        let added = 0;
        let skipped = 0;
        
        for (const filename of files) {
            try {
                // Parse filename to extract artist and title
                const nameWithoutExt = path.parse(filename).name;
                const parts = nameWithoutExt.split(' - ');
                
                let artist, title;
                if (parts.length >= 2) {
                    artist = parts[0].trim();
                    title = parts.slice(1).join(' - ').trim();
                } else {
                    // If no artist separator, assume it's all the title
                    artist = 'Taylor Swift';
                    title = nameWithoutExt;
                }
                
                // Get audio duration
                const filePath = path.join(songsDir, filename);
                const duration = await audioProcessor.getAudioDuration(filePath);
                
                // Check if song already exists
                const existingSongs = await db.getAllSongs();
                const exists = existingSongs.some(song => 
                    song.filename === filename ||
                    (song.artist === artist && song.title === title)
                );
                
                if (exists) {
                    console.log(`   Skipped: ${artist} - ${title} (already exists)`);
                    skipped++;
                } else {
                    await db.addSong(title, artist, filename, duration);
                    console.log(`   Added: ${artist} - ${title} (${Math.round(duration)}s)`);
                    added++;
                }
                
            } catch (error) {
                console.error(`   Error processing ${filename}:`, error.message);
            }
        }
        
        console.log(`\n✓ Setup complete!`);
        console.log(`   ${added} songs added`);
        console.log(`   ${skipped} songs skipped (duplicates)`);
        
        if (added > 0) {
            console.log('\n🎵 Ready to play! Run: npm start');
        }
        
    } catch (error) {
        console.error('Setup failed:', error);
    } finally {
        db.close();
    }
}

// Run setup if called directly
if (require.main === module) {
    setupDatabase().then(() => {
        process.exit(0);
    }).catch(error => {
        console.error('Setup failed:', error);
        process.exit(1);
    });
}

module.exports = setupDatabase;