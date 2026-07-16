# Data Golf Integration

Rat Race should use Data Golf through our own server route so the API key never ships to the browser.

## Environment

Add this value locally in `.env.local` and in Vercel Project Settings -> Environment Variables:

```bash
DATA_GOLF_API_KEY=your_data_golf_key_here
```

`DATAGOLF_API_KEY` is also accepted as a fallback, but `DATA_GOLF_API_KEY` is the preferred name.

## Local Smoke Tests

After starting the app with `npm run dev`, these URLs should return JSON from our proxy:

```text
http://localhost:3000/api/data-golf?action=schedule&tour=pga&season=2026
http://localhost:3000/api/data-golf?action=field&tour=pga
http://localhost:3000/api/data-golf?action=outright-odds&tour=pga&market=win
http://localhost:3000/api/data-golf?action=pre-tournament&tour=pga&odds_format=american
```

These Rat Race-shaped endpoints are what the app uses:

```text
http://localhost:3000/api/data-golf?action=app-events&tour=pga&season=2026
http://localhost:3000/api/data-golf?action=app-field&tour=pga
http://localhost:3000/api/data-golf?action=app-odds&tour=pga&market=win
http://localhost:3000/api/data-golf?action=app-leaderboard&tour=pga
```

## Supported Proxy Actions

- `player-list`
- `schedule`
- `field`
- `pre-tournament`
- `live-predictions`
- `live-stats`
- `outright-odds`
- `historical-raw-event-list`
- `historical-raw-rounds`
- `historical-event-list`
- `historical-event-results`
- `historical-outrights`

## Migration Recommendation

1. Replace event selection with `schedule`.
2. Replace draft pool imports with `field`, then enrich the pool with `outright-odds` and/or `pre-tournament`.
3. Replace live scoring with a Data Golf-backed leaderboard normalizer once we verify the live scoring fields available in the subscribed feed.
4. Replace historical scoring corrections with `historical-event-results` and `historical-raw-rounds`.
5. Keep ESPN as a temporary fallback until the Data Golf shapes are validated for active, completed, cut, WD, and playoff cases.

## Current Local Migration Status

- Event selection now uses Data Golf through `app-events`.
- New draft field imports now use Data Golf through `app-field`.
- Draft odds now use Data Golf outright odds through `app-odds`.
- Results refresh and the tournament leaderboard now use Data Golf live predictions through `app-leaderboard`.
- ESPN remains as fallback for older saved sessions whose event IDs came from ESPN.

## Product Ideas From Data Golf

- Show odds, make-cut probability, top-20 probability, win probability, and model rank on draft cards.
- Add a "value board" comparing betting odds to Data Golf win/top-20 probabilities.
- Add projected team strength before the draft using pre-tournament projections.
- Add live team movement during rounds using in-play finish probabilities.
- Add post-tournament recap cards showing who drafted the best value, biggest miss, and most points over expected.
- Add season-long golfer performance by team: most drafted, best average finish, points over expected, and total strokes to par.
