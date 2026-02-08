# Open Swiftle

A music guessing game inspired by [Swiftle](https://www.techyonic.co/swiftle) and Wordle. Built with TypeScript, Express, SQLite, and FFmpeg.

## Game Modes

### Daily Mode
One song per day, shared across all players. You get 6 guesses, and each wrong guess reveals one more second of audio (1s, 2s, ..., 6s). Same song and starting point for everyone on a given day.

### Freeplay Mode
A random song plays for 6 seconds. You get one chance to guess. Unlimited rounds.

## Quick Start (Local)

**Prerequisites:** Node.js (v18+), FFmpeg (`apt install ffmpeg` / `brew install ffmpeg`)

```bash
git clone <repo-url> && cd open-swiftle
npm install
cp .env.example .env       # then edit DAILY_SEED_SECRET
```

Add MP3/WAV files to `songs/`, named as `Artist - Title.mp3`:
```
songs/
  Taylor Swift - Love Story.mp3
  Taylor Swift - Blank Space.mp3
  ...
```

```bash
npm run setup   # scans songs/, writes metadata to SQLite
npm start       # http://localhost:3000
```

For development with recompilation:
```bash
npm run dev
```

## Production Deployment

### On a VPS / Cloudflare Server

```bash
# 1. Install system dependencies
apt update && apt install -y nodejs npm ffmpeg

# 2. Clone and build
git clone <repo-url> && cd open-swiftle
npm install --production
npm run build

# 3. Configure
cp .env.example .env
# Edit .env:
#   DAILY_SEED_SECRET=<random string>
#   PORT=3000

# 4. Add songs and initialize DB
# (scp or rsync your songs/ directory to the server)
npm run setup

# 5. Run with a process manager
npm install -g pm2
pm2 start dist/server/index.js --name swiftle
pm2 save
pm2 startup
```

### Behind Cloudflare (Recommended)

Point your domain's DNS to the server via Cloudflare (orange cloud). Cloudflare handles TLS, caching of static assets, and DDoS protection. The app itself serves on HTTP; Cloudflare terminates HTTPS.

If your server isn't directly exposed, use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

```bash
cloudflared tunnel --url http://localhost:3000
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DAILY_SEED_SECRET` | Yes | Secret mixed with date to determine daily song. Change this to make your daily picks unpredictable even with public code. |
| `PORT` | No | Server port (default: 3000) |

## Project Structure

```
open-swiftle/
  src/                  # TypeScript source
    server/
      index.ts          # Express server + API routes
      database.ts       # SQLite wrapper (songs, sessions, daily picks)
      gameLogic.ts      # Song selection, guess validation, seeded RNG
      clipCache.ts      # Audio clip generation + disk cache
    scripts/
      setup.ts          # Song import CLI
  public/               # Frontend (vanilla HTML/CSS/JS)
    index.html
    styles.css
    game.js
  songs/                # Audio files (git-ignored)
  audio/cache/          # Generated clips (git-ignored)
  dist/                 # Compiled JS (git-ignored)
  game.db               # SQLite database (git-ignored)
```

## Design Decisions

### Database: SQLite

SQLite was chosen because the data model is simple (songs, sessions, daily picks) and the expected load is low (friends sharing a link). No need for a separate database process. The DB file lives next to the app.

Three tables:
- **songs** -- metadata imported from filenames + FFmpeg duration probing
- **daily_songs** -- one row per date, mapping to a song ID and a random start time
- **game_sessions** -- tracks each player's guesses, mode, and the start time for their clip

### Audio Clip Cache

Full song files never leave the server. Instead, clips are generated on demand via FFmpeg and cached to disk as base64-encoded JSON.

**Daily mode:** Clips are keyed by date. The first player to request a daily clip triggers generation of all 6 durations (1s through 6s). Every subsequent request that day is served from cache.

**Freeplay mode:** Clips are keyed by session ID. Each new freeplay round generates a fresh 6s clip from a random song and start point.

FFmpeg pipes the clip directly to a buffer (no temp files on disk). The buffer is base64-encoded and written to a JSON file in `audio/cache/`. On subsequent requests, the server reads the JSON, decodes the base64, and streams the MP3 bytes.

**Why base64 JSON and not raw MP3 files?** The cache stores metadata alongside the audio (song ID, start time, generation timestamp). This makes it easy to inspect, debug, and extend without a separate metadata store.

**Trade-off:** FFmpeg is a system binary dependency. This is fine for VPS deployments but limits serverless options. The `spotify-integration` branch explores using Spotify's Web Playback SDK to eliminate this dependency entirely.

### Anti-Cheating

1. **Server-side clip generation.** The client never receives the full song file -- only the exact clip duration it has earned. There is no way to scrub ahead or inspect the full audio.

2. **Server-side guess validation.** The server checks guesses against the database. The song title is never sent to the client until the game is over (win or all guesses exhausted).

3. **Progressive clip access control.** The API rejects requests for clip N+1 until the client has submitted guess N. You can't skip ahead by crafting URLs.

4. **Seeded daily randomization.** The daily song is determined by `SHA-256(date + DAILY_SEED_SECRET)`. Without the secret, players can't predict tomorrow's song even with full access to the source code and song list.

5. **Catalog-constrained guessing.** The client loads the song catalog and submits `guessSongId` (not free text). The server rejects unknown IDs and validates exact song identity.

### Latency Optimization

1. **Blob preloading.** The frontend fetches audio clips as blobs via `fetch()` and converts them to object URLs (`URL.createObjectURL`). By the time the user presses play, the audio data is already in browser memory. No network round-trip on playback.

2. **Disk cache.** After the first generation, all clip requests for the same key are served from disk. Daily clips are generated once and reused for every player that day.

3. **FFmpeg pipe streaming.** Clips are extracted via FFmpeg's pipe output, avoiding intermediate temp files and extra disk I/O.

## Adding Songs

Place MP3 or WAV files in `songs/` and run `npm run setup`. The filename format determines title/artist metadata:

```
"Artist - Title.mp3"  -->  artist="Artist", title="Title"
"Title.mp3"           -->  artist="Taylor Swift", title="Title"
```

Songs already in the database are skipped (matched by filename or artist+title).

Album metadata is read from audio tags (`album`) when available and used for "correct album" hinting.

## Branches

| Branch | Description |
|---|---|
| `main` | Audio file implementation (current) |
| `spotify-integration` | Spotify OAuth + Web Playback SDK (WIP, no FFmpeg needed) |
