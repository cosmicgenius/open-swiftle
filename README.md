# Open Swiftle

A Taylor Swift song guessing game inspired by Wordle.

## Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and set your `DAILY_SEED_SECRET`
3. Add Taylor Swift song files to the `songs/` directory (see below)
4. Run setup script: `npm run setup`
5. Start the server: `npm start` (or `npm run dev` for development)

## Environment Configuration

Create a `.env` file from `.env.example`:
```bash
cp .env.example .env
```

Set your `DAILY_SEED_SECRET` to a unique value - this ensures your daily songs are unpredictable even with public code.

## How to Play

- **Daily Mode**: One song per day, 6 guesses
- **Freeplay Mode**: Unlimited games
- Each guess reveals more seconds of the song (1s, 2s, 3s, etc.)
- Guess the song title to win!

## Adding Songs

**Important**: You must legally obtain Taylor Swift songs yourself. This could be through:
- Purchasing from iTunes, Amazon Music, etc.
- Downloading from streaming services you subscribe to (where permitted)
- Converting from CDs you own
- Other legitimate sources

1. Place MP3 or WAV files in the `songs/` directory
2. Name files as: "Artist - Song Title.extension" (e.g., "Taylor Swift - Love Story.mp3")
3. Run `npm run setup` to update the database

**Note**: The repository does not include any copyrighted music files.

## Requirements

- Node.js
- FFmpeg (for audio processing)