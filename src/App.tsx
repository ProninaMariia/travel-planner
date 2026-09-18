import { useEffect, useMemo, useRef, useState } from 'react';
import type { Trip, Stop, Leg, TripMode } from './types.ts';
import { computeSchedule } from './schedule.ts';
import { formatMinutes, parseLocal } from './time.ts';
import { blankTrip, loadTrip, saveTrip, clearTrip, newStop } from './storage.ts';
import { searchPlaces, roadLeg, estimateLeg, type Place } from './places.ts';
import { ModePicker } from './components/ModePicker.tsx';
import { StopCard } from './components/StopCard.tsx';
import { LegRow } from './components/LegRow.tsx';

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

  useEffect(() => { if (trip) saveTrip(trip); }, [trip]);

  const schedule = useMemo(() => (trip ? computeSchedule(trip) : null), [trip]);

  if (!trip) {
    return <ModePicker onPick={mode => setTrip(blankTrip(mode))} />;
  }

  const search = (value: string) => {
    setQuery(value);
    window.clearTimeout(timer.current);
    if (value.trim().length < 3) { setHits([]); return; }
    timer.current = window.setTimeout(async () => {
      try {
        setStatus('шукаю…');
        setHits(await searchPlaces(value.trim()));
        setStatus('');
      } catch {
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
      const road = await roadLeg(a, b);
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
    if (!name) return;
    const stop = place
      ? newStop(place.name, place.lat, place.lon, place.label)
      : newStop(name);

    setQuery(''); setHits([]);
    const previous = trip.stops[trip.stops.length - 1];
    stop.leg = await legTo(previous, stop);
    setTrip(t => (t ? { ...t, stops: [...t.stops, stop] } : t));
  };

  const patchStop = (id: string, next: Stop) =>
    setTrip(t => (t ? { ...t, stops: t.stops.map(s => (s.id === id ? next : s)) } : t));

  const removeStop = (id: string) =>
    setTrip(t => (t ? { ...t, stops: t.stops.filter(s => s.id !== id) } : t));

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
              onChange={next => patchStop(stop.id, next)}
              onRemove={() => removeStop(stop.id)}
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
