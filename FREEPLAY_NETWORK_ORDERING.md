# Freeplay Round: Network Request & Timeout Ordering

This describes the current runtime ordering for **one freeplay round** and where latency can affect outcomes.

## 1) Round/session creation

1. Client calls `POST /api/game/start` with `mode: "freeplay"`.
2. Server creates a freeplay session and returns `sessionId`.

## 2) Clip preload

1. Client calls `GET /api/game/:sessionId/audio/6`.
2. Server returns the 6s clip.
3. Client stores it as a blob/object URL and sets `audio.src`.

## 3) Local timer start (no network)

1. Client starts local countdown in `startFreeplayCountdown()`:
   - `setInterval` updates progress bar.
   - `setTimeout(..., 6000)` triggers timeout handler.
2. Client starts playback (`audio.play()`).

## 4) User-path split

## A) User submits a guess before timeout callback fires

1. Client sends `POST /api/game/:sessionId/guess`.
2. Server validates and responds with result.
3. Client handles result (`handleGuessResult`) and round advances or ends.

## B) Local timeout callback fires first

1. Client sends `POST /api/game/:sessionId/timeout`.
2. Server marks timeout loss and responds.
3. Client handles timeout result and shows loss.

## 5) Current latency-sensitive race

There is a race near the 6s boundary:

- If player clicks guess near deadline, the local timeout is still armed until the guess response returns.
- Under higher ping, local timeout callback can fire while guess request is in flight.
- That can cause `/timeout` to be sent before `/guess` resolves, making outcomes ping-sensitive at the edge.

So yes: in the current implementation, a near-deadline click can be penalized by network timing.

## 6) What is already local vs network-dependent

Local (not ping-dependent):
- Progress bar countdown
- 6s timer scheduling
- Playback start attempt

Network-dependent:
- Session creation (`/start`)
- Clip fetch (`/audio/6`)
- Guess validation (`/guess`)
- Timeout confirmation (`/timeout`)

## 7) Practical mitigation (recommended)

To reduce ping penalty at end-of-round:

1. As soon as user clicks submit, immediately clear/suspend local timeout.
2. Mark round as `submissionPending` client-side.
3. Ignore timeout callback while `submissionPending` is true.
4. Resume normal flow on guess response.

This makes click time (client-side) the cutoff rather than response arrival time.
