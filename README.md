# UAE Rain & Weather

Personal/family PWA (EN/AR, RTL) with an animated UAE rain radar, airport weather reports (METAR), forecasts, city search and favorites, plus an always-on radar-vs-METAR validation log.
Standalone: it shares nothing with the Amsterdam app.

## What is real, and how it is labelled
| Badge | Source | Meaning |
|---|---|---|
| OBSERVED | Airport METARs (NOAA AviationWeather, via our Worker) | Measured at 9 UAE airports, ~every 30 min. Only these can say "rain reported". |
| RADAR | RainViewer past frames (10-min steps) | An echo near a point. Never worded as "it is raining". |
| MODEL | Open-Meteo | Temperature, humidity, wind, rain chance. Forecast, not measurement. |
| OFFICIAL | none yet | No documented NCM feed was found; the app links out instead. |

Stale/outdated data is flagged or withheld; unavailable sources show "unavailable". Nothing is simulated.
Hail is only mentioned if an airport METAR carries a hail code (GR/GS).

## Hyperlocal rain discovery
- **Places database** (`public/data/places.json`, 160+ named areas in all seven emirates, Arabic names where the source has them). Every coordinate is copied from GeoNames (via Open-Meteo geocoding) or OpenStreetMap (Nominatim) with its source ID; nothing is estimated and there are no boundaries, only points. Rebuild with `node tools/build-places.mjs` (inputs: `tools/places-spec.txt`, `tools/places-raw.txt`).
- **Where's the Rain?** The cron job reads the six RainViewer tiles that cover the UAE, finds connected echo areas (speckle under 3 px is dropped) and stores them. The browser measures how far each place and the user are from those echoes (`public/lib/radar-geo.js`), so the user's location never leaves the device.
- **Rain Near Me**: radius 10/25/50/100 km; nearest echo, direction, echo-area size, and whether it is closing in (compared with the frame ~20 min earlier, not a forecast).
- **Wording rules**: no echo is never worded as "dry"; places outside the radar coverage layer or in unreadable tiles show "unavailable"; intensity is not shown until echo strength is validated against rainfall observations; the safety check always states that official NCM warnings cannot be read (no public feed found).
- **Outing ideas** are candidates only and are withheld if radar is not fresh; wadis, dams and mountains are never suggested.


## Community Rain Reports (Telegram intake)
Automatic intake of rainfall reports from **authorized** community sources. Telegram is the first integration.
- **Flow:** a Telegram channel you own → our bot (added as admin) → `POST /api/telegram-webhook` (verified by a secret header) → Durable Object `community` table → `GET /api/community` → the "Community Rain Reports | بلاغات الأمطار" section. Runs with the app closed, like the cron collector.
- **Parsing** (`src/lib/community.js`): detects rain/hail/thunder/flood in Arabic + English and matches UAE place names (incl. neighbourhoods like Al Rashidiya, Al Dhaid, Al Khawaneej, Hatta) to the hyperlocal DB via a generated gazetteer (`src/lib/places-data.js`, built by `tools/build-gazetteer.mjs`). One message → one row per matched area.
- **Dedupe:** same message id ignored; identical text+place from a new id flagged as a repost; forwards of older content are marked and never counted as a fresh observation; messages with no matched place are kept but flagged "No location".
- **Verification** (never asserts rain from a post): each located report is cross-checked against the stored radar scan and airport METARs around its time and labelled **officially-confirmed** (airport precip nearby), **radar-corroborated** (echo at the spot), **conflicting** (report claims rain but radar+airport are clear), or **unverified**. Duplicates are labelled as such.
- **No secrets in git, and none needed in the Cloudflare dashboard:** the bot token is stored in the Durable Object via the one-time setup link; the webhook secret is generated and stored by the Worker itself. `.dev.vars` (git-ignored) only provides a local-dev fallback token. Nothing is ever written to the repo.
- **Status:** the pipeline is built and deployed. **Storm Centre is NOT integrated** — that needs the owner's authorization. Validate with a test channel you own first (setup steps below).

### Telegram setup (one link, no dashboard secrets)
The bot token is stored **inside the Durable Object** (set once), so it survives every GitHub/Cloudflare deploy — unlike dashboard variables/secrets, which Workers Builds resets on each build.
1. **@BotFather** → `/newbot` (or `/revoke` to rotate) → copy the bot **token**.
2. Create a **channel** you own; add the bot as an **administrator**.
3. Open this once in your **own browser** (token goes in your address bar, never in the repo), replacing the placeholder:
   `https://uae-weather.dubaibyte.workers.dev/api/telegram-admin?token=<BOT_TOKEN>&action=setup`
   The Worker stores the token server-side, generates its own webhook secret, registers the webhook, and returns a status JSON. Re-opening it later requires the same token.
4. Post a test message in the channel (e.g. `أمطار غزيرة على حتا`). The first channel to post is auto-authorized (trust-on-first-use); others are ignored. Check `/api/community` or `/api/health` (`telegram` block).

Rotating the token: `/revoke` in BotFather, then open the setup link once with the new token.

## Other legitimate sources (researched, optional)
- **YouTube Data API v3**: polling a channel's uploads playlist (`playlistItems.list`) costs ~1 quota unit against a 10,000/day default, with a free Google API key — a viable low-cost secondary source for weather-community video titles/descriptions. Not yet wired in.

## Architecture
```
Phone / desktop PWA (public/)  ── radar tiles + index ──► RainViewer (direct, no key)
        │                      ── forecasts ──────────► Open-Meteo (direct, no key)
        └── /api/metar, /api/validation, /api/scan, /api/health, /api/community ──► Cloudflare Worker (src/worker.js)
        └── Telegram ──► /api/telegram-webhook ──► community reports (Durable Object)
                                                          ├─ METAR proxy, 2 min edge cache
                                                          └─ cron every 10 min → Durable Object (SQLite)
                                                             stores METARs + radar pixel at each airport
```

## Validation
Every 10 minutes the Worker stores new METARs and decodes the newest RainViewer frames at each airport (5×5 px ≈ 6 km window).
A METAR rain/thunderstorm report is paired with the radar frame within ±10 min. `/api/validation` returns hits, misses, false alarms
and correct negatives. POD/FAR/CSI are withheld until ≥5 rain reports exist. Radar-tile read problems are counted, never hidden.

## Deploy (Cloudflare Workers + GitHub, free plan)
1. Push this repo to GitHub as `uae-weather`.
2. Cloudflare dashboard → Workers & Pages → Create → Import a repository → pick `uae-weather`.
   Build command: *(empty)*. Deploy command: `npx wrangler deploy`. No env vars or secrets are needed.
3. Open the `*.workers.dev` URL, then check `/api/health` after ~10 minutes (cron) to see collector rows.

Local: `npm install && npm run dev`, tests: `npm test` (+ `node --import ./test/loader.mjs --test test/log.test.js`, `node test/ui-smoke.mjs`).

## Licences and limits
- RainViewer: personal/educational use, attribution required, zoom ≤7, past 2 h only, no forecast frames.
- Open-Meteo: free for non-commercial use, CC BY 4.0, attribution shown.
- Free-plan footprint: one Worker, one SQLite Durable Object, cron every 10 min (~150 runs/day).
- Directions open Google Maps / Apple Maps with only the destination; the straight-line echo check is not the road route.
- Not built yet: push notifications when the app is closed (needs Web Push + keys), official NCM warnings, 15–60 min nowcast.
