/**
 * Ligas y cuentas (Fase 5).
 *
 * REST (cookie de sesión httpOnly, credenciales incluidas):
 *  POST /api/auth/register {email, name, password} → {user}          (crea sesión)
 *  POST /api/auth/login    {email, password} → {user}                (crea sesión)
 *  POST /api/auth/logout   → 204
 *  GET  /api/auth/me       → {user, leagues: LeagueSummary[]} | 401
 *  POST /api/leagues       {name} → LeagueSummary                    (creador = admin)
 *  GET  /api/leagues/:id   → LeagueDetail                            (solo miembros)
 *  POST /api/leagues/:id/invites {emails: string[]} → InviteInfo[]   (solo admin)
 *  GET  /api/invites/:token → {leagueName, email, alreadyMember}     (público, para prellenar registro)
 *  POST /api/invites/:token/accept → {leagueId}                      (requiere sesión; une a la liga)
 *  POST /api/leagues/:id/auctions {config?} → {code, adminToken}     (solo admin; sala ligada a la liga)
 *  GET  /api/rooms/:code/ticket → {participantId, name}              (miembro autenticado de la liga de esa
 *                                                                     sala; identidad estable para el socket)
 */
export interface User {
  id: string;
  email: string;
  name: string;
}

export interface LeagueSummary {
  id: string;
  name: string;
  adminUserId: string;
  memberCount: number;
}

export interface LeagueMemberInfo {
  userId: string;
  name: string;
  email: string;
  joinedAt: number;
}

export interface LeagueAuctionInfo {
  roomCode: string;
  createdAt: number;
}

export interface InviteInfo {
  token: string;
  email: string;
  /** Link listo para compartir: <origin>/invitacion/<token>. */
  url: string;
  acceptedByUserId: string | null;
}

export interface LeagueDetail extends LeagueSummary {
  members: LeagueMemberInfo[];
  auctions: LeagueAuctionInfo[];
  /** Solo presente para el admin. */
  invites?: InviteInfo[];
}
