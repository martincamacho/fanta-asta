import { formatCountdown, useCountdown } from '../lib/useCountdown';
import { useT } from '../i18n';

/** El círculo central de la cancha, dibujado en tiza, que se borra con el tiempo.
 *  Rojo y pulsante bajo 2 segundos. Sin deadline: círculo completo, quieto. */
export function CountdownRing({
  deadline,
  durationMs,
  pausedMs = null,
  className = '',
  accent = false,
}: {
  deadline: number | null;
  durationMs: number;
  /** Si la subasta está pausada: ms restantes congelados (anillo quieto, en oro). */
  pausedMs?: number | null;
  className?: string;
  /** Número/anillo en amarillo lima (acento FantaAsta Buzz — lo usa el tablero). */
  accent?: boolean;
}) {
  const { t } = useT();
  const { remainingMs, fraction, active } = useCountdown(deadline, durationMs);
  const R = 54;
  const C = 2 * Math.PI * R;
  const paused = pausedMs !== null;
  const danger = !paused && active && remainingMs < 2000;
  const stroke = paused
    ? 'var(--color-gold)'
    : danger
      ? 'var(--color-danger)'
      : accent
        ? 'var(--color-lime)'
        : 'var(--color-chalk)';
  const shownFraction = paused
    ? durationMs > 0
      ? Math.min(1, pausedMs / durationMs)
      : 0
    : fraction;
  const shownMs = paused ? pausedMs : remainingMs;
  const hasRing = paused || deadline !== null;

  return (
    <div
      className={`relative [container-type:inline-size] ${className} ${danger ? 'animate-pulse-danger' : ''}`}
      role="timer"
      aria-label={
        paused
          ? t('count.pausedRemaining', { time: formatCountdown(shownMs) })
          : deadline === null
            ? t('count.noLimit')
            : t('count.remaining', { time: formatCountdown(shownMs) })
      }
    >
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        {/* marca de cal borrada */}
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--color-chalk)" strokeOpacity="0.13" strokeWidth="5" />
        {hasRing && (
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke={stroke}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - shownFraction)}
          />
        )}
        {/* punto del mediocampo */}
        <circle cx="60" cy="60" r="2.5" fill="var(--color-chalk)" fillOpacity="0.25" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`font-display font-bold tabular leading-none ${
            paused ? 'text-gold' : danger ? 'text-danger' : accent ? 'text-lime' : 'text-chalk'
          } ${paused ? 'text-[clamp(1.2rem,26cqw,4.2rem)]' : 'text-[clamp(1.4rem,32cqw,5rem)]'}`}
        >
          {!hasRing ? '—' : formatCountdown(shownMs)}
        </span>
        {accent && !paused && hasRing && (
          <span className="mt-1 text-[7cqw] font-semibold uppercase tracking-[0.3em] text-chalk-dim">
            {t('buzzer.seconds')}
          </span>
        )}
        {paused && (
          <span className="mt-1 text-[8cqw] font-semibold uppercase tracking-[0.3em] text-gold">
            {t('count.pause')}
          </span>
        )}
      </div>
    </div>
  );
}
