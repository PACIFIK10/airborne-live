# Airborne — live flight map

**Live: [airborne-live.vercel.app](https://airborne-live.vercel.app)**

A live map of aircraft currently in the air. React and Leaflet on the front,
a single serverless function on the back, deployed on Vercel. Positions come
from [adsb.lol](https://adsb.lol), a community ADS-B network.

Aircraft are projected forward between 12-second data refreshes, so they move
continuously rather than jumping. Marker colour encodes altitude band; the
selected aircraft shows its recent track.

<img alt="Aircraft over the New York and Philadelphia corridor, coloured by altitude" src="https://github.com/user-attachments/assets/9ab1b881-febc-4375-a9e9-ff415cda49b6" />

## Running it locally

```bash
npm install
npm i -g vercel        # once
vercel dev
```

Use `vercel dev`, not `npm run dev`. Plain `npm run dev` starts Vite only, so
`/api/flights` returns 404 because nothing is serving the function.

Every push to `main` redeploys automatically. There are no environment
variables or API keys to configure.

## Why not OpenSky

The first version used the OpenSky Network with OAuth credentials. It worked
from a laptop and failed in production: requests from Vercel's servers timed
out before OpenSky answered, producing `ConnectTimeoutError` on every call even
with valid credentials. Many public APIs treat cloud-hosted traffic differently
from home connections.

adsb.lol accepts cloud traffic and needs no credentials, which also removes the
secret-handling problem entirely. `api/flights.js` converts its response into
the shape the frontend expects, so the data source is the only thing that
changed — nothing in `src/` knows or cares where positions come from.

## How the map works

- `useFlights` polls `/api/flights` every 12 seconds with the map's current
  bounding box, and keeps the last 30 positions of each aircraft for trails.
- `AircraftLayer` creates and moves Leaflet markers directly instead of
  rendering React components, so a `requestAnimationFrame` loop can move
  roughly 1,200 aircraft without triggering re-renders.
- Between polls each aircraft is projected forward from its last known heading
  and ground speed. When a real position arrives, the difference between
  prediction and reality is faded to zero over 1.5 seconds, so aircraft slide
  into place instead of jumping.
- Only the selected aircraft's trail is drawn. Drawing every trail costs a
  great deal and communicates little.
- If a request fails the map keeps the last positions and says what went wrong
  rather than silently emptying. Responses are cached for 8 seconds, and
  adsb.one is tried as a fallback when adsb.lol is unreachable.

## Next steps

- Log snapshots to Postgres on a schedule with GitHub Actions, then chart
  traffic by hour, altitude band or route.
- Filter by altitude band, aircraft type or operator.
- Put map bounds and the selected aircraft in the URL so views are shareable.
