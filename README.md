## PGA Draft Room

This app is a live fantasy golf draft room for weekly PGA tournaments. It lets your league:

- create a tournament session for each event
- let only the teams playing that week join the draft
- assign the snake draft order
- import the PGA field from ESPN
- draft unique golfers live with Supabase sync
- score teams using only the best 3 of 4 golfers

## First-Time Setup

1. Open your Supabase project.
2. In the left menu, click `SQL Editor`.
3. Open the file [supabase-setup.sql](C:/Users/sethm/pga-draft/supabase-setup.sql).
4. Copy everything in that file.
5. Paste it into the Supabase SQL Editor.
6. Click `Run`.
7. In Supabase, go to `Database` -> `Replication`.
8. Make sure `draft_sessions`, `draft_teams`, and `draft_picks` are enabled for Realtime.
9. In the project root, open `.env.local`.
10. Make sure it contains your Supabase project URL and anon key.

## Run The App

From `C:\Users\sethm\pga-draft`, run:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## How To Use It

1. Type a tournament name.
2. Choose the PGA event.
3. Click `Create Live Session`.
4. Click the new session in the left column.
5. Review the 12 team names and edit any names you want.
6. Uncheck teams that are sitting out that week.
7. Click `Assign Next Pick` until every active team has a draft slot.
8. Click `Import ESPN Field` to load that week’s golfers.
9. Click `Save Player Pool`.
10. Start drafting players from the available golfer list.
11. After the tournament starts, click `Pull ESPN Leaderboard` to update scores.
12. If needed, paste manual overrides into the scoring box and click `Apply Manual Scores`.

## Important Note

This first live version uses open Supabase policies so your league can draft together without a login system. That is okay for a private league MVP, but later we should lock it down with authentication.

