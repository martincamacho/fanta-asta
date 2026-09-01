import type { InviteInfo, LeagueDetail, LeagueSummary, RoomConfig } from '@fanta/shared';
import { serverError } from '../authStore';

async function ok<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await serverError(res));
  return (await res.json()) as T;
}

export async function createLeague(name: string): Promise<LeagueSummary> {
  const res = await fetch('/api/leagues', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return ok(res);
}

export async function getLeague(id: string): Promise<LeagueDetail> {
  const res = await fetch(`/api/leagues/${encodeURIComponent(id)}`, { credentials: 'include' });
  return ok(res);
}

export async function sendInvites(id: string, emails: string[]): Promise<InviteInfo[]> {
  const res = await fetch(`/api/leagues/${encodeURIComponent(id)}/invites`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails }),
  });
  return ok(res);
}

export interface InvitePreview {
  leagueName: string;
  email: string;
  alreadyMember: boolean;
}

/** null = token inválido/vencido. */
export async function getInvite(token: string): Promise<InvitePreview | null> {
  const res = await fetch(`/api/invites/${encodeURIComponent(token)}`, { credentials: 'include' });
  if (res.status === 404) return null;
  return ok(res);
}

export async function acceptInvite(token: string): Promise<{ leagueId: string }> {
  const res = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    credentials: 'include',
  });
  return ok(res);
}

export async function createLeagueAuction(
  id: string,
  config?: Partial<RoomConfig>,
): Promise<{ code: string; adminToken: string }> {
  const res = await fetch(`/api/leagues/${encodeURIComponent(id)}/auctions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  return ok(res);
}

export interface RoomTicket {
  participantId: string;
  name: string;
}

export type TicketResult =
  | { kind: 'ticket'; ticket: RoomTicket }
  | { kind: 'forbidden' }
  /** Sala sin liga, sin sesión, o endpoint ausente → flujo anónimo normal. */
  | { kind: 'none' };

/** Identidad estable para salas de liga. Lanza solo ante error de red. */
export async function getRoomTicket(code: string): Promise<TicketResult> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/ticket`, {
    credentials: 'include',
  });
  if (res.ok) return { kind: 'ticket', ticket: (await res.json()) as RoomTicket };
  if (res.status === 403) return { kind: 'forbidden' };
  return { kind: 'none' };
}
