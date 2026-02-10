# Open Swiftle

A music guessing game inspired by [Swiftle](https://www.techyonic.co/swiftle) and Wordle. Built with TypeScript, Express, SQLite, and FFmpeg.

## Game Modes

### Daily Mode
One song per day, shared across all players. You get configurable daily guesses (default 6), and each wrong guess reveals one more second of audio up to that limit. Same song and starting point for everyone on a given day.

- Route: `/`
- Auto-starts on page load
- Resumes the current daily session after reload (stored in browser `localStorage`, keyed by UTC date)
- Shows previous guesses and song/album feedback

### Freeplay Mode
A fast reaction loop around a configurable clip timer.

- Route: `/freeplay`
- Start screen with mode options, then autoplay
- **Normal:** unlimited guesses until clip timeout
- **Hard mode:** one wrong guess ends the round
- Correct guess immediately starts next round
- Tracks `Score` and persistent `Best` score locally

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
| `DAILY_MAX_GUESSES` | No | Daily mode max guesses and max reveal seconds (default: `6`). |
| `FREEPLAY_CLIP_TTL_MS` | No | TTL for shared freeplay clips on disk and in memory (default: `300000` / 5 min). |
| `FREEPLAY_POOL_REFRESH_MS` | No | Background refresh interval for adding a new freeplay pool entry (default: `300000` / 5 min). |
| `FREEPLAY_POOL_MIN_SIZE` | No | Minimum number of prewarmed freeplay entries to keep available (default: `12`). |
| `FREEPLAY_POOL_MAX_SIZE` | No | Maximum in-memory freeplay pool size before trimming old entries (default: `30`). |
| `FREEPLAY_AUDIO_MAX_AGE_SECONDS` | No | Browser cache max-age for freeplay audio responses (default: `60`). |
| `FREEPLAY_CLIP_SECONDS` | No | Freeplay clip length in seconds (default: `6`). |

## Project Structure

```
open-swiftle/
  src/                  # TypeScript source
    server/
      index.ts          # Express server + API routes
      database.ts       # SQLite wrapper (songs, sessions, daily picks)
      gameLogic.ts      # Song selection, guess validation, seeded RNG
      clipCache.ts      # Audio clip generation + disk cache
      freeplayPool.ts   # Shared freeplay clip pool + background refresh
    scripts/
      setup.ts          # Song import CLI
  public/               # Frontend (vanilla HTML/CSS/JS)
    index.html
    freeplay.html
    styles.css
    daily.js
    freeplay.js
    game-core.js
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
- **game_sessions** -- tracks mode, guesses, `freeplay_hard`, and clip start time

### Audio Clip Cache

Full song files never leave the server. Instead, clips are generated on demand via FFmpeg and cached to disk as base64-encoded JSON.

**Daily mode:** Clips are keyed by date. The first player to request a daily clip triggers generation of all daily durations (1s through `DAILY_MAX_GUESSES`). Every subsequent request that day is served from cache.

**Freeplay mode:** Clips use a shared cache key (`freeplay-shared`) and are selected from a shared prewarmed pool of `(song, startTime)` entries. A background timer adds a new pooled clip at a fixed interval (default: every 5 minutes).

FFmpeg pipes the clip directly to a buffer (no temp files on disk). The buffer is base64-encoded and written to a JSON file in `audio/cache/`. On subsequent requests, the server reads the JSON, decodes the base64, and streams the MP3 bytes.

Freeplay TTL is applied in both places:
- In-memory pool entries expire after `FREEPLAY_CLIP_TTL_MS`.
- Disk cache entries for freeplay are treated as stale after the same TTL and regenerated when needed.

**Why base64 JSON and not raw MP3 files?** The cache stores metadata alongside the audio (song ID, start time, generation timestamp). This makes it easy to inspect, debug, and extend without a separate metadata store.

**Trade-off:** FFmpeg is a system binary dependency. This is fine for VPS deployments but limits serverless options. The `spotify-integration` branch explores using Spotify's Web Playback SDK to eliminate this dependency entirely.

### Anti-Cheating

1. **Server-side clip generation.** The client never receives the full song file -- only the exact clip duration it has earned. There is no way to scrub ahead or inspect the full audio.

2. **Server-side guess validation.** The server checks guesses against the database. The song title is never sent to the client until the game is over (win or all guesses exhausted).

3. **Progressive clip access control.** The API rejects requests for clip N+1 until the client has submitted guess N. You can't skip ahead by crafting URLs.

4. **Seeded daily randomization.** The daily song is determined by `SHA-256(date + DAILY_SEED_SECRET)`. Without the secret, players can't predict tomorrow's song even with full access to the source code and song list.

5. **Catalog-constrained guessing.** The client loads the song catalog and submits `guessSongId` (not free text). The server rejects unknown IDs and validates exact song identity.

6. **Basic abuse controls.** Per-IP in-memory rate limiting is applied to start, audio, guess, status, timeout, and song-list endpoints.

### Latency Optimization

1. **Blob preloading.** The frontend fetches audio clips as blobs via `fetch()` and converts them to object URLs (`URL.createObjectURL`). By the time the user presses play, the audio data is already in browser memory. No network round-trip on playback.

2. **Disk cache + shared freeplay pool.** Daily clips are generated once per date and reused all day. Freeplay uses a shared prewarmed pool and shared disk key so all sessions can reuse prepared clips.

3. **FFmpeg pipe streaming.** Clips are extracted via FFmpeg's pipe output, avoiding intermediate temp files and extra disk I/O.

### Frontend State Persistence

- **Daily session resume:** The frontend stores the active daily `sessionId` in `localStorage` using a UTC-date-scoped key (`swiftle_daily_session_YYYY-MM-DD`).
- On reload, it calls `GET /api/game/:sessionId/status` and rebuilds guess history/current clip from server state.
- If the stored session is missing/invalid, the client clears the key and starts a new daily session.

## Adding Songs

Place MP3 or WAV files in `songs/` and run `npm run setup`.

The importer is recursive and supports:

```
songs/Track.mp3
songs/Album Name/Track.mp3
songs/Album Name/Disc 2/Track.mp3
```

Filename parsing:

```
"Artist - Title.mp3"  -->  artist="Artist", title="Title"
"Title.mp3"           -->  artist="Taylor Swift", title="Title"
```

Album resolution:

```
top-level folder name in songs/ takes priority (e.g., songs/Red/...)
otherwise falls back to audio tag `album` if present
otherwise album is null
```

Songs already in the database are skipped (matched by filename or by artist+title+album).

## HTTP Routes

- `GET /` -- daily page (auto-start daily game)
- `GET /freeplay` -- freeplay start page
- `POST /api/game/start` -- create session (`mode`, `clientId`, optional `freeplayHard`)
- `GET /api/game/:sessionId/audio/:guessNumber` -- fetch earned clip
- `POST /api/game/:sessionId/guess` -- submit `guessSongId`
- `POST /api/game/:sessionId/timeout` -- force timeout loss (freeplay only)
- `GET /api/game/:sessionId/status` -- session state
- `GET /api/admin/songs` -- song catalog for client search/select
- `GET /api/health` -- health check

## Branches

| Branch | Description |
|---|---|
| `main` | Audio file implementation (current) |
| `spotify-integration` | Spotify OAuth + Web Playback SDK (WIP, no FFmpeg needed). This is broken right now because creation of new spotify apps is off. |
