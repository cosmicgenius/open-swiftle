const fs = require('fs');
const path = require('path');
const Database = require('../server/database');

async function importSpotifySongs() {
  console.log('Importing Spotify songs...');
  
  const db = new Database();
  
  try {
    // Look for songs.json file
    const songsFile = path.join(__dirname, '../songs.json');
    
    if (!fs.existsSync(songsFile)) {
      console.log('❌ No songs.json file found');
      console.log('📝 Please create songs.json with this format:');
      console.log(`{
  "songs": [
    {
      "title": "Love Story",
      "artist": "Taylor Swift",
      "album": "Fearless",
      "spotifyUri": "spotify:track:1vrd6UOGamcKNGnSHJQlSt",
      "trackId": "1vrd6UOGamcKNGnSHJQlSt",
      "durationMs": 235533,
      "previewUrl": "https://p.scdn.co/mp3-preview/...",
      "popularity": 85
    }
  ]
}`);
      return;
    }
    
    // Parse the JSON file
    const songsData = JSON.parse(fs.readFileSync(songsFile, 'utf8'));
    
    if (!songsData.songs || !Array.isArray(songsData.songs)) {
      throw new Error('Invalid songs.json format - expected { "songs": [...] }');
    }
    
    console.log(`Found ${songsData.songs.length} songs to import`);
    
    let added = 0;
    let skipped = 0;
    
    // Get existing songs to check for duplicates
    const existingSongs = await db.getAllSongs();
    const existingTrackIds = new Set(existingSongs.map(song => song.track_id));
    
    for (const song of songsData.songs) {
      try {
        // Validate required fields
        if (!song.title || !song.artist || !song.spotifyUri || !song.trackId) {
          console.log(`❌ Skipping song - missing required fields:`, song);
          continue;
        }
        
        // Check if already exists
        if (existingTrackIds.has(song.trackId)) {
          console.log(`⏭️  Skipped: ${song.artist} - ${song.title} (already exists)`);
          skipped++;
          continue;
        }
        
        // Import the song
        await db.addSong(
          song.title,
          song.artist,
          song.album || null,
          song.spotifyUri,
          song.trackId,
          song.durationMs || null,
          song.previewUrl || null,
          song.popularity || null
        );
        
        console.log(`✅ Added: ${song.artist} - ${song.title}`);
        added++;
        
      } catch (error) {
        console.error(`❌ Error adding ${song.title}:`, error.message);
      }
    }
    
    console.log(`\n🎵 Import complete!`);
    console.log(`   ${added} songs added`);
    console.log(`   ${skipped} songs skipped (duplicates)`);
    
    if (added > 0) {
      console.log('\n✅ Ready to play with Spotify! Run: npm start');
      console.log('🔑 Make sure to set up your Spotify app credentials in .env');
    }
    
  } catch (error) {
    console.error('❌ Import failed:', error.message);
    console.error('💡 Make sure songs.json has the correct format');
  } finally {
    db.close();
  }
}

// Run import if called directly
if (require.main === module) {
  importSpotifySongs().then(() => {
    process.exit(0);
  }).catch(error => {
    console.error('Import failed:', error);
    process.exit(1);
  });
}

module.exports = importSpotifySongs;