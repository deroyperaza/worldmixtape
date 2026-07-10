# WORLD MIXTAPE — Deploy & Repo Guide

## Source of truth
**This repo (`~/Projects/worldmixtape/site/`) is the source of truth. Edit files here directly.**

- **Live site:** https://worldmixtape.com — GitHub Pages, served from the `main` branch root, custom domain via `CNAME`.
- **Repo:** https://github.com/deroyperaza/worldmixtape
- **Firebase backend** (auth, Firestore, Cloud Functions): `../firebase/` — project `world-mix-tape`.

Google Drive (`…/HKT World Mix Tape/app/`) is the **curation workshop only** — it generates
`data.js`, `country_*.js`, and `track_features.js`. When those regenerate, copy the specific
files into this repo, then deploy. Everything else (app.js, styles.css, games.js/css, HTML) is
edited here. Never put `.git` or Firebase functions in Drive — sync corrupts them.

## Deploy
From this directory:

```bash
./deploy.sh "commit message"            # publish the SITE (git push → Pages, live in ~1 min)
./deploy.sh "commit message" --rules    # ALSO deploy Firestore security rules
```

- `deploy.sh` = `git add -A` + commit + `git push`. No Drive copy step.
- `--rules` additionally runs `firebase deploy --only firestore:rules` from `../firebase`.
- Cloud **Functions** (rare — the play/fave counters in `../firebase/functions/index.js`) deploy separately:
  ```bash
  cd ../firebase && firebase deploy --only functions
  ```
- The Firebase CLI token expires periodically. If you see `Authentication Error … credentials no longer valid`,
  run `firebase login --reauth` in a terminal, then re-run the deploy.

## Cache-busting
Bump the `?v=N` query when you change a versioned asset so browsers refetch it:

- `index.html` → `app.js`, `data.js`, `country_timelines.js`, `country_music.js`, `country_food.js`
- `games/index.html` → `games.js`, `games.css`, `data.js`

HTML pages themselves aren't versioned — Pages revalidates them.

## Verify a deploy
Curl the live asset's version (don't trust the `gh run` status, which lags):

```bash
curl -s "https://worldmixtape.com/index.html?x=$(date +%s)" | grep -oE 'app.js\?v=[0-9]+'
curl -s "https://worldmixtape.com/games/index.html?x=$(date +%s)" | grep -oE 'games.js\?v=[0-9]+'
```

## What's in the repo
- `index.html` + `app.js` — the main map app (globe nav, player, favorites, Google accounts, dossiers).
- `games/` + `games.js` + `games.css` — the daily games (see below).
- `stats/` — the `/stats` dashboard (leaderboards, KPIs, charts).
- `data.js` — the catalog: `COUNTRIES → eras → tracks`. **Generated in the Drive workshop.**
- `country_timelines.js` / `country_music.js` / `country_food.js` — dossier content.
- `../firebase/` — `firestore.rules` + `functions/` (siblings of this repo, not published by Pages).

## Firestore collections (rules in `../firebase/firestore.rules`)
- `users/{uid}` (+ `/favorites`) — owner-only read/write.
- `trackStats/{trackId}` — public read; **Function-write** (per-track play + fave counts).
- `stats/global` — public read totals; Function-write.
- `leaderboard_games` / `leaderboard_faves` / `leaderboard_plays` — user leaderboards; public read, owner writes own row.
- `leaderboard_game_{soundtrip|timemachine|clusters|coverup|wherewhen}` — per-game score boards; public read, owner write.
- `mixes/{id}`, `challenges/{id}` — share links; public read, validated create.

---

## Recent work — 2026-07-09

**Games (`games.js`)**
- **Where & When** — on the guess map, tapping a country now **previews its name + a "Guess this ✓" confirm**
  before locking the guess (tap the same country again, or the button, to commit). Hover uses a distinct color
  (`#4e4394`) so **only the one armed country is ever orange** — fixes a bug where a hovered + armed country
  looked like two selections (worse on touch, where `mouseout` doesn't fire).
- **Where & When — Pass & play** gives **each player their own 5 songs** (was: same 5 for everyone).
- **Culture Clusters** — the ▶ preview button **pauses/resumes** instead of restarting.
- **Per-game leaderboards** — each game accrues a per-game score → `leaderboard_game_*`, shown on `/stats`.

**Site (`app.js`, `stats/`)**
- **Most-plays leaderboard** — `app.js` counts each real (≥5s) play per signed-in user via
  `pushPlaysLeaderboard()` → `leaderboard_plays`; shown on `/stats` as **"Top listeners."**
- **Stats mobile fix** — CSS-grid `minmax(0,1fr)` + `min-width:0` on grid items so long-title charts
  ("Most played" / "Most hearted") stop overflowing the viewport on mobile.

**Data (`data.js`)**
- Removed the Dutch duo **WAAN** from New Caledonia (curation mis-tagged them as "kaneka", 1995), and re-added
  them to the **Netherlands** with correct metadata: *Omi* (Echo Echo, 2023, nu jazz, 2020s) and
  *Talking Trees* (We Want WAAN, 2026, nu jazz, `now`).

**Infra**
- **Source of truth moved from Google Drive to this local repo.** `deploy.sh` rewritten to `git push` only
  (no Drive copy / no file-allowlist), with `--rules` for Firestore rules.
