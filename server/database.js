const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor() {
    this.db = new sqlite3.Database(path.join(__dirname, '../game.db'));
    this.init();
  }

  init() {
    this.db.serialize(() => {
      this.db.run(`CREATE TABLE IF NOT EXISTS songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        filename TEXT NOT NULL,
        duration REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      this.db.run(`CREATE TABLE IF NOT EXISTS game_sessions (
        id TEXT PRIMARY KEY,
        song_id INTEGER,
        mode TEXT NOT NULL,
        date TEXT,
        guesses TEXT,
        completed BOOLEAN DEFAULT FALSE,
        won BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (song_id) REFERENCES songs (id)
      )`);

      this.db.run(`CREATE TABLE IF NOT EXISTS daily_songs (
        date TEXT PRIMARY KEY,
        song_id INTEGER,
        start_time REAL,
        FOREIGN KEY (song_id) REFERENCES songs (id)
      )`);
    });
  }

  addSong(title, artist, filename, duration) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`INSERT INTO songs (title, artist, filename, duration) VALUES (?, ?, ?, ?)`);
      stmt.run([title, artist, filename, duration], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
      stmt.finalize();
    });
  }

  getAllSongs() {
    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM songs ORDER BY artist, title`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  getSongById(id) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM songs WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  getDailySong(date) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT ds.*, s.* FROM daily_songs ds 
                   JOIN songs s ON ds.song_id = s.id 
                   WHERE ds.date = ?`, [date], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  setDailySong(date, songId, startTime) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`INSERT OR REPLACE INTO daily_songs (date, song_id, start_time) VALUES (?, ?, ?)`);
      stmt.run([date, songId, startTime], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
      stmt.finalize();
    });
  }

  saveGameSession(sessionId, songId, mode, date, guesses, completed, won) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`INSERT OR REPLACE INTO game_sessions 
                                   (id, song_id, mode, date, guesses, completed, won) 
                                   VALUES (?, ?, ?, ?, ?, ?, ?)`);
      stmt.run([sessionId, songId, mode, date, JSON.stringify(guesses), completed, won], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
      stmt.finalize();
    });
  }

  getGameSession(sessionId) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM game_sessions WHERE id = ?`, [sessionId], (err, row) => {
        if (err) reject(err);
        else {
          if (row && row.guesses) {
            row.guesses = JSON.parse(row.guesses);
          }
          resolve(row);
        }
      });
    });
  }

  close() {
    this.db.close();
  }
}

module.exports = Database;