/** Banditore audible: sonidos sintetizados con Web Audio (sin archivos).
 *  El AudioContext se crea/reanuda recién tras un gesto del usuario (requisito de los browsers). */
import { useCallback, useState } from 'react';

let ctx: AudioContext | null = null;

/** Llamar desde un gesto de usuario (click/tap). Idempotente. */
export function armAudio(): void {
  try {
    if (!ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* sin audio: la app sigue muda */
  }
}

function tone(
  freq: number,
  startIn: number,
  duration: number,
  type: OscillatorType,
  peak: number,
): void {
  if (!ctx || ctx.state !== 'running') return;
  try {
    const t0 = ctx.currentTime + startIn;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  } catch {
    /* nunca romper por audio */
  }
}

export const sound = {
  /** Beep del countdown en los últimos 3 segundos; el último, más agudo. */
  tick(last: boolean): void {
    tone(last ? 1320 : 880, 0, 0.12, 'square', 0.12);
  },
  /** Martillazo de "vendido": acorde breve descendente. */
  sold(): void {
    tone(660, 0, 0.5, 'triangle', 0.22);
    tone(495, 0.09, 0.5, 'triangle', 0.18);
    tone(330, 0.18, 0.65, 'triangle', 0.2);
    tone(165, 0.18, 0.5, 'sine', 0.16);
  },
  /** Blip suave por oferta nueva (tablero). */
  blip(): void {
    tone(1180, 0, 0.07, 'sine', 0.07);
  },
};

/** Preferencia de sonido por vista, persistida (default: tablero sí, buzzer no). */
export function useSoundPref(view: 'board' | 'buzzer'): { enabled: boolean; toggle: () => void } {
  const key = `fanta:sound:${view}`;
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return raw === '1';
    } catch {
      /* sin storage */
    }
    return view === 'board';
  });
  const toggle = useCallback(() => {
    armAudio(); // el click del toggle es un gesto: aprovechamos para armar el audio
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        /* sin storage */
      }
      return next;
    });
  }, [key]);
  return { enabled, toggle };
}
