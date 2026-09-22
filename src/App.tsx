import { useEffect, useMemo, useRef, useState } from 'react';
import type { Trip, Stop, Leg, TripMode } from './types.ts';
import { computeSchedule } from './schedule.ts';
import { formatMinutes, parseLocal } from './time.ts';
import { blankTrip, loadTrip, saveTrip, clearTrip, newStop } from './storage.ts';
import { searchPlaces, reverseGeocode, roadLeg, estimateLeg, type Place, type Shape } from './places.ts';
import { ModePicker } from './components/ModePicker.tsx';
import { StopCard } from './components/StopCard.tsx';
import { LegRow } from './components/LegRow.tsx';
import { RouteMap } from './components/RouteMap.tsx';

const MAP_KEY = 'travel-planner-v2-map';

const dayLabel = (key: string): string => {
  const d = parseLocal(`${key}T12:00`);
  return d ? d.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' }) : key;
};

/** A transit leg is never invented: the timetable is the traveller's to enter. */
const emptyTransitLeg = (): Leg => ({
  mode: 'transit', kind: 'train', departAt: '', arriveAt: '',
});

export function App() {
  const [trip, setTrip] = useState<Trip | null>(() => loadTrip());
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Place[]>([]);
  const [status, setStatus] = useState('');
  const timer = useRef<number | undefined>(undefined);
  /** True while a stop is being added, so a second Enter cannot double it. */
  const adding = useRef(false);
  /** Every search gets a number; only the newest one may show its results. */
  const searchSeq = useRef(0);
  /** The stop just added, scrolled to once it is on screen. */
  const [justAdded, setJustAdded] = useState<string | null>(null);

  /** Road shapes for the map, keyed by the stop each leg arrives at. Derived
   *  data: it is fetched again when needed and never saved with the trip. */
  const [shapes, setShapes] = useState<Record<string, Shape>>({});
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;

  const [mapOpen, setMapOpen] = useState(() => {
    try { return localStorage.getItem(MAP_KEY) !== 'off'; } catch { return true; }
  });

  useEffect(() => { if (trip) saveTrip(trip); }, [trip]);

  useEffect(() => {
    try { localStorage.setItem(MAP_KEY, mapOpen ? 'on' : 'off'); } catch { /* ignore */ }
  }, [mapOpen]);

  /** Fill in any road shape the map is missing — after a reload, that is all
   *  of them. A leg whose fetch fails simply stays a straight dashed line. */
  useEffect(() => {
    if (!trip || trip.mode !== 'car' || !mapOpen) return;
    let cancelled = false;

    (async () => {
      for (let i = 1; i < trip.stops.length; i++) {
        const to = trip.stops[i];
        const from = trip.stops[i - 1];
        if (cancelled) return;
        if (shapesRef.current[to.id]) continue;
        if (to.lat == null || from.lat == null || to.leg?.mode !== 'car') continue;
        try {
          const road = await roadLeg(
            { lat: from.lat, lon: from.lon as number },
            { lat: to.lat, lon: to.lon as number },
          );
          if (!cancelled) setShapes(prev => ({ ...prev, [to.id]: road.shape }));
        } catch {
          /* the dashed line says enough */
        }
      }
    })();

    return () => { cancelled = true; };
  }, [trip?.stops, trip?.mode, mapOpen]);

  /**
   * A new stop lands at the bottom of a long page, where it is easy to miss.
   * Scroll to it and let it glow for a moment, so the answer to "did that
   * work?" is on screen rather than somewhere below the fold.
   */
  useEffect(() => {
    if (!justAdded) return;
    document.getElementById(`stop-${justAdded}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = window.setTimeout(() => setJustAdded(null), 1800);
    return () => window.clearTimeout(t);
  }, [justAdded]);

  const schedule = useMemo(() => (trip ? computeSchedule(trip) : null), [trip]);

  if (!trip) {
    return <ModePicker onPick={mode => setTrip(blankTrip(mode))} />;
  }

  const search = (value: string) => {
    setQuery(value);
    window.clearTimeout(timer.current);
    const mine = ++searchSeq.current;

    if (value.trim().length < 3) { setHits([]); return; }

    timer.current = window.setTimeout(async () => {
      try {
        setStatus('шукаю…');
        const found = await searchPlaces(value.trim());
        // A request already in flight cannot be cancelled, only ignored. Without
        // this the answer lands after the stop is added and reopens the list.
        if (mine !== searchSeq.current) return;
        setHits(found);
        setStatus('');
      } catch {
        if (mine !== searchSeq.current) return;
        setStatus('пошук не вдався');
        setHits([]);
      }
    }, 400);
  };

  /** Distance and driving time between two stops, from roads when we can. */
  const carLeg = async (from: Stop, to: Stop): Promise<Leg> => {
    if (from.lat == null || to.lat == null) {
      return { mode: 'car', source: 'manual', km: 0, minutes: 0 };
    }

    const a = { lat: from.lat, lon: from.lon as number };
    const b = { lat: to.lat, lon: to.lon as number };
    try {
      setStatus('рахую маршрут…');
      const { shape, ...road } = await roadLeg(a, b);
      setShapes(prev => ({ ...prev, [to.id]: shape }));
      setStatus('');
      return { mode: 'car', source: 'road', ...road };
    } catch {
      setStatus('маршрут недоступний — оцінка по прямій');
      const est = estimateLeg(a, b, trip.settings.roadFactor, trip.settings.avgSpeedKmh);
      return { mode: 'car', source: 'estimate', ...est };
    }
  };

  /** Build the leg that reaches a newly added stop, in the trip's mode. */
  const legTo = async (from: Stop | undefined, to: Stop): Promise<Leg | null> => {
    if (!from) return null;
    return trip.mode === 'transit' ? emptyTransitLeg() : carLeg(from, to);
  };

  /**
   * Switching mode is never a dead end: every leg is rebuilt in the new mode.
   * Car legs are recomputed from the map; transit legs go back to empty, because
   * only a timetable knows when a train leaves.
   */
  const switchMode = async (mode: TripMode) => {
    if (mode === trip.mode) return;

    const hasTimetable = trip.stops.some(
      s => s.leg?.mode === 'transit' && s.leg.departAt && s.leg.arriveAt,
    );
    if (mode === 'car' && hasTimetable
      && !confirm('Час рейсів, який ви вписали, буде замінено на відстані. Продовжити?')) {
      return;
    }

    const rebuilt: Stop[] = [];
    for (let i = 0; i < trip.stops.length; i++) {
      const stop = trip.stops[i];
      if (i === 0) { rebuilt.push({ ...stop, leg: null }); continue; }
      if (stop.leg?.mode === mode) { rebuilt.push(stop); continue; }

      const leg = mode === 'transit'
        ? emptyTransitLeg()
        : await carLeg(rebuilt[i - 1], stop);
      rebuilt.push({ ...stop, leg });
    }

    setStatus('');
    setTrip(t => (t ? { ...t, mode, stops: rebuilt } : t));
  };

  const addStop = async (place?: Place) => {
    const name = place ? place.name : query.trim();
    if (!name || adding.current) return;

    adding.current = true;
    // Stop both the pending search and any answer already on its way back.
    window.clearTimeout(timer.current);
    searchSeq.current++;

    const stop = place
      ? newStop(place.name, place.lat, place.lon, place.label)
      : newStop(name);

    setQuery(''); setHits([]);

    try {
      const previous = trip.stops[trip.stops.length - 1];
      stop.leg = await legTo(previous, stop);
      setTrip(t => (t ? { ...t, stops: [...t.stops, stop] } : t));
      setJustAdded(stop.id);
    } finally {
      adding.current = false;
    }
  };

  /** A click on empty map is the other way to add a stop, beside typing. */
  const addAtPoint = async (lat: number, lon: number) => {
    if (adding.current) return;
    adding.current = true;
    setStatus('шукаю назву…');
    const found = await reverseGeocode(lat, lon);
    setStatus('');

    const stop = found
      ? newStop(found.name, lat, lon, found.label)
      : newStop('Точка на карті', lat, lon);

    try {
      const previous = trip.stops[trip.stops.length - 1];
      stop.leg = await legTo(previous, stop);
      setTrip(t => (t ? { ...t, stops: [...t.stops, stop] } : t));
      setJustAdded(stop.id);
    } finally {
      adding.current = false;
    }
  };

  const patchStop = (id: string, next: Stop) =>
    setTrip(t => (t ? { ...t, stops: t.stops.map(s => (s.id === id ? next : s)) } : t));

  /**
   * Removing a stop rewires the one after it: it now arrives from a different
   * place, so its leg has to be rebuilt rather than left pointing at a gap.
   */
  const removeStop = async (id: string) => {
    const i = trip.stops.findIndex(s => s.id === id);
    if (i < 0) return;

    const rest = trip.stops.filter(s => s.id !== id);
    setTrip(t => (t ? { ...t, stops: rest } : t));
    setShapes(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    const after = rest[i];
    if (!after) return;

    const before = rest[i - 1];
    if (!before) {
      setTrip(t => (t ? {
        ...t,
        stops: t.stops.map(s => (s.id === after.id ? { ...s, leg: null } : s)),
      } : t));
      return;
    }

    // A timetable leg keeps the times the traveller typed; a car leg is ours.
    if (trip.mode === 'car') {
      const leg = await carLeg(before, after);
      setTrip(t => (t ? {
        ...t,
        stops: t.stops.map(s => (s.id === after.id ? { ...s, leg } : s)),
      } : t));
    }
  };

  /**
   * Dragging a pin moves the stop: both legs that touch it are recomputed, and
   * the name follows the pin — unless the traveller typed that name, in which
   * case it stays theirs.
   */
  const moveStop = async (id: string, lat: number, lon: number) => {
    const i = trip.stops.findIndex(s => s.id === id);
    if (i < 0) return;

    setStatus('уточнюю місце…');
    const found = await reverseGeocode(lat, lon);
    setStatus('');

    const current = trip.stops[i];
    const moved: Stop = {
      ...current,
      lat,
      lon,
      // A name the traveller typed outranks whatever the map calls this point.
      name: found && !current.renamed ? found.name : current.name,
      label: found ? found.label : '',
    };
    const stops = trip.stops.map(s => (s.id === id ? moved : s));
    setTrip(t => (t ? { ...t, stops } : t));

    if (trip.mode !== 'car') return;

    const before = stops[i - 1];
    const after = stops[i + 1];
    const incoming = before ? await carLeg(before, moved) : null;
    const outgoing = after ? await carLeg(moved, after) : null;

    setTrip(t => {
      if (!t) return t;
      return {
        ...t,
        stops: t.stops.map(s => {
          if (s.id === moved.id && before) return { ...s, leg: incoming };
          if (after && s.id === after.id && outgoing) return { ...s, leg: outgoing };
          return s;
        }),
      };
    });
  };

  const patchLeg = (id: string, leg: Leg) =>
    setTrip(t => (t ? { ...t, stops: t.stops.map(s => (s.id === id ? { ...s, leg } : s)) } : t));

  const totals = schedule!.totals;
  const empty = trip.stops.length === 0;
  let lastDay = '';
  let dayNumber = 0;

  return (
    <>
      <header className="band band--top">
        <div className="band__inner">
        <input
          className="app__title"
          value={trip.title}
          placeholder="Назва поїздки"
          onChange={e => setTrip({ ...trip, title: e.target.value })}
        />
        <label className="hint">
          вирушаємо
          <input
            type="datetime-local"
            value={trip.start}
            onChange={e => setTrip({ ...trip, start: e.target.value })}
          />
        </label>
        <label className="hint">
          транспорт
          <select
            value={trip.mode}
            onChange={e => void switchMode(e.target.value as TripMode)}
          >
            <option value="car">машиною</option>
            <option value="transit">громадським транспортом</option>
          </select>
        </label>
        <span className="grow" />
        {status && <span className="badge">{status}</span>}
        <button
          type="button"
          className="ghost"
          onClick={() => { if (confirm('Почати нову поїздку?')) { clearTrip(); setTrip(null); } }}
        >
          Нова поїздка
        </button>
        </div>
      </header>

      <div className="app">
      <div className="addbar">
        <input
          value={query}
          placeholder={empty ? 'Звідки вирушаєте? — наприклад, Київ' : 'Куди далі? — наприклад, Львів'}
          onChange={e => search(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addStop(hits[0]); } }}
        />
        <button type="button" onClick={() => void addStop(hits[0])}>
          {empty ? 'Це старт' : 'Додати'}
        </button>

        {hits.length > 0 && (
          <ul className="suggest">
            {hits.map(h => (
              <li key={h.label}>
                <button type="button" onClick={() => void addStop(h)}>
                  <b>{h.name}</b>
                  <span className="hint">{h.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {trip.stops.some(s => s.lat != null) && (
        <section className="mapbox">
          <button
            type="button"
            className="ghost mapbox__toggle"
            aria-expanded={mapOpen}
            onClick={() => setMapOpen(o => !o)}
          >
            {mapOpen ? 'Сховати карту' : 'Показати карту'}
          </button>

          {mapOpen && (
            <>
              <RouteMap
                stops={trip.stops}
                shapes={shapes}
                onMove={(id, lat, lon) => void moveStop(id, lat, lon)}
                onAdd={(lat, lon) => void addAtPoint(lat, lon)}
              />
              <p className="hint mapbox__hint">
                Клік по карті додає зупинку, позначку можна перетягнути. Назву
                завжди можна виправити вручну на картці.
              </p>
            </>
          )}
        </section>
      )}

      {empty && (
        <p className="empty">
          Почніть із точки відправлення — звідки ви вирушаєте. Далі додавайте зупинки
          по порядку, решту порахуємо самі.
        </p>
      )}

      <div className="route">
        {trip.stops.map((stop, i) => {
          const scheduled = schedule!.stops[i];
          const rows = [];

          if (scheduled.day !== lastDay) {
            lastDay = scheduled.day;
            dayNumber += 1;
            const day = schedule!.days.find(d => d.key === scheduled.day);
            rows.push(
              <div className="dayhead" key={`day-${scheduled.day}`}>
                <span>День {dayNumber} · {dayLabel(scheduled.day)}</span>
                <span className="dayhead__sum">
                  {trip.mode === 'car' && day ? `${Math.round(day.km)} км · ` : ''}
                  дорога {formatMinutes(day?.travelMinutes ?? 0)} ·
                  зупинки {formatMinutes(day?.activityMinutes ?? 0)}
                </span>
              </div>,
            );
          }

          if (stop.leg) {
            rows.push(
              <LegRow key={`leg-${stop.id}`} leg={stop.leg} onChange={leg => patchLeg(stop.id, leg)} />,
            );
          }

          rows.push(
            <StopCard
              key={stop.id}
              stop={stop}
              scheduled={scheduled}
              isFirst={i === 0}
              isNew={stop.id === justAdded}
              onChange={next => patchStop(stop.id, next)}
              onRemove={() => void removeStop(stop.id)}
            />,
          );

          return rows;
        })}
      </div>
      </div>

      {trip.stops.length > 0 && (
        <footer className="band band--bottom">
          <div className="band__inner totals">
            {trip.mode === 'car' && <span>усього <b>{Math.round(totals.km)} км</b></span>}
            <span>у дорозі <b>{formatMinutes(totals.travelMinutes)}</b></span>
            <span>на зупинках <b>{formatMinutes(totals.activityMinutes)}</b></span>
            <span>днів <b>{totals.days}</b></span>
          </div>
        </footer>
      )}
    </>
  );
}
