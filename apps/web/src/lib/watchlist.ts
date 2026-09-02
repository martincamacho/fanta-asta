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
  /** Slot de la pizarra: índice 0-based DENTRO del grupo; null = pool "da sistemare". */
  slot: number | null;
  /** Etiqueta libre del usuario ("titolare", "scommessa"…) — máx 40 chars. */
  note: string | null;
  /** Agrupación del usuario dentro del rol ("Titolari", "Low cost"…); null = grupo default. */
  group: string | null;
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

/* ————— layout de la pizarra por rol: grupos del usuario + cantidad de slots —————
 * Estructura visible: Rol → grupos nombrados por el usuario → slots. Al server solo
 * viajan `slot` (orden dentro del grupo) y `group` de cada seguido; los GRUPOS VACÍOS,
 * su ORDEN y la CANTIDAD de slots de cada uno no tienen campo en el contrato, así que
 * viven client-side en localStorage por sala (misma clave que los slot counts de antes:
 * `fanta:{CODE}:watchslots`; el formato viejo Record<Role, number> se migra solo, como
 * único grupo default). El grupo default (name: null, "Generale") existe siempre y va
 * primero: las pizarras armadas antes de los grupos caen ahí sin migración de datos. */

export interface BoardGroup {
  /** null = grupo default ("Generale"); si no, nombre libre del usuario (≤40). */
  name: string | null;
  /** Cantidad de slots visibles del grupo (los vacíos son solo visuales). */
  count: number;
  /** Grupo desplegado (default true). */
  open?: boolean;
}

export interface RoleLayout {
  groups: BoardGroup[];
  /** Bloque del rol desplegado (default true). */
  open: boolean;
}

export type BoardLayout = Record<Role, RoleLayout>;

/** Tope de slots por grupo (el server valida lo mismo para `slot`). */
export const SLOT_CAP = 50;

function slotsKey(code: string): string {
  return `fanta:${code.toUpperCase()}:watchslots`;
}

function clampCount(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n)
    ? Math.max(0, Math.min(SLOT_CAP, Math.floor(n)))
    : null;
}

/** Normaliza los grupos de un rol: default primero (único), nombres limpios sin duplicar. */
function normalizeGroups(raw: unknown): BoardGroup[] | null {
  if (!Array.isArray(raw)) return null;
  const out: BoardGroup[] = [{ name: null, count: 0, open: true }];
  const seen = new Set<string>();
  for (const g of raw as Array<Partial<BoardGroup>>) {
    if (!g || typeof g !== 'object') return null;
    const count = clampCount(g.count) ?? 0;
    const open = g.open !== false;
    if (g.name === null || g.name === undefined) {
      out[0] = { name: null, count, open };
    } else if (typeof g.name === 'string') {
      const name = g.name.trim().slice(0, NOTE_MAX);
      if (name !== '' && !seen.has(name)) {
        seen.add(name);
        out.push({ name, count, open });
      }
    } else {
      return null;
    }
  }
  return out;
}

/** Normaliza el layout de un rol; acepta los formatos viejos: número pelado
 *  (= count del default) y array de grupos sin flag `open`. Default: todo abierto. */
function normalizeRole(raw: unknown): RoleLayout | null {
  if (typeof raw === 'number') {
    const n = clampCount(raw);
    return n === null ? null : { groups: [{ name: null, count: n, open: true }], open: true };
  }
  if (Array.isArray(raw)) {
    const groups = normalizeGroups(raw);
    return groups === null ? null : { groups, open: true };
  }
  if (raw && typeof raw === 'object' && 'groups' in raw) {
    const r = raw as Partial<RoleLayout>;
    const groups = normalizeGroups(r.groups);
    return groups === null ? null : { groups, open: r.open !== false };
  }
  return null;
}

