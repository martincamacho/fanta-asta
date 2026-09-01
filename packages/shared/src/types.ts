/** Roles clásicos del fantacalcio. */
export type Role = 'P' | 'D' | 'C' | 'A';

export const ROLES: readonly Role[] = ['P', 'D', 'C', 'A'] as const;

export const ROLE_NAMES: Record<Role, string> = {
  P: 'Arquero',
  D: 'Defensor',
  C: 'Mediocampista',
  A: 'Delantero',
};

/** Jugador del listone. El id coincide con el id de fantacalcio.it (imagen en /campioncini/<id>.png). */
export interface Player {
  id: number;
  name: string;
  team: string;
  role: Role;
  /** Cotización inicial (quotazione) — referencia, no precio mínimo. */
  quotazione: number;
}

export interface RoomConfig {
  leagueName: string;
  /** Créditos iniciales por participante. */
  budget: number;
  /** Cupos de plantilla por rol (máximos, en modo rango). */
  slots: Record<Role, number>;
  /**
   * Cupos MÍNIMOS por rol (modo rango, estilo oficial). Ausente = cupos fijos (min = max = slots).
   * Con rangos, el tamaño total de plantilla lo fija rosterSize.
   */
  slotsMin?: Record<Role, number>;
  /**
   * Tamaño total de la plantilla en modo rango (entre la suma de mínimos y la de máximos).
   * Ausente = suma de slots (cupos fijos).
   */
  rosterSize?: number;
  /** Countdown (segundos) que se reinicia con cada oferta. */
  bidTimerSeconds: number;
  /** Segundos para la primera oferta antes de declarar desierto. 0 = solo cierre manual del admin. */
  callTimerSeconds: number;
  /** Incremento mínimo de un rilancio. */
  minIncrement: number;
  /** Base de asta: 'fixed' = la primera oferta arranca en 1 crédito; 'quotazione' = en la cotización del jugador. */
  baseBidMode: 'fixed' | 'quotazione';
  /** Ocultar quotazioni durante el asta (modo "Nascosto" del software oficial). */
  hideValues: boolean;
  /**
   * Quién llama a los jugadores: 'admin' = solo el banditore; 'turns' = ronda de llamadas —
   * cada participante, en su turno (según el sorteo), elige qué jugador sale a subasta.
   */
  callMode: 'admin' | 'turns';
  /**
   * Cómo se oferta: 'uno' = digital, cada pulsación/oferta lleva su monto (modo actual);
   * 'premi_parla' = el botón solo reserva el turno de palabra y la oferta se canta de viva voz —
   * el banditore corrige el monto con admin:setBid.
   */
  auctionMode: 'uno' | 'premi_parla';
}

export const DEFAULT_CONFIG: RoomConfig = {
  leagueName: 'Mi Liga',
  budget: 500,
  slots: { P: 3, D: 8, C: 8, A: 6 },
  // Cada puja reinicia el countdown a este valor: "si uno puja se agrega un minuto".
  bidTimerSeconds: 60,
  callTimerSeconds: 30,
  minIncrement: 1,
  baseBidMode: 'fixed',
  hideValues: false,
  callMode: 'admin',
  auctionMode: 'uno',
};

export interface RosterEntry {
  playerId: number;
  price: number;
}

export interface Participant {
  /** UUID estable; el cliente lo guarda en localStorage para reconectarse. */
  id: string;
  name: string;
  connected: boolean;
  roster: RosterEntry[];
  /** Bonus (+) o malus (−) de créditos aplicado por el admin sobre el presupuesto base. */
  budgetBonus: number;
}

export interface Bid {
  participantId: string;
  amount: number;
  /** Timestamp del servidor (epoch ms) — orden autoritativo. */
  at: number;
}

export type AuctionPhase = 'idle' | 'called' | 'bidding' | 'sold' | 'unsold';

export interface AuctionState {
  phase: AuctionPhase;
  /** Jugador en subasta (null en idle). */
  playerId: number | null;
  /** Ofertas de la subasta actual, en orden; la última es la vigente. */
  bids: Bid[];
  /** Epoch ms (reloj del servidor) en que la fase avanza sola; null sin timer. */
  deadline: number | null;
  /** Si el admin pausó: ms que restaban del countdown (deadline pasa a null). null = no pausada. */
  pausedRemainingMs: number | null;
  /** Ganador, seteado en fase 'sold'. */
  winnerId: string | null;
}

export interface RoomState {
  code: string;
  config: RoomConfig;
  participants: Participant[];
  auction: AuctionState;
  /** Jugadores llamados y no asignados (lista "richiama"), en orden de llamada. */
  unsoldPlayerIds: number[];
  /** Momento en que el asta terminó (todos los cupos llenos, o cierre manual del admin). null = en curso. */
  finishedAt: number | null;
  /** Orden de llamada sorteado (participantIds). [] = todavía sin sortear. */
  callOrder: string[];
  /** Índice en callOrder de quien tiene el turno de llamar. null = sin sorteo o modo 'admin'. */
  turnIndex: number | null;
  /** Reloj del servidor al emitir el snapshot; para sincronizar countdowns en el cliente. */
  serverTime: number;
}

/** Evento que acompaña un snapshot, para animaciones/sonidos en el cliente. */
export type RoomEvent =
  | { type: 'called'; playerId: number }
  | { type: 'bid'; bid: Bid }
  | { type: 'sold'; playerId: number; participantId: string; price: number }
  | { type: 'unsold'; playerId: number }
  | { type: 'cancelled'; playerId: number }
  | { type: 'joined'; participantId: string }
  | { type: 'left'; participantId: string }
  | { type: 'kicked'; participantId: string }
  | { type: 'config' }
  /** Ajuste manual del admin (asignación/quita/corrección de precio fuera de subasta). */
  | { type: 'assigned'; playerId: number; participantId: string; price: number }
  | { type: 'unassigned'; playerId: number }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'finished' }
  /** Sorteo del orden de llamada realizado (para la animación del sorteo en el sitio). */
  | { type: 'order_drawn'; order: string[] }
  /** Cambió el turno de llamada. */
  | { type: 'turn'; participantId: string }
  /** Premi&Parla: el banditore corrigió el monto de la oferta vigente. */
  | { type: 'bid_amount_set'; amount: number }
  /** Bonus/malus de créditos aplicado. */
  | { type: 'budget_adjusted'; participantId: string; delta: number }
  /** La sala cargó un listone propio (CSV subido por el admin). */
  | { type: 'listone_loaded'; count: number };

/** Ficha extendida scrapeada de fantacalcio.it (data/players.json). Campos null si no se pudo obtener. */
export interface PlayerProfile {
  url: string | null;
  height: string | null;
  birthDate: string | null;
  foot: string | null;
  nationality: string | null;
  /** Media voto. */
  mv: number | null;
  /** Fantamedia. */
  fm: number | null;
  /** FantaValore di Mercato (Classic, /1000). */
  fvm: number | null;
  description: string | null;
}
