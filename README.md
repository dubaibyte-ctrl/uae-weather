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

## Architecture
```
Phone / desktop PWA (public/)  ── radar tiles + index ──► RainViewer (direct, no key)
        │                      ── forecasts ──────────► Open-Meteo (direct, no key)
        └── /api/metar, /api/validation, /api/scan, /api/health ──► Cloudflare Worker (src/worker.js)
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
