// Serverless function: fetches live aircraft positions and hands the frontend
// a clean, stable shape.
//
// Data source is adsb.lol (free, no account, no keys). It accepts requests from
// cloud servers, which is why this replaced OpenSky: OpenSky times out when the
// request comes from Vercel rather than a home connection.
//
// The frontend sends a bounding box. adsb.lol works in centre-point + radius,
// so we convert, then filter the results back down to the box.

const CACHE_TTL_MS = 8000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_AIRCRAFT = 1500;

// Cached in module scope. Vercel reuses a warm function instance between
// requests, so repeat callers inside the TTL get the cached copy instead of
// hitting the upstream API again.
const cache = new Map();

const SOURCES = [
  {
    name: 'adsb.lol',
    url: (lat, lon, dist) =>
      `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
  },
  {
    name: 'adsb.one',
    url: (lat, lon, dist) =>
      `https://api.adsb.one/v2/point/${lat}/${lon}/${dist}`,
  },
];

export default async function handler(req, res) {
  const lamin = Number(req.query.lamin);
  const lomin = Number(req.query.lomin);
  const lamax = Number(req.query.lamax);
  const lomax = Number(req.query.lomax);

  const box = [lamin, lomin, lamax, lomax];
  if (box.some((v) => !Number.isFinite(v))) {
    res.status(400).json({
      error: 'Missing map bounds.',
      detail: 'Expected numeric lamin, lomin, lamax and lomax query values.',
    });
    return;
  }

  const centreLat = (lamin + lamax) / 2;
  const centreLon = (lomin + lomax) / 2;
  const radiusNm = boxRadiusNm(lamin, lomin, lamax, lomax);

  // Round the cache key so small map nudges reuse the same upstream response.
  const key = [
    centreLat.toFixed(1),
    centreLon.toFixed(1),
    Math.round(radiusNm / 10) * 10,
  ].join(':');

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=8');
    res.status(200).json({ ...hit.payload, cached: true });
    return;
  }

  const failures = [];

  for (const source of SOURCES) {
    try {
      const raw = await fetchJson(source.url(centreLat.toFixed(4), centreLon.toFixed(4), radiusNm));
      const flights = normalise(raw, { lamin, lomin, lamax, lomax });

      const payload = {
        source: source.name,
        updated: Date.now(),
        count: flights.length,
        flights,
      };

      cache.set(key, { at: Date.now(), payload });
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=8');
      res.status(200).json({ ...payload, cached: false });
      return;
    } catch (err) {
      // Try the next source rather than failing on the first outage.
      failures.push(`${source.name}: ${err.message}`);
    }
  }

  res.status(502).json({
    error: 'No flight data source responded.',
    detail: failures.join(' | '),
  });
}

async function fetchJson(url) {
  // Without a timeout a stalled upstream connection hangs until the platform
  // kills the function, which produces a far less useful error.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'airborne-live-flight-map',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Half the diagonal of the bounding box, in nautical miles. One degree of
// latitude is 60 NM; longitude degrees shrink towards the poles by cos(lat).
function boxRadiusNm(lamin, lomin, lamax, lomax) {
  const centreLat = (lamin + lamax) / 2;
  const halfLatNm = ((lamax - lamin) / 2) * 60;
  const halfLonNm = ((lomax - lomin) / 2) * 60 * Math.cos((centreLat * Math.PI) / 180);
  const radius = Math.sqrt(halfLatNm ** 2 + halfLonNm ** 2);
  return Math.min(250, Math.max(5, Math.round(radius)));
}

// Upstream fields: flight (callsign), hex, lat, lon, alt_baro (feet or the
// string "ground"), gs (knots), track (degrees), baro_rate (feet per minute),
// r (registration), t (ICAO type), squawk.
function normalise(raw, box) {
  const list = Array.isArray(raw?.ac) ? raw.ac : [];
  const out = [];

  for (const ac of list) {
    const lat = Number(ac.lat);
    const lon = Number(ac.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < box.lamin || lat > box.lamax) continue;
    if (lon < box.lomin || lon > box.lomax) continue;

    const onGround = ac.alt_baro === 'ground';
    const altFt = onGround ? 0 : toNumber(ac.alt_baro);

    out.push({
      id: String(ac.hex || '').trim().toLowerCase(),
      callsign: String(ac.flight || '').trim() || null,
      registration: String(ac.r || '').trim() || null,
      type: String(ac.t || '').trim() || null,
      squawk: String(ac.squawk || '').trim() || null,
      lat,
      lon,
      altFt,
      speedKt: toNumber(ac.gs),
      headingDeg: toNumber(ac.track),
      verticalRateFpm: toNumber(ac.baro_rate),
      onGround,
      seenSec: toNumber(ac.seen_pos),
    });

    if (out.length >= MAX_AIRCRAFT) break;
  }

  return out.filter((f) => f.id);
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
