import { useState } from 'react';
import type { Stop, Activity } from '../types.ts';
import type { ScheduledStop, Warning, Note } from '../schedule.ts';
import { formatClock, formatMinutes, dayKey } from '../time.ts';
import { formatCurfew, CURFEW_CHECKED } from '../curfew.ts';
import { uid } from '../storage.ts';

/** Every warning says what is wrong and what to do about it. */
const WARNING_TEXT: Record<Warning, string> = {
  // Replaced in the card with the traveller's own limit when they set one.
  'overnight-en-route': 'Комендантська година застане вас у дорозі — додайте зупинку з ночівлею по дорозі.',
  'activity-moved': 'До ночі все не вміщується — частину планів перенесено на наступний ранок.',
  'activity-too-long': 'Одна зі справ довша, ніж дозволяє день до комендантської години.',
  'will-miss-departure': 'Не встигаєте на відправлення — скоротіть плани тут.',
  'arrives-before-it-leaves': 'Прибуття раніше за відправлення — перевірте час рейсу.',
  'bad-times': 'Впишіть час відправлення і прибуття з розкладу.',
  'no-leg': 'Немає даних про дорогу сюди.',
  'leg-unknown': 'Відстань невідома: місце без координат. Впишіть км і час на відрізку вище.',
  'arrives-during-curfew':
    'Прибуття під час комендантської години. Квиток діє як перепустка, або можна дочекатися її кінця на вокзалі.',
  'departs-during-curfew':
    'Відправлення під час комендантської години: на вокзал треба приїхати до її початку, або квиток діє як перепустка.',
};

interface Props {
  stop: Stop;
  scheduled: ScheduledStop;
  /** Position in the route, the same number as on the map pin. */
  number: number;
  /** The first stop is where the trip begins — it is departed from, not arrived at. */
  isFirst: boolean;
  /** Just added: worth a moment of attention. */
  isNew: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: number) => void;
  /** The traveller's own "I don't drive after", if set. */
  driveUntil: string | null;
  onChange: (stop: Stop) => void;
  onRemove: () => void;
}

