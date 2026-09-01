import type { Bid, RoomState } from '@fanta/shared';

/** Búsqueda sin tildes ni mayúsculas. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function participantName(state: RoomState | null, id: string | null | undefined): string {
  if (!state || !id) return '—';
  return state.participants.find((p) => p.id === id)?.name ?? '—';
}

/** Oferta vigente (la última). */
export function currentBid(state: RoomState): Bid | null {
  return state.auction.bids[state.auction.bids.length - 1] ?? null;
}

export function buzzerUrl(code: string): string {
  return `${window.location.origin}/sala/${code}`;
}

/** En modo 'turns': participantId de quien tiene el turno de llamar (null si no aplica). */
export function currentCallerId(state: RoomState): string | null {
  if (state.config.callMode !== 'turns' || state.turnIndex === null) return null;
  return state.callOrder[state.turnIndex] ?? null;
}
