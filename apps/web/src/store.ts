import { create } from 'zustand';
import type { ErrorPayload, Player, RoomEvent, RoomState } from '@fanta/shared';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';

/** Venta/asignación acumulada en la sesión (feed "Assegnazioni"; se pierde al recargar). */
export interface AssignmentRecord {
  playerId: number;
  participantId: string;
  price: number;
  /** Reloj local, para mostrar la hora. */
  at: number;
  /** true si vino de un ajuste manual del admin. */
  manual: boolean;
}

export interface AppState {
  /** Snapshot completo de la sala (el server es la única fuente de verdad). */
  state: RoomState | null;
  /** Último evento que acompañó un snapshot — para disparar animaciones. */
  lastEvent: RoomEvent | null;
  /** Se incrementa con cada snapshot con evento; usalo como `key` para re-animar. */
  eventSeq: number;
  connection: ConnectionStatus;
  /** Error al hacer room:join (sala llena, nombre tomado, etc.). */
  joinError: string | null;
  /** Último room:error del server (oferta rechazada, etc.). */
  lastError: ErrorPayload | null;
  errorSeq: number;
  /** Mi participantId (solo en vista buzzer). */
  selfId: string | null;
  /** offset = serverTime - Date.now(), recalculado con cada snapshot. */
  serverOffset: number;
  /** Listone cargado de /api/players. */
  players: Map<number, Player>;
  playersLoaded: boolean;
  /** Historial de ventas de la sesión (eventos 'sold'/'assigned'). */
  assignments: AssignmentRecord[];

  applySnapshot: (state: RoomState, event?: RoomEvent) => void;
  setConnection: (c: ConnectionStatus) => void;
  setJoinError: (e: string | null) => void;
  flashError: (e: ErrorPayload) => void;
  setSelfId: (id: string | null) => void;
  setPlayers: (players: Player[]) => void;
  resetRoom: () => void;
}

export const useStore = create<AppState>()((set) => ({
  state: null,
  lastEvent: null,
  eventSeq: 0,
  connection: 'idle',
  joinError: null,
  lastError: null,
  errorSeq: 0,
  selfId: null,
  serverOffset: 0,
  players: new Map(),
  playersLoaded: false,
  assignments: [],

  applySnapshot: (state, event) =>
    set((s) => ({
      state,
      serverOffset: state.serverTime - Date.now(),
      lastEvent: event ?? s.lastEvent,
      eventSeq: event ? s.eventSeq + 1 : s.eventSeq,
      assignments:
        event && (event.type === 'sold' || event.type === 'assigned')
          ? [
              ...s.assignments,
              {
                playerId: event.playerId,
                participantId: event.participantId,
                price: event.price,
                at: Date.now(),
                manual: event.type === 'assigned',
              },
            ]
          : s.assignments,
    })),

  setConnection: (connection) => set({ connection }),
  setJoinError: (joinError) => set({ joinError }),
  flashError: (lastError) => set((s) => ({ lastError, errorSeq: s.errorSeq + 1 })),
  setSelfId: (selfId) => set({ selfId }),
  setPlayers: (players) =>
    set({ players: new Map(players.map((p) => [p.id, p])), playersLoaded: true }),

  resetRoom: () =>
    set({
      state: null,
      lastEvent: null,
      eventSeq: 0,
      connection: 'idle',
      joinError: null,
      lastError: null,
      selfId: null,
      serverOffset: 0,
      assignments: [],
    }),
}));

/** Hora actual del reloj del servidor (para countdowns). */
export function serverNow(): number {
  return Date.now() + useStore.getState().serverOffset;
}
