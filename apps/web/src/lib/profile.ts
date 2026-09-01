/** Fichas extendidas de jugador (GET /api/players/:id/profile → PlayerProfile).
 *  Cache en memoria; ante 404/error se muestra solo lo del listone (null). */
import { useEffect, useState } from 'react';
import type { PlayerProfile } from '@fanta/shared';
import { MOCK } from './mock';

const cache = new Map<number, PlayerProfile | null>();
const inflight = new Map<number, Promise<PlayerProfile | null>>();

function mockProfile(id: number): PlayerProfile {
  return {
    url: null,
    height: '183 cm',
    birthDate: '10/11/1997',
    foot: 'Zurdo',
    nationality: 'Italia',
    mv: 6.1 + (id % 7) / 10,
    fm: 6.6 + (id % 9) / 10,
    fvm: 120 + (id % 200),
    description:
      'Ficha de ejemplo del modo mock: carrilero con llegada, fijo en los once y encargado de las pelotas paradas. En el juego real esto sale de fantacalcio.it.',
  };
}

export function getProfile(id: number): Promise<PlayerProfile | null> {
  if (MOCK) return Promise.resolve(mockProfile(id));
  if (cache.has(id)) return Promise.resolve(cache.get(id) ?? null);
  const pending = inflight.get(id);
  if (pending) return pending;
  const p = fetch(`/api/players/${id}/profile`, { credentials: 'include' })
    .then(async (res) => {
      const profile = res.ok ? ((await res.json()) as PlayerProfile) : null;
      cache.set(id, profile);
      return profile;
    })
    .catch(() => {
      // error de red: no cacheamos, para reintentar la próxima vez
      return null;
    })
    .finally(() => {
      inflight.delete(id);
    });
  inflight.set(id, p);
  return p;
}

/** Ficha del jugador, o null mientras carga / si no existe. */
export function useProfile(playerId: number | null): PlayerProfile | null {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  useEffect(() => {
    setProfile(null);
    if (playerId === null) return;
    let alive = true;
    void getProfile(playerId).then((p) => {
      if (alive) setProfile(p);
    });
    return () => {
      alive = false;
    };
  }, [playerId]);
  return profile;
}