function loadLayout(code: string): BoardLayout | null {
  try {
    const raw = localStorage.getItem(slotsKey(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Record<Role, unknown>>;
    const out: Partial<BoardLayout> = {};
    for (const role of ['P', 'D', 'C', 'A'] as const) {
      const roleLayout = normalizeRole(parsed?.[role]);
      if (roleLayout === null) return null;
      out[role] = roleLayout;
    }
    return out as BoardLayout;
  } catch {
    return null;
  }
}

function saveLayout(code: string, layout: BoardLayout): void {
  try {
    localStorage.setItem(slotsKey(code), JSON.stringify(layout));
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
        out.push({
          playerId: e.playerId,
          maxPrice,
          slot,
          note: cleanNote(e.note),
          group: cleanNote(e.group),
        });
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
  /** Layout de la pizarra (grupos + slots por rol; null = todavía sin sembrar; solo localStorage). */
  layout: BoardLayout | null;
  /** true si el server aceptó el GET (a partir de ahí cada cambio se PUTea). */
  synced: boolean;
  init: (code: string, authed: boolean) => Promise<void>;
  toggle: (playerId: number) => void;
  setMaxPrice: (playerId: number, maxPrice: number | null) => void;
  /** Nota libre del slot (≤40 chars; vacío = null). */
  setNote: (playerId: number, note: string | null) => void;
  /** Reasignación de slots en lote (mover/insertar/quitar; slot null = pool).
   *  Si el cambio trae `group`, también mueve al jugador a ese grupo. */
  setSlots: (
    changes: Array<{ playerId: number; slot: number | null; group?: string | null }>,
  ) => void;
  /** Siembra el layout la primera vez: un grupo default por rol con los cupos de la sala. */
  ensureLayout: (defaults: Record<Role, number>) => void;
  setLayout: (layout: BoardLayout) => void;
  /** Import: SUMA a la watchlist actual (sin duplicar; los campos entrantes pisan al existente). */
  mergeEntries: (incoming: WatchEntry[]) => void;
}

export const useWatchlist = create<WatchlistState>()((set, get) => ({
  code: null,
  entries: [],
  layout: null,
  synced: false,

  init: async (code, authed) => {
    const local = loadLocal(code);
    set({ code, entries: local, layout: loadLayout(code), synced: false });
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
      : [...entries, { playerId, maxPrice: null, slot: null, note: null, group: null }];
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
    const byId = new Map(changes.map((c) => [c.playerId, c] as const));
    const next = entries.map((e) => {
      const c = byId.get(e.playerId);
      if (!c) return e;
      return {
        ...e,
        slot: c.slot,
        ...('group' in c ? { group: cleanNote(c.group) } : {}),
      };
    });
    set({ entries: next });
    persistEntries(code, next, synced);
  },

  ensureLayout: (defaults) => {
    const { code, layout } = get();
    if (!code || layout !== null) return;
    const seedRole = (n: number): RoleLayout => ({
      groups: [{ name: null, count: clampCount(n) ?? 0, open: true }],
      open: true,
    });
    const seeded: BoardLayout = {
      P: seedRole(defaults.P),
      D: seedRole(defaults.D),
      C: seedRole(defaults.C),
      A: seedRole(defaults.A),
    };
    set({ layout: seeded });
    saveLayout(code, seeded);
  },

  setLayout: (layout) => {
    const { code } = get();
    if (!code) return;
    const fallback: RoleLayout = { groups: [{ name: null, count: 0, open: true }], open: true };
    const next: BoardLayout = {
      P: normalizeRole(layout.P) ?? fallback,
      D: normalizeRole(layout.D) ?? fallback,
      C: normalizeRole(layout.C) ?? fallback,
      A: normalizeRole(layout.A) ?? fallback,
    };
    set({ layout: next });
    saveLayout(code, next);
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
        group: cleanNote(e.group) ?? prev?.group ?? null,
      });
    }
    const next = [...map.values()];
    set({ entries: next });
    persistEntries(code, next, synced);
  },
}));
