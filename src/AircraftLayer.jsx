import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { project, decayFactor } from './deadReckon';

// Markers are created and moved directly through Leaflet rather than rendered
// as React components. A requestAnimationFrame loop can then move a thousand
// aircraft every frame without triggering a single React re-render.

const ALTITUDE_BANDS = [
  { max: 0, colour: '#8d8574' }, // on the ground
  { max: 10000, colour: '#c9622f' },
  { max: 24000, colour: '#c99a2f' },
  { max: 34000, colour: '#3f7d58' },
  { max: Infinity, colour: '#2f6f9e' },
];

function altitudeColour(altFt, onGround) {
  if (onGround) return ALTITUDE_BANDS[0].colour;
  const alt = Number.isFinite(altFt) ? altFt : 0;
  return ALTITUDE_BANDS.find((band) => alt <= band.max).colour;
}

function icon(colour, selected) {
  return L.divIcon({
    className: 'aircraft-icon',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<span class="aircraft-glyph${selected ? ' is-selected' : ''}" style="--ac-colour:${colour}">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M12 2 L14 10 L22 13.5 L22 15.5 L14 14 L13.4 19.5 L16 21.2 L16 22.4 L12 21.4 L8 22.4 L8 21.2 L10.6 19.5 L10 14 L2 15.5 L2 13.5 L10 10 Z"/>
        </svg>
      </span>`,
  });
}

export default function AircraftLayer({ flights, selectedId, onSelect, getTrail }) {
  const map = useMap();
  const layerRef = useRef(null);
  const trailRef = useRef(null);
  const statesRef = useRef(new Map());
  const frameRef = useRef(null);
  const selectedRef = useRef(selectedId);

  selectedRef.current = selectedId;

  // Create the layers once.
  useEffect(() => {
    const layer = L.layerGroup().addTo(map);
    layerRef.current = layer;

    return () => {
      layer.remove();
      if (trailRef.current) trailRef.current.remove();
      layerRef.current = null;
      trailRef.current = null;
      statesRef.current.clear();
    };
  }, [map]);

  // Fold each poll's data into the per-aircraft animation state.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const now = performance.now();
    const states = statesRef.current;
    const seen = new Set();

    for (const flight of flights) {
      seen.add(flight.id);
      const existing = states.get(flight.id);

      if (!existing) {
        const colour = altitudeColour(flight.altFt, flight.onGround);
        const marker = L.marker([flight.lat, flight.lon], {
          icon: icon(colour, flight.id === selectedRef.current),
          keyboard: false,
          interactive: true,
        });

        marker.on('click', () => onSelect(flight.id));
        marker.addTo(layer);

        states.set(flight.id, {
          marker,
          colour,
          data: flight,
          baseLat: flight.lat,
          baseLon: flight.lon,
          baseAt: now,
          offsetLat: 0,
          offsetLon: 0,
          offsetAt: now,
          renderedHeading: null,
        });
        continue;
      }

      // Where we currently think the aircraft is, before the new fix is applied.
      const shown = currentPosition(existing, now);
      const colour = altitudeColour(flight.altFt, flight.onGround);

      existing.data = flight;
      existing.baseLat = flight.lat;
      existing.baseLon = flight.lon;
      existing.baseAt = now;
      existing.offsetLat = shown.lat - flight.lat;
      existing.offsetLon = shown.lon - flight.lon;
      existing.offsetAt = now;

      if (colour !== existing.colour) {
        existing.colour = colour;
        existing.marker.setIcon(icon(colour, flight.id === selectedRef.current));
        existing.renderedHeading = null;
      }
    }

    for (const [id, state] of states) {
      if (!seen.has(id)) {
        state.marker.remove();
        states.delete(id);
      }
    }
  }, [flights, onSelect]);

  // Repaint the selection highlight without waiting for the next poll.
  useEffect(() => {
    for (const [id, state] of statesRef.current) {
      state.marker.setIcon(icon(state.colour, id === selectedId));
      state.renderedHeading = null;
    }
  }, [selectedId]);

  // Draw the trail of the selected aircraft only. Drawing every trail would
  // cost a great deal and say very little.
  useEffect(() => {
    if (trailRef.current) {
      trailRef.current.remove();
      trailRef.current = null;
    }
    if (!selectedId) return undefined;

    const draw = () => {
      const points = getTrail(selectedId);
      if (points.length < 2) return;
      if (trailRef.current) {
        trailRef.current.setLatLngs(points);
      } else {
        trailRef.current = L.polyline(points, {
          color: '#c9622f',
          weight: 2,
          opacity: 0.85,
          dashArray: '5 6',
        }).addTo(map);
      }
    };

    draw();
    const timer = setInterval(draw, 2000);
    return () => {
      clearInterval(timer);
      if (trailRef.current) {
        trailRef.current.remove();
        trailRef.current = null;
      }
    };
  }, [selectedId, getTrail, map]);

  // The animation loop.
  useEffect(() => {
    const step = () => {
      const now = performance.now();

      for (const state of statesRef.current.values()) {
        const position = currentPosition(state, now);
        state.marker.setLatLng([position.lat, position.lon]);

        const heading = state.data.headingDeg;
        if (Number.isFinite(heading) && heading !== state.renderedHeading) {
          const element = state.marker.getElement();
          const glyph = element && element.firstElementChild;
          if (glyph) {
            glyph.style.transform = `rotate(${heading}deg)`;
            state.renderedHeading = heading;
          }
        }
      }

      frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  return null;
}

function currentPosition(state, now) {
  const elapsedSec = (now - state.baseAt) / 1000;
  const projected = project(
    state.baseLat,
    state.baseLon,
    state.data.headingDeg,
    state.data.onGround ? 0 : state.data.speedKt,
    elapsedSec
  );

  const decay = decayFactor(now - state.offsetAt);
  return {
    lat: projected.lat + state.offsetLat * decay,
    lon: projected.lon + state.offsetLon * decay,
  };
}
