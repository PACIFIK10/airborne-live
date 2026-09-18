import { useMemo, useState } from 'react';
import FlightMap from './FlightMap';
import { useFlights } from './useFlights';

const START_CENTRE = [39.95, -74.9]; // Philadelphia / South Jersey
const START_ZOOM = 8;

export default function App() {
  const [bounds, setBounds] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [followId, setFollowId] = useState(null);
  const [query, setQuery] = useState('');

  const { flights, status, getTrail } = useFlights(bounds);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matched = term
      ? flights.filter((f) =>
          [f.callsign, f.registration, f.type, f.id].some(
            (v) => v && v.toLowerCase().includes(term)
          )
        )
      : flights;

    return [...matched].sort((a, b) => (b.altFt ?? 0) - (a.altFt ?? 0)).slice(0, 120);
  }, [flights, query]);

  const selectStrip = (id) => {
    setSelectedId(id);
    setFollowId(id);
  };

  return (
    <div className="shell">
      <aside className="panel">
        <header className="panel-head">
          <h1>Airborne</h1>
          <p className="count">
            {status.error ? 'no data' : `${flights.length} in view`}
            {status.updatedAt && !status.error && (
              <span className="stamp">
                {' '}
                updated {new Date(status.updatedAt).toLocaleTimeString()}
              </span>
            )}
          </p>
        </header>

        <label className="search">
          <span className="visually-hidden">Search aircraft</span>
          <input
            type="search"
            value={query}
            placeholder="Callsign, registration or type"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {status.error && (
          <div className="notice" role="alert">
            <strong>Flight data stopped arriving.</strong>
            <span>{status.error}</span>
            <span>The map keeps the last positions it received.</span>
          </div>
        )}

        <div className="strips">
          {visible.length === 0 && !status.error && (
            <p className="empty">
              {status.loading
                ? 'Waiting for the first positions.'
                : 'Nothing matches here. Zoom out or clear the search.'}
            </p>
          )}

          {visible.map((flight) => (
            <Strip
              key={flight.id}
              flight={flight}
              selected={flight.id === selectedId}
              onSelect={() => selectStrip(flight.id)}
            />
          ))}
        </div>

        <footer className="panel-foot">
          Positions from {status.source || 'adsb.lol'}, refreshed every 12 seconds.
          Movement between refreshes is estimated from heading and speed.
        </footer>
      </aside>

      <main className="stage">
        <FlightMap
          centre={START_CENTRE}
          zoom={START_ZOOM}
          flights={flights}
          selectedId={selectedId}
          followId={followId}
          onSelect={setSelectedId}
          onBoundsChange={setBounds}
          getTrail={getTrail}
        />
      </main>
    </div>
  );
}

function Strip({ flight, selected, onSelect }) {
  const climb = flight.verticalRateFpm;
  const trend = !climb || Math.abs(climb) < 200 ? 'level' : climb > 0 ? 'climbing' : 'descending';

  return (
    <button
      type="button"
      className={`strip${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
    >
      <span className="strip-call">{flight.callsign || flight.registration || flight.id.toUpperCase()}</span>
      <span className="strip-type">{flight.type || '—'}</span>
      <span className="strip-alt">
        {flight.onGround ? 'ground' : formatFeet(flight.altFt)}
        <em className={`trend trend-${trend}`}>{trendMark(trend)}</em>
      </span>
      <span className="strip-speed">{formatKnots(flight.speedKt)}</span>
    </button>
  );
}

function trendMark(trend) {
  if (trend === 'climbing') return '↑';
  if (trend === 'descending') return '↓';
  return '·';
}

function formatFeet(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value).toLocaleString()} ft`;
}

function formatKnots(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value)} kt`;
}
