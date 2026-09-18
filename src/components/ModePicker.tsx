import type { TripMode } from '../types.ts';

/**
 * The first screen. It exists as much to explain the app as to collect an answer:
 * testers opened v1 and could not tell what it was for.
 */
export function ModePicker({ onPick }: { onPick: (mode: TripMode) => void }) {
  return (
    <div className="screen--picker">
      <header className="band band--hero">
        <div className="band__inner">
          <h1>Плануєте поїздку?</h1>
          <p className="lead">
            Складіть список місць, скажіть, скільки хочете провести в кожному —
            і побачите, чи вкладається все у ваші дні.
          </p>
        </div>
      </header>

      <div className="picker">
      <p className="question">Як ви подорожуєте?</p>

      <div className="choices">
        <button type="button" className="choice" onClick={() => onPick('car')}>
          <span className="choice__title">Машиною</span>
          <span className="choice__hint">Порахуємо відстань і час у дорозі</span>
        </button>

        <button type="button" className="choice" onClick={() => onPick('transit')}>
          <span className="choice__title">Громадським транспортом</span>
          <span className="choice__hint">Поїзди, автобуси, літаки — за розкладом</span>
        </button>
      </div>
      </div>
    </div>
  );
}
