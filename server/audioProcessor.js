const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

class AudioProcessor {
  constructor() {
    this.clipsDir = path.join(__dirname, '../audio/clips');
    this.ensureClipsDirectory();
  }

  ensureClipsDirectory() {
    if (!fs.existsSync(this.clipsDir)) {
      fs.mkdirSync(this.clipsDir, { recursive: true });
    }
  }

  async createClip(sourceFile, songId, startTime, duration, guessNumber) {
    return new Promise((resolve, reject) => {
      const outputFile = path.join(this.clipsDir, `${songId}_${guessNumber}.mp3`);
      
      // Check if clip already exists
      if (fs.existsSync(outputFile)) {
        resolve(outputFile);
        return;
      }

      ffmpeg(sourceFile)
        .setStartTime(startTime)
        .setDuration(duration)
        .audioCodec('mp3')
        .audioBitrate(128)
        .output(outputFile)
        .on('end', () => {
          resolve(outputFile);
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          reject(err);
        })
        .run();
    });
  }

  async createAllClips(sourceFile, songId, startTime, maxDuration = 6) {
    const clips = [];
    
    for (let i = 1; i <= maxDuration; i++) {
      try {
        const clipPath = await this.createClip(sourceFile, songId, startTime, i, i);
        clips.push({
          guessNumber: i,
          duration: i,
          path: clipPath,
          url: `/audio/clips/${path.basename(clipPath)}`
        });
      } catch (error) {
        console.error(`Error creating clip ${i} for song ${songId}:`, error);
        throw error;
      }
    }
    
    return clips;
  }

  getAudioDuration(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
        } else {
          resolve(metadata.format.duration);
        }
      });
    });
  }

  cleanupClips(songId) {
    const clipPattern = path.join(this.clipsDir, `${songId}_*.mp3`);
    const glob = require('glob');
    
    glob(clipPattern, (err, files) => {
      if (err) {
        console.error('Error finding clips to cleanup:', err);
        return;
      }
      
      files.forEach(file => {
        fs.unlink(file, (unlinkErr) => {
          if (unlinkErr) {
            console.error('Error deleting clip:', unlinkErr);
          }
        });
      });
    });
  }
}

module.exports = AudioProcessor;