export function StopCard({
  stop, scheduled, number, isFirst, isNew, driveUntil, canMoveUp, canMoveDown, onMove, onChange, onRemove,
}: Props) {
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
  const departClock = formatClock(scheduled.depart);
  const departsLaterDay = dayKey(scheduled.depart) !== scheduled.day;

  const noteText = (note: Note): string => {
    switch (note) {
      case 'night-curfew':
        return `Далі сьогодні не встигаєте до комендантської години — ночуєте тут. Виїзд о ${departClock}.`;
      case 'night-limit':
        return `Ви не їдете після ${driveUntil ?? '—'} — ночуєте тут. Виїзд о ${departClock}.`;
      case 'wait-curfew':
        return `Виїзд о ${departClock}: до цього діє комендантська година.`;
      case 'wait-limit':
        return `Виїзд о ${departClock}: так налаштовані ваші години в дорозі (угорі).`;
    }
  };

  const warningText = (w: Warning): string =>
    w === 'overnight-en-route' && driveUntil
      ? `Дорогу не проїхати до комендантської години чи до ${driveUntil} — додайте зупинку з ночівлею по дорозі.`
      : WARNING_TEXT[w] ?? w;

  // ---- curfew ----
  const { curfew, source, regionName } = scheduled.curfew;
  const override = stop.curfewOverride;
  const curfewSource =
    source === 'override' ? 'виправлено вручну'
      : source === 'default' ? 'область невідома — взято найпоширеніші години'
        : source === 'abroad' ? 'за кордоном'
          : `за даними на ${CURFEW_CHECKED.split('-').reverse().join('.')}`;

  const setHours = (start: string, end: string) =>
    onChange({ ...stop, curfewOverride: { kind: 'hours', start, end } });

  const clearOverride = () => {
    const { curfewOverride: _gone, ...rest } = stop;
    void _gone;
    onChange(rest);
  };

  return (
    <article className={isNew ? 'card card--new' : 'card'} id={`stop-${stop.id}`}>
      <header className="card__top">
        <span className="card__num" aria-hidden="true">{number}</span>
        <input
          className="card__name"
          value={stop.name}
          aria-label="Назва зупинки"
          onChange={e => onChange({ ...stop, name: e.target.value, renamed: true })}
        />
        {isFirst && <span className="badge badge--start">звідси вирушаємо</span>}
        {stop.lat == null && (
          <span className="badge badge--warn" title="Місце не знайдено на карті, тож відстань не рахується">
            без координат
          </span>
        )}

        <button
          type="button"
          className="ghost"
          title="Раніше в маршруті"
          aria-label="Раніше в маршруті"
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="ghost"
          title="Пізніше в маршруті"
          aria-label="Пізніше в маршруті"
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
        >
          ↓
        </button>

        <button
          type="button"
          className={stop.overnight ? 'ghost ghost--on' : 'ghost'}
          aria-pressed={stop.overnight}
          title="Залишитися тут на ніч, навіть якщо можна їхати далі"
          onClick={() => onChange({ ...stop, overnight: !stop.overnight })}
        >
          🌙 Ночую тут
        </button>

        <button type="button" className="ghost" title="Видалити зупинку" aria-label="Видалити зупинку" onClick={onRemove}>
          ✕
        </button>
      </header>

      <p className="times">
        <span>
          {isFirst ? 'старт' : 'приїзд'} <b>{formatClock(scheduled.arrive)}</b>
        </span>
        <span>
          {isFirst ? 'виїзд' : "від'їзд"} <b>{departClock}</b>
          {departsLaterDay && <span className="hint"> наступного дня</span>}
        </span>
        {free !== null && (
          <span className={free < 0 ? 'free free--negative' : 'free'}>
            {free < 0 ? 'не вистачає ' : 'вільно '}
            <b>{formatMinutes(Math.abs(free))}</b>
          </span>
        )}
        {scheduled.nightHere && <span className="badge">ночівля тут</span>}
      </p>

      {scheduled.notes.length > 0 && (
        <ul className="notes">
          {scheduled.notes.map(n => <li key={n}>{noteText(n)}</li>)}
        </ul>
      )}

      {scheduled.warnings.length > 0 && (
        <ul className="warnings">
          {scheduled.warnings.map(w => <li key={w}>{warningText(w)}</li>)}
        </ul>
      )}

      <ul className="acts">
        {stop.activities.map(a => {
          const planned = scheduled.activities.find(p => p.id === a.id);
          return (
            <li key={a.id}>
              <span className={planned?.moved ? 'acts__when acts__when--moved' : 'acts__when'}>
                {planned && a.minutes > 0
                  ? `${formatClock(planned.start)}–${formatClock(planned.end)}`
                  : '—'}
                {planned && dayKey(planned.start) !== scheduled.day && <small> наст. день</small>}
              </span>
              <input
                className="acts__title"
                value={a.title}
                aria-label="Що зробити"
                onChange={e => patchActivity(a.id, { title: e.target.value })}
              />
              <input
                className="acts__minutes"
                type="number"
                min={0}
                step={15}
                value={a.minutes}
                aria-label="Скільки хвилин"
                onChange={e => patchActivity(a.id, { minutes: Number(e.target.value) || 0 })}
              />
              <span className="hint">хв</span>
              <button type="button" className="ghost" aria-label="Прибрати" onClick={() => removeActivity(a.id)}>✕</button>
            </li>
          );
        })}
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

      <details className="curfew">
        <summary>
          Комендантська: <b>{formatCurfew(curfew)}</b>
          {regionName && <> · {regionName}</>}
          <span className="hint"> ({curfewSource})</span>
        </summary>
        <div className="curfew__edit">
          <label>
            <input
              type="checkbox"
              checked={curfew === null}
              onChange={e => (e.target.checked
                ? onChange({ ...stop, curfewOverride: { kind: 'none' } })
                : setHours('00:00', '05:00'))}
            />
            немає
          </label>
          {curfew && (
            <>
              <label>
                з
                <input type="time" value={curfew.start} onChange={e => e.target.value && setHours(e.target.value, curfew.end)} />
              </label>
              <label>
                до
                <input type="time" value={curfew.end} onChange={e => e.target.value && setHours(curfew.start, e.target.value)} />
              </label>
            </>
          )}
          {override && <button type="button" className="ghost" onClick={clearOverride}>як у таблиці</button>}
        </div>
      </details>
    </article>
  );
}
