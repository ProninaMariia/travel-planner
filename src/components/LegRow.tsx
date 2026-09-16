import type { Leg, TransitKind } from '../types.ts';
import { formatMinutes } from '../time.ts';

const KIND_LABEL: Record<TransitKind, string> = {
  train: 'Поїзд',
  bus: 'Автобус',
  flight: 'Літак',
};

const SOURCE_LABEL: Record<string, string> = {
  road: 'за дорогами',
  estimate: 'оцінка',
  manual: 'вручну',
};

export function LegRow({ leg, onChange }: { leg: Leg; onChange: (leg: Leg) => void }) {
  if (leg.mode === 'transit') {
    const incomplete = !leg.departAt || !leg.arriveAt;

    return (
      <div className="leg leg--transit">
        <span className="leg__arrow">↓</span>

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
          : <span className="badge">{formatMinutes(
              (new Date(leg.arriveAt).getTime() - new Date(leg.departAt).getTime()) / 60000,
            )}</span>}
      </div>
    );
  }

  return (
    <div className="leg">
      <span className="leg__arrow">↓</span>
      <strong>{Math.round(leg.km)} км</strong>
      <strong>{formatMinutes(leg.minutes)}</strong>
      <span className="badge">{SOURCE_LABEL[leg.source]}</span>

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
  );
}
