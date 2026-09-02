/** Watchlist privada por usuario y por sala: jugadores a seguir + budget estimado.
 *  Persistencia: localStorage siempre (fallback offline/anónimo); con sesión
 *  (identidad unificada) se sincroniza con GET/PUT /api/rooms/:code/watchlist
 *  con debounce. 401/404/red → se sigue en modo local sin ruido. */
import { create } from 'zustand';
import type { Role } from '@fanta/shared';
import { MOCK } from './mock';

export interface WatchEntry {
  playerId: number;
  /** Budget estimado ("hasta cuánto llegaría") — opcional. */
  maxPrice: number | null;
  /** Slot de la pizarra (índice 0-based dentro de los cupos del rol); null = pool "da sistemare". */
  slot: number | null;
  /** Etiqueta libre del usuario ("titolare", "scommessa"…) — máx 40 chars. */
  note: string | null;
}

const NOTE_MAX = 40;

function cleanNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, NOTE_MAX);
  return trimmed === '' ? null : trimmed;
}

function lsKey(code: string): string {
  return `fanta:${code.toUpperCase()}:watchlist`;
}

/* ————— slots de la pizarra por rol —————
 * La CANTIDAD de slots por rol la decide el usuario (los vacíos son solo visuales):
 * no hay campo en el contrato del server para eso, así que vive en localStorage por
 * sala. Lo que viaja al server es el `slot` (orden) de cada jugador seguido. */

export type SlotCounts = Record<Role, number>;

/** Tope de slots por rol (el server valida lo mismo para `slot`). */
export const SLOT_CAP = 50;

function slotsKey(code: string): string {
  return `fanta:${code.toUpperCase()}:watchslots`;
}

function clampCount(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n)
    ? Math.max(0, Math.min(SLOT_CAP, Math.floor(n)))
    : null;
}

function loadSlotCounts(code: string): SlotCounts | null {
  try {
    const raw = localStorage.getItem(slotsKey(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Record<Role, unknown>>;
    const out: Partial<SlotCounts> = {};
    for (const role of ['P', 'D', 'C', 'A'] as const) {
      const n = clampCount(parsed?.[role]);
      if (n === null) return null;
      out[role] = n;
    }
    return out as SlotCounts;
  } catch {
    return null;
  }
}

function saveSlotCounts(code: string, counts: SlotCounts): void {
  try {
    localStorage.setItem(slotsKey(code), JSON.stringify(counts));
  } catch {
    /* modo privado sin storage */
  }
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
      const slot =
        typeof e.slot === 'number' && Number.isInteger(e.slot) && e.slot >= 0 ? e.slot : null;
      if (!out.some((x) => x.playerId === e.playerId)) {
        out.push({ playerId: e.playerId, maxPrice, slot, note: cleanNote(e.note) });
      }
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
  /** Slots por rol de la pizarra (null = todavía sin sembrar; solo localStorage). */
  slotCounts: SlotCounts | null;
  /** true si el server aceptó el GET (a partir de ahí cada cambio se PUTea). */
  synced: boolean;
  init: (code: string, authed: boolean) => Promise<void>;
  toggle: (playerId: number) => void;
  setMaxPrice: (playerId: number, maxPrice: number | null) => void;
  /** Nota libre del slot (≤40 chars; vacío = null). */
  setNote: (playerId: number, note: string | null) => void;
  /** Reasignación de slots en lote (mover/insertar/quitar; slot null = pool). */
  setSlots: (changes: Array<{ playerId: number; slot: number | null }>) => void;
  /** Siembra la cantidad de slots por rol la primera vez (sugerencia: cupos de la sala). */
  ensureSlotCounts: (defaults: SlotCounts) => void;
  setSlotCounts: (counts: SlotCounts) => void;
  /** Import: SUMA a la watchlist actual (sin duplicar; los campos entrantes pisan al existente). */
  mergeEntries: (incoming: WatchEntry[]) => void;
}

export const useWatchlist = create<WatchlistState>()((set, get) => ({
  code: null,
  entries: [],
  slotCounts: null,
  synced: false,

  init: async (code, authed) => {
    const local = loadLocal(code);
    set({ code, entries: local, slotCounts: loadSlotCounts(code), synced: false });
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
      : [...entries, { playerId, maxPrice: null, slot: null, note: null }];
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

  setNote: (playerId, note) => {
    const { code, entries, synced } = get();
    if (!code) return;
    const next = entries.map((e) =>
      e.playerId === playerId ? { ...e, note: cleanNote(note) } : e,
    );
    set({ entries: next });
    persistEntries(code, next, synced);
  },

  setSlots: (changes) => {
    const { code, entries, synced } = get();
    if (!code || changes.length === 0) return;
    const byId = new Map(changes.map((c) => [c.playerId, c.slot] as const));
    const next = entries.map((e) =>
      byId.has(e.playerId) ? { ...e, slot: byId.get(e.playerId) ?? null } : e,
    );
    set({ entries: next });
    persistEntries(code, next, synced);
  },

  ensureSlotCounts: (defaults) => {
    const { code, slotCounts } = get();
    if (!code || slotCounts !== null) return;
    const seeded: SlotCounts = {
      P: clampCount(defaults.P) ?? 0,
      D: clampCount(defaults.D) ?? 0,
      C: clampCount(defaults.C) ?? 0,
      A: clampCount(defaults.A) ?? 0,
    };
    set({ slotCounts: seeded });
    saveSlotCounts(code, seeded);
  },

  setSlotCounts: (counts) => {
    const { code } = get();
    if (!code) return;
    const next: SlotCounts = {
      P: clampCount(counts.P) ?? 0,
      D: clampCount(counts.D) ?? 0,
      C: clampCount(counts.C) ?? 0,
      A: clampCount(counts.A) ?? 0,
    };
    set({ slotCounts: next });
    saveSlotCounts(code, next);
  },

  mergeEntries: (incoming) => {
    const { code, entries, synced } = get();
    if (!code || incoming.length === 0) return;
    const map = new Map(entries.map((e) => [e.playerId, e] as const));
    for (const e of incoming) {
      const prev = map.get(e.playerId);
      map.set(e.playerId, {
        playerId: e.playerId,
        maxPrice: e.maxPrice ?? prev?.maxPrice ?? null,
        slot: e.slot ?? prev?.slot ?? null,
        note: cleanNote(e.note) ?? prev?.note ?? null,
      });
    }
    const next = [...map.values()];
    set({ entries: next });
    persistEntries(code, next, synced);
  },
}));
