import type { Player, RoomConfig } from '@fanta/shared';
import { useStore } from '../store';
import { MOCK } from './mock';
import { MOCK_CODE, MOCK_PLAYERS } from './mockState';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function createRoom(
  config?: Partial<RoomConfig>,
): Promise<{ code: string; adminToken: string }> {
  if (MOCK) return { code: MOCK_CODE, adminToken: 'mock-token' };
  const res = await fetch('/api/rooms', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  return json(res);
}

export interface RoomCheck {
  exists: boolean;
  leagueName?: string;
  /** Presentes si la sala pertenece a una liga (Fase 5). */
  leagueId?: string;
}

export async function checkRoom(code: string): Promise<RoomCheck> {
  if (MOCK) return { exists: true, leagueName: 'Liga de Prueba' };
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`, { credentials: 'include' });
  if (res.status === 404) return { exists: false };
  return json(res);
}

/** Scope del listone cargado: null = global, "CODE" = listone efectivo de esa sala. */
let loadedScope: string | null | undefined;

/**
 * Carga el listone en la store como Map. Con `roomCode` intenta el listone efectivo de la
 * sala (GET /api/rooms/:code/players — propio si el admin subió CSV); si el endpoint no está
 * o falla, cae al listone global. `force` re-descarga (ej. tras subir un CSV).
 */
export async function loadPlayers(roomCode?: string, force = false): Promise<void> {
  const store = useStore.getState();
  const scope = roomCode?.toUpperCase() ?? null;
  if (!force && store.playersLoaded && loadedScope === scope) return;
  if (MOCK) {
    store.setPlayers(MOCK_PLAYERS);
    loadedScope = scope;
    return;
  }
  let players: Player[] | null = null;
  if (scope) {
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(scope)}/players`, {
        credentials: 'include',
      });
      if (res.ok) players = (await res.json()) as Player[];
    } catch {
      /* endpoint aún no disponible: fallback al global */
    }
  }
  if (!players) {
    const res = await fetch('/api/players', { credentials: 'include' });
    players = await json<Player[]>(res);
  }
  store.setPlayers(players);
  loadedScope = scope;
}

/** Sube el listone propio de la sala (CSV clásico FantaBuzzer o Nome,Squadra,Ruolo,Quotazione). */
export async function uploadListone(
  code: string,
  adminToken: string,
  csv: string,
): Promise<{ count: number }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/listone`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminToken, csv }),
  });
  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      /* sin cuerpo JSON */
    }
    throw new Error(message);
  }
  return json(res);
}
