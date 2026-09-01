import { useEffect } from 'react';

/** Mantiene la pantalla encendida (el buzzer no puede bloquearse en plena puja).
 *  Silencioso si la API no existe; re-adquiere al volver a la pestaña. */
export function useWakeLock(): void {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let released = false;

    async function acquire(): Promise<void> {
      try {
        if (released || !('wakeLock' in navigator) || document.visibilityState !== 'visible') {
          return;
        }
        lock = await navigator.wakeLock.request('screen');
      } catch {
        /* denegado o sin soporte: seguimos sin lock */
      }
    }

    function onVisibility(): void {
      if (document.visibilityState === 'visible') void acquire();
    }

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void lock?.release().catch(() => {});
    };
  }, []);
}
