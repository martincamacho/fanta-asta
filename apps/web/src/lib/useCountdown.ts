import { useEffect, useState } from 'react';
import type { RoomState } from '@fanta/shared';
import { useStore } from '../store';

export interface Countdown {
  /** ms restantes según el reloj del servidor (nunca negativo). */
  remainingMs: number;
  /** 0..1 — fracción del timer configurado que queda. */
  fraction: number;
  active: boolean;
}

/** Countdown sincronizado con el server: deadline - (Date.now() + offset), vía rAF.
 *  Nunca cuenta por su cuenta — cada snapshot recalibra el offset. */
export function useCountdown(deadline: number | null, durationMs: number): Countdown {
  const [snap, setSnap] = useState<Countdown>({ remainingMs: 0, fraction: 0, active: false });

  useEffect(() => {
    if (deadline === null) {
      setSnap({ remainingMs: 0, fraction: 0, active: false });
      return;
    }
    let raf = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      const offset = useStore.getState().serverOffset;
      const remainingMs = Math.max(0, deadline - (Date.now() + offset));
      setSnap({
        remainingMs,
        fraction: durationMs > 0 ? Math.min(1, remainingMs / durationMs) : 0,
        active: remainingMs > 0,
      });
      if (remainingMs > 0) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [deadline, durationMs]);

  return snap;
}

/** Duración total del timer vigente según la fase (para la fracción del anillo). */
export function auctionTimerMs(state: RoomState): number {
  const { phase } = state.auction;
  if (phase === 'bidding') return state.config.bidTimerSeconds * 1000;
  if (phase === 'called') return state.config.callTimerSeconds * 1000;
  return 0;
}

/** "M:SS" si queda ≥1 min; "S.d" (décimas) bajo 10s; "SS" en el medio. */
export function formatCountdown(remainingMs: number): string {
  if (remainingMs >= 60_000) {
    const totalSec = Math.ceil(remainingMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  if (remainingMs < 10_000) {
    return (Math.ceil(remainingMs / 100) / 10).toFixed(1);
  }
  return Math.ceil(remainingMs / 1000).toString();
}
