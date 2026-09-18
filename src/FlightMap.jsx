import { useEffect } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import AircraftLayer from './AircraftLayer';

// A muted basemap keeps the aircraft as the only saturated thing on screen.
const TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png';
const LABELS = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png';
const ATTRIBUTION =
  '&copy; OpenStreetMap contributors &copy; CARTO &middot; aircraft data adsb.lol';

export default function FlightMap({
  centre,
  zoom,
  flights,
  selectedId,
  onSelect,
  onBoundsChange,
  getTrail,
  followId,
}) {
  return (
    <MapContainer
      center={centre}
      zoom={zoom}
      minZoom={4}
      zoomControl={false}
      className="map"
      preferCanvas
    >
      <TileLayer url={TILES} attribution={ATTRIBUTION} />
      <TileLayer url={LABELS} pane="shadowPane" />
      <BoundsReporter onBoundsChange={onBoundsChange} />
      <FollowAircraft flights={flights} followId={followId} />
      <AircraftLayer
        flights={flights}
        selectedId={selectedId}
        onSelect={onSelect}
        getTrail={getTrail}
      />
    </MapContainer>
  );
}

function BoundsReporter({ onBoundsChange }) {
  const map = useMap();

  const report = () => {
    const b = map.getBounds();
    onBoundsChange({
      lamin: b.getSouth(),
      lomin: b.getWest(),
      lamax: b.getNorth(),
      lomax: b.getEast(),
      // Rounded key: polling restarts only on a real change of view, not on
      // every pixel of a drag.
      key: [
        b.getSouth().toFixed(1),
        b.getWest().toFixed(1),
        b.getNorth().toFixed(1),
        b.getEast().toFixed(1),
      ].join(','),
    });
  };

  useEffect(report, []);
  useMapEvents({ moveend: report, zoomend: report });

  return null;
}

function FollowAircraft({ flights, followId }) {
  const map = useMap();

  useEffect(() => {
    if (!followId) return;
    const target = flights.find((f) => f.id === followId);
    if (target) {
      map.panTo([target.lat, target.lon], { animate: true, duration: 0.6 });
    }
    // Pans when a strip is chosen, not on every poll.
  }, [followId]);

  return null;
}
