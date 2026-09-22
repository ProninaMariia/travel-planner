import { useState } from 'react';
import type { Stop, Activity } from '../types.ts';
import type { ScheduledStop } from '../schedule.ts';
import { formatClock, formatMinutes } from '../time.ts';
import { uid } from '../storage.ts';

const WARNING_TEXT: Record<string, string> = {
  'overnight-en-route': 'ночівля в дорозі',
  'activities-spill-over': 'не вміщується в день',
  'pinned-earlier-than-possible': 'закріплений час настає раніше, ніж можна доїхати',
  'will-miss-departure': 'не встигаєте на відправлення',
  'arrives-before-it-leaves': 'прибуття раніше за відправлення',
  'bad-times': 'час рейсу не заповнений',
  'no-leg': 'немає даних про дорогу сюди',
};

interface Props {
  stop: Stop;
  scheduled: ScheduledStop;
  /** The first stop is where the trip begins — it is departed from, not arrived at. */
  isFirst: boolean;
  /** Just added: worth a moment of attention. */
  isNew: boolean;
  onChange: (stop: Stop) => void;
  onRemove: () => void;
}

export function StopCard({ stop, scheduled, isFirst, isNew, onChange, onRemove }: Props) {
  const [draft, setDraft] = useState('');

  /**
   * One code path, one push. The draft is cleared in the same update, so a
   * second submit — however it is triggered — has nothing left to add.
   */
  const addActivity = () => {
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    const activity: Activity = { id: uid(), title, minutes: 60 };
    onChange({ ...stop, activities: [...stop.activities, activity] });
  };

  const patchActivity = (id: string, patch: Partial<Activity>) =>
    onChange({
      ...stop,
      activities: stop.activities.map(a => (a.id === id ? { ...a, ...patch } : a)),
    });

  const removeActivity = (id: string) =>
    onChange({ ...stop, activities: stop.activities.filter(a => a.id !== id) });

  const free = scheduled.freeMinutes;

  return (
    <article className={isNew ? 'card card--new' : 'card'} id={`stop-${stop.id}`}>
      <header className="card__top">
        <input
          className="card__name"
          value={stop.name}
          aria-label="Назва зупинки"
          onChange={e => onChange({ ...stop, name: e.target.value, renamed: true })}
        />
        {isFirst && <span className="badge badge--start">звідки вирушаємо</span>}

        <button
          type="button"
          className={stop.overnight ? 'ghost ghost--on' : 'ghost'}
          title="Ночівля тут"
          onClick={() => onChange({ ...stop, overnight: !stop.overnight })}
        >
          🌙
        </button>

        <button type="button" className="ghost" title="Прибрати зупинку" onClick={onRemove}>
          ✕
        </button>
      </header>

      <p className="times">
        <span>
          {isFirst ? 'старт' : 'приїзд'} <b>{formatClock(scheduled.arrive)}</b>
        </span>
        <span>
          {isFirst ? 'виїзд' : "від'їзд"} <b>{formatClock(scheduled.depart)}</b>
        </span>
        {free !== null && (
          <span className={free < 0 ? 'free free--negative' : 'free'}>
            {free < 0 ? 'не вистачає ' : 'вільно '}
            <b>{formatMinutes(Math.abs(free))}</b>
          </span>
        )}
      </p>

      {scheduled.warnings.length > 0 && (
        <p className="warnings">
          {scheduled.warnings.map(w => (
            <span key={w} className="badge badge--warn">{WARNING_TEXT[w] ?? w}</span>
          ))}
        </p>
      )}

      <ul className="acts">
        {stop.activities.map(a => (
          <li key={a.id}>
            <input
              className="acts__title"
              value={a.title}
              onChange={e => patchActivity(a.id, { title: e.target.value })}
            />
            <input
              className="acts__minutes"
              type="number"
              min={0}
              step={15}
              value={a.minutes}
              onChange={e => patchActivity(a.id, { minutes: Number(e.target.value) || 0 })}
            />
            <span className="hint">хв</span>
            <button type="button" className="ghost" onClick={() => removeActivity(a.id)}>✕</button>
          </li>
        ))}
      </ul>

      <form
        className="acts__add"
        onSubmit={e => { e.preventDefault(); addActivity(); }}
      >
        <input
          value={draft}
          placeholder="що тут зробити…"
          onChange={e => setDraft(e.target.value)}
        />
        <button type="submit" disabled={!draft.trim()}>Додати</button>
      </form>
    </article>
  );
}
