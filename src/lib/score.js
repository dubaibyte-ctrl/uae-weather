// Radar-vs-METAR scoring. Pure function so it can be unit tested.
// A METAR "rain" = precipitation or thunderstorm present AT the station (not VC).
// A radar "echo" = non-transparent pixel within ~6 km of the station in the frame nearest the report.
export const PAIR_WINDOW_MS = 10 * 60 * 1000;
export const MIN_RAIN_EVENTS = 5;

export function score(metars, radar) {
  const byStation = new Map();
  for (const r of radar) {
    if (r.echo === null || r.echo === undefined) continue;
    if (!byStation.has(r.station)) byStation.set(r.station, []);
    byStation.get(r.station).push(r);
  }
  const total = { hit: 0, miss: 0, falseAlarm: 0, correctNeg: 0 };
  const per = {};
  const events = [];
  for (const m of metars) {
    const frames = byStation.get(m.station);
    if (!frames) continue;
    let best = null;
    for (const f of frames) {
      const d = Math.abs(f.frameMs - m.obsMs);
      if (d <= PAIR_WINDOW_MS && (!best || d < best.d)) best = { f, d };
    }
    if (!best) continue;
    const rain = !!m.rain, echo = !!best.f.echo;
    const k = rain && echo ? "hit" : rain ? "miss" : echo ? "falseAlarm" : "correctNeg";
    total[k]++;
    (per[m.station] ||= { hit: 0, miss: 0, falseAlarm: 0, correctNeg: 0 })[k]++;
    if (rain || echo) events.push({ station: m.station, obsMs: m.obsMs, frameMs: best.f.frameMs, wx: m.wx, thunder: !!m.thunder, hail: !!m.hail, echo: echo ? 1 : 0, alpha: best.f.alpha, outcome: k });
  }
  const pairs = total.hit + total.miss + total.falseAlarm + total.correctNeg;
  const rainEvents = total.hit + total.miss;
  const enough = rainEvents >= MIN_RAIN_EVENTS;
  const div = (a, b) => (b > 0 ? +(a / b).toFixed(3) : null);
  return {
    pairs, rainEvents, enough,
    matrix: total,
    pod: enough ? div(total.hit, total.hit + total.miss) : null,
    far: enough ? div(total.falseAlarm, total.hit + total.falseAlarm) : null,
    csi: enough ? div(total.hit, total.hit + total.miss + total.falseAlarm) : null,
    echoRateWhenDry: div(total.falseAlarm, total.falseAlarm + total.correctNeg),
    byStation: per,
    recentEvents: events.sort((a, b) => b.obsMs - a.obsMs).slice(0, 20),
  };
}
