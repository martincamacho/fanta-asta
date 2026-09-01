import type { RoomConfig, RoomEvent, RoomState } from './types.js';
import type { BidRejectReason } from './rules.js';

/** Rol con el que un socket entra a la sala. */
export type JoinAs = 'player' | 'admin' | 'board';

export interface JoinPayload {
  code: string;
  as: JoinAs;
  /** Nombre de equipo; requerido la primera vez que entra un player. */
  name?: string;
  /** UUID persistido en el cliente; permite reconectar y reclamar el asiento. */
  participantId?: string;
  /** Token secreto devuelto al crear la sala; requerido para as='admin'. */
  adminToken?: string;
}

export type JoinAck =
  | { ok: true; state: RoomState; participantId?: string }
  | { ok: false; error: string };

export interface ErrorPayload {
  code: BidRejectReason | 'not_admin' | 'bad_request';
  message: string;
}

/** Eventos servidor → cliente. */
export interface ServerToClientEvents {
  /** Snapshot completo tras cada cambio; `event` describe qué pasó (para animar/sonar). */
  'room:state': (payload: { state: RoomState; event?: RoomEvent }) => void;
  'room:error': (payload: ErrorPayload) => void;
}

/** Eventos cliente → servidor. */
export interface ClientToServerEvents {
  'room:join': (payload: JoinPayload, ack: (r: JoinAck) => void) => void;
  /** admin: llamar un jugador a subasta. */
  'auction:call': (payload: { playerId: number }) => void;
  /** player: ofertar. Sin `amount` = rilancio mínimo (vigente + minIncrement, o 1 si no hay ofertas). */
  'auction:bid': (payload: { amount?: number }) => void;
  /** admin: anular la subasta en curso (el jugador vuelve a estar disponible, no va a richiama). */
  'auction:cancel': () => void;
  /** admin: cerrar ya la subasta en curso (adjudica al mejor postor, o desierto si no hay ofertas). */
  'auction:close': () => void;
  /** admin: pausar el countdown (guarda los ms restantes; las ofertas quedan bloqueadas). */
  'auction:pause': () => void;
  /** admin: reanudar el countdown con los ms que restaban. */
  'auction:resume': () => void;
  /** admin: dar por terminada el asta (pantalla de resumen final). También ocurre solo al llenarse todos los cupos. */
  'room:finish': () => void;
  /** admin: sortear (o re-sortear) el orden de llamada entre los participantes actuales. */
  'order:draw': () => void;
  /** admin: saltear el turno de llamada actual (pasa al siguiente). */
  'turn:skip': () => void;
  /** admin: expulsar un participante (solo si no compró nada). */
  'admin:kick': (payload: { participantId: string }) => void;
  /**
   * admin: asignación/corrección MANUAL — escape ante cualquier problema.
   * Asigna el jugador al participante por ese precio; si ya estaba en otro roster, lo mueve;
   * si ya estaba en el de este participante, corrige el precio. Sin validación de reglas
   * (maxBid/cupos): el admin manda. Rechazado solo si el jugador está en subasta activa.
   */
  'admin:assign': (payload: { playerId: number; participantId: string; price: number }) => void;
  /** admin: quitar un jugador de un roster (devuelve los créditos). */
  'admin:unassign': (payload: { playerId: number }) => void;
  /** admin (Premi&Parla): corregir el monto de la oferta vigente al valor cantado de viva voz. */
  'admin:setBid': (payload: { amount: number }) => void;
  /** admin: bonus (+) o malus (−) de créditos a un participante (reglas caseras). */
  'admin:budget': (payload: { participantId: string; delta: number }) => void;
  /** admin: actualizar configuración (solo antes de la primera subasta). */
  'admin:config': (payload: Partial<RoomConfig>) => void;
}

/** REST (además del socket):
 *  POST /api/rooms  { config?: Partial<RoomConfig> } → { code, adminToken }
 *  GET  /api/rooms/:code → { exists: boolean, leagueName?: string, leagueId?: string }
 *  GET  /api/players → Player[]  (listone global)
 *  GET  /api/rooms/:code/players → Player[]  (listone efectivo de la sala: propio si subió CSV, global si no)
 *  POST /api/rooms/:code/listone  { adminToken, csv } → { count }  (listone propio de la sala; CSV formato
 *      clásico C,T,M,Nome,Squadra,Quotazione,ID,EID o genérico Nome,Squadra,Ruolo,Quotazione)
 *  GET  /api/players/:id/profile → PlayerProfile
 *  GET  /api/rooms/:code/export/rose.csv | rose.xlsx → rosas finales (CSV compatible Leghe / Excel)
 *  GET  /campioncini/:id.png → imagen del jugador (la web tiene fallback local)
 */
