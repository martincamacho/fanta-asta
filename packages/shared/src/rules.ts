import type { Participant, Player, Role, RoomConfig, RoomState } from './types.js';

/** Suma de los cupos máximos por rol. */
export function totalSlots(config: RoomConfig): number {
  return config.slots.P + config.slots.D + config.slots.C + config.slots.A;
}

/** Tamaño real de plantilla a completar: rosterSize en modo rango, suma de slots en modo fijo. */
export function rosterTarget(config: RoomConfig): number {
  return config.rosterSize ?? totalSlots(config);
}

/** Cupo mínimo de un rol (modo fijo: igual al máximo). */
export function minSlots(config: RoomConfig, role: Role): number {
  return config.slotsMin?.[role] ?? config.slots[role];
}

export function spent(p: Participant): number {
  return p.roster.reduce((sum, e) => sum + e.price, 0);
}

export function budgetRemaining(p: Participant, config: RoomConfig): number {
  return config.budget + (p.budgetBonus ?? 0) - spent(p);
}

export function emptySlots(p: Participant, config: RoomConfig): number {
  return rosterTarget(config) - p.roster.length;
}

/** ¿La plantilla está completa? (criterio de fin de asta / salteo de turno) */
export function rosterComplete(p: Participant, config: RoomConfig): boolean {
  return p.roster.length >= rosterTarget(config);
}

export function slotsLeftForRole(
  p: Participant,
  config: RoomConfig,
  role: Role,
  players: ReadonlyMap<number, Player>,
): number {
  const filled = p.roster.filter((e) => players.get(e.playerId)?.role === role).length;
  return config.slots[role] - filled;
}

/**
 * Máxima oferta posible: tras comprar, deben quedar ≥1 crédito por cada cupo aún vacío
 * (regla clásica del fantacalcio).
 */
export function maxBid(p: Participant, config: RoomConfig): number {
  return budgetRemaining(p, config) - (emptySlots(p, config) - 1);
}

export type BidRejectReason =
  | 'no_auction'
  | 'paused'
  | 'unknown_participant'
  | 'own_bid'
  | 'too_low'
  | 'exceeds_max'
  | 'role_full'
  | 'roster_full'
  | 'min_conflict';

export const BID_REJECT_MESSAGES: Record<BidRejectReason, string> = {
  no_auction: 'No hay ninguna subasta activa',
  paused: 'La subasta está pausada',
  unknown_participant: 'No estás en esta sala',
  own_bid: 'Ya tenés la oferta más alta',
  too_low: 'La oferta debe superar a la vigente',
  exceeds_max: 'No te alcanzan los créditos (tenés que poder llenar los cupos restantes)',
  role_full: 'Ya llenaste los cupos de ese rol',
  roster_full: 'Ya completaste tu plantilla',
  min_conflict: 'Tenés que guardar cupos para completar los mínimos de otros roles',
};

/**
 * Oferta mínima válida en el estado actual de la subasta.
 * Pasá `players` para respetar baseBidMode='quotazione' (sin ofertas, la base es la cotización).
 */
export function nextMinBid(state: RoomState, players?: ReadonlyMap<number, Player>): number {
  const last = state.auction.bids[state.auction.bids.length - 1];
  if (last) return last.amount + state.config.minIncrement;
  if (state.config.baseBidMode === 'quotazione' && state.auction.playerId !== null) {
    const q = players?.get(state.auction.playerId)?.quotazione;
    if (q && q > 0) return q;
  }
  return 1;
}

export function validateBid(
  state: RoomState,
  players: ReadonlyMap<number, Player>,
  participantId: string,
  amount: number,
): { ok: true } | { ok: false; reason: BidRejectReason } {
  const { auction } = state;
  if ((auction.phase !== 'called' && auction.phase !== 'bidding') || auction.playerId === null) {
    return { ok: false, reason: 'no_auction' };
  }
  if (auction.pausedRemainingMs !== null) return { ok: false, reason: 'paused' };
  const participant = state.participants.find((p) => p.id === participantId);
  if (!participant) return { ok: false, reason: 'unknown_participant' };

  const last = auction.bids[auction.bids.length - 1];
  if (last && last.participantId === participantId) return { ok: false, reason: 'own_bid' };
  if (amount < nextMinBid(state, players)) return { ok: false, reason: 'too_low' };

  if (rosterComplete(participant, state.config)) return { ok: false, reason: 'roster_full' };

  const player = players.get(auction.playerId);
  if (player) {
    if (slotsLeftForRole(participant, state.config, player.role, players) <= 0) {
      return { ok: false, reason: 'role_full' };
    }
    // Modo rango: comprar este rol no puede impedir completar los mínimos de los demás roles.
    const capacityAfter = rosterTarget(state.config) - participant.roster.length - 1;
    let requiredForMins = 0;
    for (const role of ['P', 'D', 'C', 'A'] as const) {
      const filled = participant.roster.filter((e) => players.get(e.playerId)?.role === role).length +
        (role === player.role ? 1 : 0);
      requiredForMins += Math.max(0, minSlots(state.config, role) - filled);
    }
    if (capacityAfter < requiredForMins) return { ok: false, reason: 'min_conflict' };
  }
  if (amount > maxBid(participant, state.config)) return { ok: false, reason: 'exceeds_max' };

  return { ok: true };
}
