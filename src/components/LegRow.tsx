import type { Leg, TransitKind } from '../types.ts';
import type { ScheduledBreak } from '../schedule.ts';
import { BREAK_AFTER_MINUTES } from '../schedule.ts';
import { formatMinutes, formatClock, parseLocal, minutesBetween } from '../time.ts';

const KIND_LABEL: Record<TransitKind, string> = {
  train: 'Поїзд',
  bus: 'Автобус',
  flight: 'Літак',
};

/*
 * Where these numbers came from — a caption, not a control. It used to be a
 * coloured pill reading "за дорогами", which a tester took for a button that
 * would open navigation.
 */
const SOURCE_LABEL: Record<string, string> = {
  road: 'пораховано по дорогах',
  estimate: 'оцінка по прямій',
  manual: 'вписано вручну',
};

const InsertHere = ({ onInsert }: { onInsert: () => void }) => (
  <button type="button" className="ghost leg__insert" title="Вставити зупинку сюди" onClick={onInsert}>
    ＋
  </button>
);

function transitMinutes(departAt: string, arriveAt: string): number | null {
  const dep = parseLocal(departAt);
  const arr = parseLocal(arriveAt);
  return dep && arr ? minutesBetween(dep, arr) : null;
}

interface Props {
  leg: Leg;
  onChange: (leg: Leg) => void;
  /** Recommended breaks on this drive (car only). */
  breaks?: ScheduledBreak[];
  onToggleBreak?: (ordinal: number) => void;
  /** Put the next stop here, between these two. */
  onInsert: () => void;
}

export function LegRow({ leg, onChange, breaks = [], onToggleBreak, onInsert }: Props) {
  if (leg.mode === 'transit') {
    const incomplete = !leg.departAt || !leg.arriveAt;

    return (
      <div className="leg leg--transit">
        <span className="leg__arrow">↓</span>
        <InsertHere onInsert={onInsert} />

        <select
          value={leg.kind}
          aria-label="Вид транспорту"
          onChange={e => onChange({ ...leg, kind: e.target.value as TransitKind })}
        >
          {(Object.keys(KIND_LABEL) as TransitKind[]).map(k => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>

        <label>
          відправлення
          <input
            type="datetime-local"
            value={leg.departAt}
            onChange={e => onChange({ ...leg, departAt: e.target.value })}
          />
        </label>

        <label>
          прибуття
          <input
            type="datetime-local"
            value={leg.arriveAt}
            onChange={e => onChange({ ...leg, arriveAt: e.target.value })}
          />
        </label>

        {incomplete
          ? <span className="badge badge--warn">впишіть час із розкладу</span>
          : <span className="badge">{formatMinutes(transitMinutes(leg.departAt, leg.arriveAt))}</span>}
      </div>
    );
  }

  const breakMinutes = breaks.filter(b => b.taken).reduce((t, b) => t + b.minutes, 0);

  return (
    <div className="leg-wrap">
    <div className="leg">
      <span className="leg__arrow">↓</span>
      <InsertHere onInsert={onInsert} />
      <strong>{Math.round(leg.km)} км</strong>
      <strong>{formatMinutes(leg.minutes)}</strong>
      {breakMinutes > 0 && <span className="hint">+ {formatMinutes(breakMinutes)} перерв</span>}
      <span className="hint leg__source">{SOURCE_LABEL[leg.source]}</span>

      <span className="leg__manual">
        <label>
          км
          <input
            type="number"
            min={0}
            value={Math.round(leg.km)}
            onChange={e => onChange({ ...leg, source: 'manual', km: Number(e.target.value) || 0 })}
          />
        </label>
        <label>
          хв
          <input
            type="number"
            min={0}
            step={5}
            value={leg.minutes}
            onChange={e => onChange({ ...leg, source: 'manual', minutes: Number(e.target.value) || 0 })}
          />
        </label>
      </span>
    </div>

    {breaks.length > 0 && (
      <div className="breaks">
        <p className="hint">
          Для вашої безпеки радимо {breaks[0].kind === 'swap' ? 'мінятися за кермом' : 'робити перерву'} кожні{' '}
          {formatMinutes(BREAK_AFTER_MINUTES)} за кермом. Позначте ті, які плануєте, — вони додадуться до часу прибуття.
        </p>
        <ul>
          {breaks.map(b => (
            <li key={b.ordinal}>
              <label>
                <input type="checkbox" checked={b.taken} onChange={() => onToggleBreak?.(b.ordinal)} />
                {b.kind === 'swap' ? 'зміна водія' : 'перерва'} {formatMinutes(b.minutes)} близько{' '}
                <b>{formatClock(b.at)}</b>
                <span className="hint"> · на ≈{Math.round(b.km)}-му км дороги</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    )}
    </div>
  );
}
