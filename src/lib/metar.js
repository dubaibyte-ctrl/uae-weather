// METAR helpers shared by the Worker (and unit tests). Real observations only.
export const STATIONS = {
  OMDB: { n: "Dubai Intl", ll: [25.2528, 55.3644] },
  OMDW: { n: "Al Maktoum Intl", ll: [24.8964, 55.1614] },
  OMSJ: { n: "Sharjah Intl", ll: [25.3286, 55.5172] },
  OMRK: { n: "Ras Al Khaimah Intl", ll: [25.6135, 55.9388] },
  OMFJ: { n: "Fujairah Intl", ll: [25.1122, 56.3240] },
  OMAA: { n: "Abu Dhabi Intl", ll: [24.4330, 54.6511] },
  OMAD: { n: "Al Bateen", ll: [24.4283, 54.4583] },
  OMAM: { n: "Al Dhafra", ll: [24.2483, 54.5477] },
  OMAL: { n: "Al Ain Intl", ll: [24.2617, 55.6092] },
};
export const STATION_IDS = Object.keys(STATIONS);

// Present-weather tokens at the station (not "VC" vicinity).
export function parseWx(w) {
  const out = { at: [], vc: [], hail: false, thunder: false };
  (w || "").split(/\s+/).filter(Boolean).forEach((tok) => {
    const t = tok.replace(/^[-+]/, "");
    if (t.startsWith("VC")) { out.vc.push(t.slice(2)); return; }
    if (/(TS|SH|RA|DZ|GR|GS|UP|SN|PL|SG|IC)/.test(t)) {
      out.at.push(tok);
      if (t.includes("GR") || t.includes("GS")) out.hail = true;
      if (t.includes("TS")) out.thunder = true;
    }
  });
  return out;
}

// Normalise one AviationWeather JSON record.
export function normMetar(r) {
  const wx = parseWx(r.wxString);
  return {
    station: r.icaoId,
    obsMs: r.obsTime * 1000,
    raw: r.rawOb || "",
    wx: r.wxString || "",
    rain: wx.at.length > 0 ? 1 : 0,
    thunder: wx.thunder ? 1 : 0,
    hail: wx.hail ? 1 : 0,
    temp: r.temp ?? null,
  };
}

export async function fetchMetars(ids = STATION_IDS, hours = 3, f = fetch) {
  const url = `https://aviationweather.gov/api/data/metar?ids=${ids.join(",")}&format=json&hours=${hours}`;
  const res = await f(url, { headers: { "User-Agent": "uae-weather-personal/1.0" } });
  if (!res.ok) throw new Error("aviationweather HTTP " + res.status);
  const j = await res.json();
  if (!Array.isArray(j)) throw new Error("aviationweather: unexpected response");
  return { raw: j, norm: j.filter((r) => r.icaoId && r.obsTime).map(normMetar) };
}
