/** Watchlist privada por usuario y por sala: jugadores a seguir + budget estimado.
 *  Persistencia: localStorage siempre (fallback offline/anónimo); con sesión
 *  (identidad unificada) se sincroniza con GET/PUT /api/rooms/:code/watchlist
 *  con debounce. 401/404/red → se sigue en modo local sin ruido. */
import { create } from 'zustand';
import { MOCK } from './mock';

export interface WatchEntry {
  playerId: number;
  /** Budget estimado ("hasta cuánto llegaría") — opcional. */
  maxPrice: number | null;
}

function lsKey(code: string): string {
  return `fanta:${code.toUpperCase()}:watchlist`;
}

function sanitize(raw: unknown): WatchEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchEntry[] = [];
  for (const e of raw as Array<Partial<WatchEntry>>) {
    if (e && typeof e.playerId === 'number' && Number.isFinite(e.playerId)) {
      const maxPrice =
        typeof e.maxPrice === 'number' && Number.isFinite(e.maxPrice) && e.maxPrice > 0
          ? Math.floor(e.maxPrice)
          : null;
      if (!out.some((x) => x.playerId === e.playerId)) out.push({ playerId: e.playerId, maxPrice });
    }
  }
  return out;
}

function loadLocal(code: string): WatchEntry[] {
  try {
    const raw = localStorage.getItem(lsKey(code));
    return raw ? sanitize(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function saveLocal(code: string, entries: WatchEntry[]): void {
  try {
    localStorage.setItem(lsKey(code), JSON.stringify(entries));
  } catch {
    /* modo privado sin storage */
  }
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Guarda local al toque y, si hay sesión sincronizada, PUT con debounce. */
function persistEntries(code: string, entries: WatchEntry[], synced: boolean): void {
  saveLocal(code, entries);
  if (!synced || MOCK) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void fetch(`/api/rooms/${encodeURIComponent(code)}/watchlist`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    }).catch(() => {
      /* red caída: queda en localStorage */
    });
  }, 500);
}

interface WatchlistState {
  code: string | null;
  entries: WatchEntry[];
  /** true si el server aceptó el GET (a partir de ahí cada cambio se PUTea). */
  synced: boolean;
  init: (code: string, authed: boolean) => Promise<void>;
  toggle: (playerId: number) => void;
  setMaxPrice: (playerId: number, maxPrice: number | null) => void;
  /** Import: SUMA a la watchlist actual (sin duplicar; el budget entrante pisa al existente). */
  mergeEntries: (incoming: WatchEntry[]) => void;
}

export const useWatchlist = create<WatchlistState>()((set, get) => ({
  code: null,
  entries: [],
  synced: false,

  init: async (code, authed) => {
    const local = loadLocal(code);
    set({ code, entries: local, synced: false });
    if (!authed || MOCK) return;
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/watchlist`, {
        credentials: 'include',
      });
      if (!res.ok) return; // 401/404/endpoint ausente → modo local
      const body = (await res.json()) as { entries?: unknown };
      const remote = sanitize(body.entries);
      if (get().code !== code) return; // cambió de sala mientras tanto
      if (remote.length > 0) {
        // El server manda (identidad unificada entre dispositivos).
        set({ entries: remote, synced: true });
        saveLocal(code, remote);
      } else {
        // Server vacío: subimos lo local (migración anónimo → cuenta).
        set({ synced: true });
        if (local.length > 0) persistEntries(code, local, true);
      }
    } catch {
      /* red: modo local */
    }
  },

  toggle: (playerId) => {
    const { code, entries, synced } = get();
    if (!code) return;
    const next = entries.some((e) => e.playerId === playerId)
      ? entries.filter((e) => e.playerId !== playerId)
      : [...entries, { playerId, maxPrice: null }];
    set({ entries: next });
    persistEntries(code, next, synced);
  },

  setMaxPrice: (playerId, maxPrice) => {
    const { code, entries, synced } = get();
    if (!code) return;
    const next = entries.map((e) => (e.playerId === playerId ? { ...e, maxPrice } : e));
    set({ entries: next });
    persistEntries(code, next, synced);
  },

  mergeEntries: (incoming) => {
    const { code, entries, synced } = get();
    if (!code || incoming.length === 0) return;
    const map = new Map(entries.map((e) => [e.playerId, e] as const));
    for (const e of incoming) {
      const prev = map.get(e.playerId);
      map.set(e.playerId, { playerId: e.playerId, maxPrice: e.maxPrice ?? prev?.maxPrice ?? null });
    }
    const next = [...map.values()];
    set({ entries: next });
    persistEntries(code, next, synced);
  },
}));
