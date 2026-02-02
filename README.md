# Open Swiftle

A Taylor Swift song guessing game inspired by Wordle.

## Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and set your `DAILY_SEED_SECRET`
3. Add song files to the `songs/` directory (see below)
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

1. Place MP3 or WAV files in the `songs/` directory
2. Name files as: "Artist - Song Title.extension" (e.g., "Taylor Swift - Love Story.mp3")
3. Run `npm run setup` to update the database

**Note**: Use royalty-free music or songs you have legal rights to use. For Taylor Swift songs specifically, see the `spotify-integration` branch for a Spotify Web API approach.

## Requirements

- Node.js
- FFmpeg (for audio processing)