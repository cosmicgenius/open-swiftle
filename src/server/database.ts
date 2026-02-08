import sqlite3 from 'sqlite3';
import path from 'path';

export interface Song {
  id: number;
  title: string;
  artist: string;
  filename: string;
  duration: number;
  created_at?: string;
}

export interface GameSession {
  id: string;
  song_id: number;
  mode: 'daily' | 'freeplay';
  date: string | null;
  start_time: number;
  guesses: GuessResult[];
  completed: boolean;
  won: boolean;
  created_at?: string;
}

export interface GuessResult {
  guess: string;
  correct: boolean;
  guessNumber: number;
}

export interface DailySong extends Song {
  start_time: number;
  date: string;
}

export class Database {
  private db: sqlite3.Database;

  constructor() {
    const verbose = sqlite3.verbose();
    this.db = new verbose.Database(
      path.join(__dirname, '../../game.db')
    );
    this.init();
  }

  private init(): void {
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
        start_time REAL NOT NULL DEFAULT 0,
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

  addSong(title: string, artist: string, filename: string, duration: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(
        `INSERT INTO songs (title, artist, filename, duration) VALUES (?, ?, ?, ?)`
      );
      stmt.run([title, artist, filename, duration], function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
      stmt.finalize();
    });
  }

  getAllSongs(): Promise<Song[]> {
    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM songs ORDER BY artist, title`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows as Song[]);
      });
    });
  }

  getSongById(id: number): Promise<Song | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM songs WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row as Song | undefined);
      });
    });
  }

  getDailySong(date: string): Promise<DailySong | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT ds.*, s.* FROM daily_songs ds
         JOIN songs s ON ds.song_id = s.id
         WHERE ds.date = ?`,
        [date],
        (err, row) => {
          if (err) reject(err);
          else resolve(row as DailySong | undefined);
        }
      );
    });
  }

  setDailySong(date: string, songId: number, startTime: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO daily_songs (date, song_id, start_time) VALUES (?, ?, ?)`
      );
      stmt.run([date, songId, startTime], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
      stmt.finalize();
    });
  }

  saveGameSession(
    sessionId: string,
    songId: number,
    mode: string,
    date: string | null,
    startTime: number,
    guesses: GuessResult[],
    completed: boolean,
    won: boolean
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO game_sessions
         (id, song_id, mode, date, start_time, guesses, completed, won)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      stmt.run(
        [sessionId, songId, mode, date, startTime, JSON.stringify(guesses), completed, won],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
      stmt.finalize();
    });
  }

  getGameSession(sessionId: string): Promise<GameSession | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM game_sessions WHERE id = ?`,
        [sessionId],
        (err, row: any) => {
          if (err) reject(err);
          else {
            if (row?.guesses) {
              row.guesses = JSON.parse(row.guesses);
            }
            resolve(row as GameSession | undefined);
          }
        }
      );
    });
  }

  close(): void {
    this.db.close();
  }
}