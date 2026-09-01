import { useEffect, useState } from 'react';
import { checkRoom } from './api';

export type RoomGuard =
  | { status: 'checking' }
  | { status: 'ok'; leagueName?: string; leagueId?: string }
  | { status: 'missing' };

/** Verifica que la sala exista (GET /api/rooms/:code) antes de conectar el socket. */
export function useRoomGuard(code: string | undefined): RoomGuard {
  const [guard, setGuard] = useState<RoomGuard>({ status: 'checking' });
  useEffect(() => {
    if (!code) {
      setGuard({ status: 'missing' });
      return;
    }
    let alive = true;
    setGuard({ status: 'checking' });
    checkRoom(code)
      .then((r) => {
        if (!alive) return;
        setGuard(
          r.exists
            ? { status: 'ok', leagueName: r.leagueName, leagueId: r.leagueId }
            : { status: 'missing' },
        );
      })
      .catch(() => {
        if (alive) setGuard({ status: 'missing' });
      });
    return () => {
      alive = false;
    };
  }, [code]);
  return guard;
}
