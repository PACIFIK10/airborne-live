import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 12000;
const TRAIL_LENGTH = 30;

/**
 * Polls /api/flights for the visible map area and keeps a short position
 * history per aircraft so trails can be drawn.
 *
 * Only the visible bounding box is requested. Asking for the whole world and
 * discarding most of it would be slower and heavier for no benefit.
 */
export function useFlights(bounds) {
  const [flights, setFlights] = useState([]);
  const [status, setStatus] = useState({
    loading: false,
    error: null,
    updatedAt: null,
    source: null,
  });

  const trailsRef = useRef(new Map());
  const boundsRef = useRef(bounds);
  const inFlightRef = useRef(null);

  boundsRef.current = bounds;

  const load = useCallback(async () => {
    const box = boundsRef.current;
    if (!box) return;

    // Drop any request still running: its bounds are already stale.
    if (inFlightRef.current) inFlightRef.current.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;

    setStatus((s) => ({ ...s, loading: true }));

    const params = new URLSearchParams({
      lamin: box.lamin.toFixed(4),
      lomin: box.lomin.toFixed(4),
      lamax: box.lamax.toFixed(4),
      lomax: box.lomax.toFixed(4),
    });

    try {
      const response = await fetch(`/api/flights?${params}`, {
        signal: controller.signal,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || `HTTP ${response.status}`);
      }

      const next = Array.isArray(data.flights) ? data.flights : [];
      recordTrails(trailsRef.current, next);

      setFlights(next);
      setStatus({
        loading: false,
        error: null,
        updatedAt: Date.now(),
        source: data.source || null,
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      setStatus((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => {
    if (!bounds) return undefined;
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
    // Re-polling on every pixel of map movement would hammer the API, so the
    // effect keys on rounded bounds supplied by the caller.
  }, [bounds?.key, load]);

  const getTrail = useCallback((id) => trailsRef.current.get(id) || [], []);

  return { flights, status, getTrail, refresh: load };
}

function recordTrails(store, flights) {
  const seen = new Set();

  for (const flight of flights) {
    seen.add(flight.id);
    const history = store.get(flight.id) || [];
    const last = history[history.length - 1];

    if (!last || last[0] !== flight.lat || last[1] !== flight.lon) {
      history.push([flight.lat, flight.lon]);
      if (history.length > TRAIL_LENGTH) history.shift();
      store.set(flight.id, history);
    }
  }

  // Forget aircraft that have left the area, or the map would leak memory
  // over a long session.
  for (const id of store.keys()) {
    if (!seen.has(id)) store.delete(id);
  }
}
