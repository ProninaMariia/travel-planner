import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Stop } from '../types.ts';
import type { Shape } from '../places.ts';

interface Props {
  stops: Stop[];
  /** Road shapes, keyed by the id of the stop the leg arrives at. */
  shapes: Record<string, Shape>;
  onMove: (id: string, lat: number, lon: number) => void;
  /** A click on empty map adds a stop there. */
  onAdd: (lat: number, lon: number) => void;
}

/** A numbered pin, drawn in CSS so no image file has to be bundled. */
const pin = (n: number) =>
  L.divIcon({
    className: '',
    html: `<span class="pin">${n}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

export function RouteMap({ stops, shapes, onMove, onAdd }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const drawn = useRef<L.LayerGroup | null>(null);
  /** How many placed stops the last fit was made for. */
  const fittedFor = useRef(-1);

  // Create the map once. Leaflet owns this DOM node from here on.
  useEffect(() => {
    if (!host.current || map.current) return;

    map.current = L.map(host.current, { scrollWheelZoom: false })
      .setView([49.0, 31.0], 5);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // On a scaled or high-density screen — Windows at 125%, any phone — one
      // map pixel covers more than one screen pixel and the tiles look soft.
      // This loads the next zoom level and draws it at half size instead.
      detectRetina: true,
      attribution: '© OpenStreetMap',
    }).addTo(map.current);

    drawn.current = L.layerGroup().addTo(map.current);

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  /*
   * The click handler is rebound whenever `onAdd` changes, because it closes
   * over the current trip. Leaflet fires this only for clicks on the map
   * itself — a click on a pin never reaches here.
   */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const handler = (e: L.LeafletMouseEvent) => onAdd(e.latlng.lat, e.latlng.lng);
    m.on('click', handler);
    return () => { m.off('click', handler); };
  }, [onAdd]);

  // Redraw pins and lines whenever the route or its shapes change.
  useEffect(() => {
    const m = map.current;
    const layer = drawn.current;
    if (!m || !layer) return;

    layer.clearLayers();

    const placed = stops.filter(s => s.lat != null && s.lon != null);

    placed.forEach((stop, i) => {
      const marker = L.marker([stop.lat as number, stop.lon as number], {
        icon: pin(i + 1),
        draggable: true,
        autoPan: true,
      })
        .bindTooltip(stop.name, { direction: 'top', offset: [0, -14] })
        .on('dragend', e => {
          const { lat, lng } = (e.target as L.Marker).getLatLng();
          onMove(stop.id, lat, lng);
        });
      layer.addLayer(marker);
    });

    // One line per leg, in the order the traveller drives them.
    stops.forEach((stop, i) => {
      const from = stops[i - 1];
      if (!from || from.lat == null || stop.lat == null) return;

      const shape = shapes[stop.id];
      if (shape && shape.length > 1) {
        layer.addLayer(L.polyline(shape, { color: '#2f2a86', weight: 4, opacity: 0.75 }));
      } else {
        // No road shape: either a timetable leg or a route we could not fetch.
        layer.addLayer(L.polyline(
          [[from.lat, from.lon as number], [stop.lat, stop.lon as number]],
          { color: '#2f2a86', weight: 3, opacity: 0.5, dashArray: '6 8' },
        ));
      }
    });

    // Fit only when the number of placed stops changes, so a drag does not
    // yank the view out from under the hand that is dragging.
    if (placed.length && placed.length !== fittedFor.current) {
      fittedFor.current = placed.length;
      const bounds = L.latLngBounds(
        placed.map(s => [s.lat as number, s.lon as number] as [number, number]),
      );
      m.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    }
  }, [stops, shapes, onMove]);

  // The panel opens at a fixed height; Leaflet needs telling once it is visible.
  useEffect(() => {
    const t = window.setTimeout(() => map.current?.invalidateSize(), 60);
    return () => window.clearTimeout(t);
  }, []);

  return <div className="map" ref={host} />;
}
