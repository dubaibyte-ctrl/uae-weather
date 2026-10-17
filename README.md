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

## Architecture
```
Phone / desktop PWA (public/)  ── radar tiles + index ──► RainViewer (direct, no key)
        │                      ── forecasts ──────────► Open-Meteo (direct, no key)
        └── /api/metar, /api/validation, /api/health ──► Cloudflare Worker (src/worker.js)
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
- Not built yet: push notifications when the app is closed (needs Web Push + keys), official NCM warnings, 15–60 min nowcast.
