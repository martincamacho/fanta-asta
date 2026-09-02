import { randomUUID } from 'node:crypto';
import {
  ROLES,
  nextMinBid,
  rosterComplete,
  validateBid,
  type Bid,
  type BidRejectReason,
  type Player,
  type Role,
  type RoomConfig,
  type RoomEvent,
  type RoomState,
} from '@fanta/shared';
import { systemClock, type Clock, type TimerHandle } from './clock.js';

/** Tiempo que el estado sold/unsold queda visible antes de volver a idle (animación en clientes). */
export const RESULT_DISPLAY_MS = 3000;

/** Errores del motor que no son rechazos de oferta (esos usan BidRejectReason del shared). */
export type EngineError =
  | 'unknown_player'
  | 'already_assigned'
  | 'auction_in_progress'
  | 'no_auction'
  | 'unknown_participant'
  | 'name_required'
  | 'roster_not_empty'
  | 'standing_bidder'
  | 'config_locked'
  | 'invalid_price'
  | 'not_assigned'
  | 'not_pausable'
  | 'not_paused'
  | 'finished'
  | 'no_order'
  | 'not_your_turn'
  | 'not_turns_mode'
  | 'not_allowed_to_call'
  | 'no_participants'
  | 'invalid_bid_amount'
  | 'invalid_delta'
  | 'invalid_config'
  | 'listone_locked'
  | 'duplicate_player';

export const ENGINE_ERROR_MESSAGES: Record<EngineError, string> = {
  unknown_player: 'Ese jugador no existe en el listone',
  already_assigned: 'Ese jugador ya fue asignado a una plantilla',
  auction_in_progress: 'Ya hay una subasta en curso',
  no_auction: 'No hay ninguna subasta activa',
  unknown_participant: 'Ese participante no está en la sala',
  name_required: 'Falta el nombre de equipo',
  roster_not_empty: 'No se puede expulsar a un participante que ya compró jugadores',
  standing_bidder: 'Ese participante tiene la oferta vigente de la subasta en curso',
  config_locked: 'La configuración ya no se puede cambiar: hubo ventas',
  invalid_price: 'Precio inválido',
  not_assigned: 'Ese jugador no está en ninguna plantilla',
  not_pausable: 'No hay ningún countdown activo para pausar',
  not_paused: 'La subasta no está pausada',
  finished: 'El asta ya terminó',
  no_order: 'Primero hay que sortear el orden',
  not_your_turn: 'No es tu turno de llamar',
  not_turns_mode: 'El modo por turnos no está activo',
  not_allowed_to_call: 'Solo el admin puede llamar jugadores',
  no_participants: 'No hay participantes para sortear',
  invalid_bid_amount: 'El monto debe ser entero, ≥1 y mayor a la oferta anterior',
  invalid_delta: 'El ajuste de créditos debe ser un número entero',
  invalid_config: 'Cupos inválidos: mínimo ≤ máximo por rol y suma de mínimos ≤ plantilla ≤ suma de máximos',
  listone_locked: 'No se puede cambiar el listone: hay una subasta activa o ya hubo compras',
  duplicate_player: 'Ese jugador ya está en el listone (mismo nombre y equipo)',
};

/**
 * Valida los rangos de cupos de una config (modo rango oficial). Devuelve un
 * mensaje de error claro, o null si es válida. Sin slotsMin/rosterSize no hay
 * nada que validar (cupos fijos).
 */
export function validateConfigRanges(config: RoomConfig): string | null {
  const { slots, slotsMin, rosterSize } = config;
  if (slotsMin === undefined && rosterSize === undefined) return null;

  let sumMin = 0;
  let sumMax = 0;
  for (const role of ROLES) {
    const max = slots[role];
    const min = slotsMin?.[role] ?? max;
    if (!Number.isInteger(min) || min < 0) return `Cupo mínimo inválido para ${role}`;
    if (!Number.isInteger(max) || max < 0) return `Cupo máximo inválido para ${role}`;
    if (min > max) return `El mínimo de ${role} (${min}) no puede superar el máximo (${max})`;
    sumMin += min;
    sumMax += max;
  }
  const target = rosterSize ?? sumMax;
  if (!Number.isInteger(target) || target < 1) return 'rosterSize debe ser un entero ≥ 1';
  if (target < sumMin || target > sumMax) {
    return `rosterSize (${target}) debe estar entre la suma de mínimos (${sumMin}) y la de máximos (${sumMax})`;
  }
  return null;
}

export type EngineResult<T = object> = ({ ok: true } & T) | { ok: false; error: EngineError };
export type BidResult = { ok: true; bid: Bid } | { ok: false; reason: BidRejectReason };
export type OnChange = (state: RoomState, event?: RoomEvent) => void;

export interface RoomOptions {
  code: string;
  config: RoomConfig;
  players: ReadonlyMap<number, Player>;
  clock?: Clock;
  onChange?: OnChange;
  /** Estado persistido para restaurar la sala (los participantes arrancan desconectados). */
  initialState?: RoomState;
  /** Listone propio persistido (CSV subido por el admin); tiene prioridad sobre el global. */
  customListone?: Player[] | null;
}

export class Room {
  readonly state: RoomState;
  onChange?: OnChange;

  /** Listone propio de la sala (null = usa el global). Se persiste junto al snapshot. */
  customListone: Player[] | null = null;

  private players: ReadonlyMap<number, Player>;
  private readonly clock: Clock;
  private timer: TimerHandle | null = null;

  constructor(opts: RoomOptions) {
    this.players = opts.players;
    if (opts.customListone && opts.customListone.length > 0) {
      this.customListone = opts.customListone;
      this.players = new Map(opts.customListone.map((p) => [p.id, p]));
    }
    this.clock = opts.clock ?? systemClock;
    this.onChange = opts.onChange;

    if (opts.initialState) {
      this.state = opts.initialState;
      this.state.code = opts.code;
      for (const p of this.state.participants) p.connected = false;
      this.rearmTimersAfterRestore();
    } else {
      this.state = {
        code: opts.code,
        config: opts.config,
        participants: [],
        auction: emptyAuction(),
        unsoldPlayerIds: [],
        finishedAt: null,
        callOrder: [],
        turnIndex: null,
        serverTime: this.clock.now(),
      };
    }
  }

  /** Snapshot con serverTime fresco (para el ack de room:join). */
  snapshot(): RoomState {
    this.state.serverTime = this.clock.now();
    return this.state;
  }

  /** Listone efectivo de la sala: el propio si el admin subió CSV, si no el global. */
  get effectivePlayers(): ReadonlyMap<number, Player> {
    return this.players;
  }

  /** Listone efectivo como lista (en el orden del listone). */
  listPlayers(): Player[] {
    return [...this.players.values()];
  }

  /**
   * Carga un listone propio para la sala. Solo antes de que haya compras y sin
   * subasta activa (los ids de un listone anterior dejarían rosters huérfanos).
   */
  setListone(players: Player[]): EngineResult<{ count: number }> {
    const phase = this.state.auction.phase;
    if (phase === 'called' || phase === 'bidding') return { ok: false, error: 'auction_in_progress' };
    if (this.state.participants.some((p) => p.roster.length > 0)) {
      return { ok: false, error: 'listone_locked' };
    }
    this.customListone = players;
    this.players = new Map(players.map((p) => [p.id, p]));
    this.state.unsoldPlayerIds = []; // ids del listone anterior ya no aplican
    this.emit({ type: 'listone_loaded', count: players.length });
    return { ok: true, count: players.length };
  }

  /**
   * Alta manual de un jugador faltante ("uy, falta X" a mitad del asta).
   * A diferencia del upload de CSV completo, está permitida con compras hechas
   * y con subasta activa. Si la sala no tiene listone propio, lo inicializa
   * como copia del global. Id negativo único estable (siguiente libre).
   */
  addPlayer(data: { name: string; team: string; role: Role; quotazione?: number }): EngineResult<{ player: Player }> {
    const name = data.name.trim();
    const team = data.team.trim();
    const dupKey = `${name.toLowerCase()}|${team.toLowerCase()}`;
    for (const p of this.players.values()) {
      if (`${p.name.toLowerCase()}|${p.team.toLowerCase()}` === dupKey) {
        return { ok: false, error: 'duplicate_player' };
      }
    }

    if (!this.customListone) this.customListone = [...this.players.values()];
    let minId = 0;
    for (const p of this.customListone) if (p.id < minId) minId = p.id;
    const player: Player = {
      id: minId - 1,
      name,
      team,
      role: data.role,
      quotazione:
        typeof data.quotazione === 'number' && Number.isFinite(data.quotazione) && data.quotazione > 0
          ? data.quotazione
          : 1,
    };
    this.customListone.push(player);
    this.players = new Map(this.customListone.map((p) => [p.id, p]));
    this.emit({ type: 'listone_loaded', count: this.customListone.length });
    return { ok: true, player };
  }

  // ── Participantes ────────────────────────────────────────────────────────

  /**
   * Alta o reconexión. Con participantId conocido reconecta (conserva roster/budget);
   * un player nuevo requiere name (puede traer su propio uuid para persistirlo en el cliente).
   */
  join(participantId: string | undefined, name: string | undefined): EngineResult<{ participantId: string }> {
    if (participantId) {
      const existing = this.state.participants.find((p) => p.id === participantId);
      if (existing) {
        existing.connected = true;
        this.emit({ type: 'joined', participantId: existing.id });
        return { ok: true, participantId: existing.id };
      }
    }
    const trimmed = name?.trim();
    if (!trimmed) return { ok: false, error: 'name_required' };
    const id = participantId ?? randomUUID();
    this.state.participants.push({ id, name: trimmed, connected: true, roster: [], budgetBonus: 0 });
    // Si ya hubo sorteo, el nuevo entra al FINAL del orden (sin re-sortear).
    if (this.state.callOrder.length > 0) this.state.callOrder.push(id);
    this.emit({ type: 'joined', participantId: id });
    return { ok: true, participantId: id };
  }

  /** Solo marca connected=false; nunca borra (el asiento se reclama con el mismo id). */
  disconnect(participantId: string): void {
    const p = this.state.participants.find((x) => x.id === participantId);
    if (!p || !p.connected) return;
    p.connected = false;
    this.emit({ type: 'left', participantId });
  }

  /** Expulsa a un participante — solo si todavía no compró nada. */
  kick(participantId: string): EngineResult {
    const idx = this.state.participants.findIndex((p) => p.id === participantId);
    const participant = this.state.participants[idx];
    if (!participant) return { ok: false, error: 'unknown_participant' };
    if (participant.roster.length > 0) return { ok: false, error: 'roster_not_empty' };
    const lastBid = this.state.auction.bids[this.state.auction.bids.length - 1];
    if (
      (this.state.auction.phase === 'called' || this.state.auction.phase === 'bidding') &&
      lastBid?.participantId === participantId
    ) {
      return { ok: false, error: 'standing_bidder' };
    }
    this.state.participants.splice(idx, 1);

    // Sacarlo del orden de llamada, ajustando el turno si hace falta.
    const orderIdx = this.state.callOrder.indexOf(participantId);
    if (orderIdx !== -1) {
      const prevHolder = this.state.turnIndex !== null ? this.state.callOrder[this.state.turnIndex] : null;
      this.state.callOrder.splice(orderIdx, 1);
      if (this.state.turnIndex !== null) {
        if (this.state.callOrder.length === 0) {
          this.state.turnIndex = null;
        } else {
          let t = this.state.turnIndex;
          if (orderIdx < t) t -= 1;
          t %= this.state.callOrder.length; // si era el último y tenía el turno, vuelve al 0
          this.state.turnIndex = this.firstEligibleFrom(t) ?? t;
        }
      }
      this.emit({ type: 'kicked', participantId });
      const newHolder = this.state.turnIndex !== null ? this.state.callOrder[this.state.turnIndex] : null;
      if (newHolder && newHolder !== prevHolder) {
        this.emit({ type: 'turn', participantId: newHolder });
      }
      return { ok: true };
    }

    this.emit({ type: 'kicked', participantId });
    return { ok: true };
  }

  /** Configuración editable solo mientras ningún jugador haya sido vendido. */
  updateConfig(patch: Partial<RoomConfig>): EngineResult {
    if (this.state.participants.some((p) => p.roster.length > 0)) {
      return { ok: false, error: 'config_locked' };
    }
    const current = this.state.config;
    const merged: RoomConfig = {
      ...current,
      ...patch,
      slots: { ...current.slots, ...(patch.slots ?? {}) },
    };
    if (validateConfigRanges(merged) !== null) return { ok: false, error: 'invalid_config' };
    this.state.config = merged;
    // Normalizar el turno al cambiar de modo: 'admin' no usa turnIndex;
    // 'turns' con sorteo ya hecho arranca la ronda desde el primero elegible.
    if (this.state.config.callMode === 'admin') {
      this.state.turnIndex = null;
    } else if (this.state.turnIndex === null && this.state.callOrder.length > 0) {
      this.state.turnIndex = this.firstEligibleFrom(0) ?? 0;
    }
    this.emit({ type: 'config' });
    return { ok: true };
  }

  // ── Ajustes manuales del admin (escape hatch, sin validación de reglas) ──

  /**
   * Asignación/corrección manual: asigna el jugador al participante por ese precio.
   * Si estaba en otro roster lo mueve; si ya estaba en el de ese participante,
   * corrige el precio. SIN validación de maxBid/cupos (el admin manda).
   * Solo se rechaza si ese jugador está en subasta activa, si player/participant
   * no existen, o si price < 0.
   */
  assign(playerId: number, participantId: string, price: number): EngineResult {
    if (!this.players.has(playerId)) return { ok: false, error: 'unknown_player' };
    const target = this.state.participants.find((p) => p.id === participantId);
    if (!target) return { ok: false, error: 'unknown_participant' };
    if (!Number.isInteger(price) || price < 0) return { ok: false, error: 'invalid_price' };
    const { phase, playerId: inAuction } = this.state.auction;
    if ((phase === 'called' || phase === 'bidding') && inAuction === playerId) {
      return { ok: false, error: 'auction_in_progress' };
    }

    // Sacarlo de cualquier roster que ya lo tenga (mover / corregir precio).
    for (const p of this.state.participants) {
      const idx = p.roster.findIndex((e) => e.playerId === playerId);
      if (idx !== -1) p.roster.splice(idx, 1);
    }
    // Si estaba en richiama, ya no: queda asignado.
    const unsoldIdx = this.state.unsoldPlayerIds.indexOf(playerId);
    if (unsoldIdx !== -1) this.state.unsoldPlayerIds.splice(unsoldIdx, 1);

    target.roster.push({ playerId, price });
    this.emit({ type: 'assigned', playerId, participantId, price });
    this.checkAutoFinish();
    return { ok: true };
  }

  /** Quita un jugador del roster que lo tenga (devuelve créditos; vuelve a estar disponible). */
  unassign(playerId: number): EngineResult {
    for (const p of this.state.participants) {
      const idx = p.roster.findIndex((e) => e.playerId === playerId);
      if (idx !== -1) {
        p.roster.splice(idx, 1);
        this.emit({ type: 'unassigned', playerId });
        return { ok: true };
      }
    }
    return { ok: false, error: 'not_assigned' };
  }

  // ── Subasta ──────────────────────────────────────────────────────────────

  /**
   * Llama un jugador a subasta. Permitido en idle y durante sold/unsold (corta la
   * animación y arranca la nueva). Los de unsoldPlayerIds se re-llaman ("richiama").
   */
  /**
   * Sortea (o re-sortea) el orden de llamada entre los participantes actuales
   * (Fisher-Yates). En callMode 'turns' arranca la ronda (turnIndex al primero
   * con cupos libres); en 'admin' el sorteo es solo informativo (turnIndex null).
   */
  drawOrder(): EngineResult {
    if (this.state.finishedAt !== null) return { ok: false, error: 'finished' };
    const phase = this.state.auction.phase;
    if (phase === 'called' || phase === 'bidding') return { ok: false, error: 'auction_in_progress' };
    if (this.state.participants.length === 0) return { ok: false, error: 'no_participants' };

    const order = this.state.participants.map((p) => p.id);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    this.state.callOrder = order;
    if (this.state.config.callMode === 'turns') {
      this.state.turnIndex = this.firstEligibleFrom(0) ?? 0;
      this.emit({ type: 'order_drawn', order: [...order] });
      this.emit({ type: 'turn', participantId: order[this.state.turnIndex]! });
    } else {
      this.state.turnIndex = null;
      this.emit({ type: 'order_drawn', order: [...order] });
    }
    return { ok: true };
  }

  /** Avanza el turno sin subasta (salteando llenos). Solo tiene sentido en callMode 'turns'. */
  skipTurn(): EngineResult {
    if (this.state.config.callMode !== 'turns') return { ok: false, error: 'not_turns_mode' };
    if (this.state.finishedAt !== null) return { ok: false, error: 'finished' };
    const phase = this.state.auction.phase;
    if (phase === 'called' || phase === 'bidding') return { ok: false, error: 'auction_in_progress' };
    if (this.state.callOrder.length === 0 || this.state.turnIndex === null) {
      return { ok: false, error: 'no_order' };
    }
    this.advanceTurn();
    return { ok: true };
  }

  /**
   * Llama un jugador a subasta. Sin `callerParticipantId` es el admin (siempre
   * puede). Con él, es un participante: solo en callMode 'turns' y solo si es
   * su turno según el sorteo.
   */
  call(playerId: number, callerParticipantId?: string): EngineResult {
    if (this.state.finishedAt !== null) return { ok: false, error: 'finished' };
    if (callerParticipantId !== undefined) {
      if (!this.state.participants.some((p) => p.id === callerParticipantId)) {
        return { ok: false, error: 'unknown_participant' };
      }
      if (this.state.config.callMode !== 'turns') return { ok: false, error: 'not_allowed_to_call' };
      if (this.state.callOrder.length === 0 || this.state.turnIndex === null) {
        return { ok: false, error: 'no_order' };
      }
      if (this.state.callOrder[this.state.turnIndex] !== callerParticipantId) {
        return { ok: false, error: 'not_your_turn' };
      }
    }
    const player = this.players.get(playerId);
    if (!player) return { ok: false, error: 'unknown_player' };
    if (this.isAssigned(playerId)) return { ok: false, error: 'already_assigned' };
    const phase = this.state.auction.phase;
    if (phase === 'called' || phase === 'bidding') return { ok: false, error: 'auction_in_progress' };

    this.clearTimer(); // corta el timer de retorno a idle de sold/unsold

    const unsoldIdx = this.state.unsoldPlayerIds.indexOf(playerId);
    if (unsoldIdx !== -1) this.state.unsoldPlayerIds.splice(unsoldIdx, 1);

    const now = this.clock.now();
    const callMs = this.state.config.callTimerSeconds * 1000;
    const deadline = callMs > 0 ? now + callMs : null;
    this.state.auction = {
      phase: 'called',
      playerId,
      bids: [],
      deadline,
      pausedRemainingMs: null,
      winnerId: null,
    };
    if (deadline !== null) {
      this.timer = this.clock.setTimeout(() => this.finalizeUnsold(), callMs);
    }
    this.emit({ type: 'called', playerId });
    return { ok: true };
  }

  /**
   * Oferta de un participante. Sin amount = rilancio mínimo (nextMinBid).
   * El orden de llamada a este método ES el orden autoritativo.
   */
  bid(participantId: string, amount?: number): BidResult {
    // Premi&Parla: la pulsación solo reserva la palabra — el monto custom se
    // ignora y siempre vale el mínimo; el real lo corrige el admin (setBid).
    const amt =
      this.state.config.auctionMode === 'premi_parla'
        ? nextMinBid(this.state, this.players)
        : (amount ?? nextMinBid(this.state, this.players));
    if (!Number.isInteger(amt) || amt < 1) return { ok: false, reason: 'too_low' };

    const verdict = validateBid(this.state, this.players, participantId, amt);
    if (!verdict.ok) return { ok: false, reason: verdict.reason };

    const now = this.clock.now();
    const bid: Bid = { participantId, amount: amt, at: now };
    this.state.auction.bids.push(bid);
    this.state.auction.phase = 'bidding';

    this.clearTimer();
    const bidMs = this.state.config.bidTimerSeconds * 1000;
    if (bidMs > 0) {
      this.state.auction.deadline = now + bidMs;
      this.timer = this.clock.setTimeout(() => this.finalizeSold(), bidMs);
    } else {
      this.state.auction.deadline = null; // cierre solo manual
    }
    this.emit({ type: 'bid', bid });
    return { ok: true, bid };
  }

  /**
   * Corrige el monto de la ÚLTIMA oferta al valor cantado (Premi&Parla, o
   * corrección del banditore en cualquier modo). NO reinicia el countdown.
   */
  setBidAmount(amount: number): EngineResult {
    const auction = this.state.auction;
    const last = auction.bids[auction.bids.length - 1];
    if (auction.phase !== 'bidding' || !last) return { ok: false, error: 'no_auction' };
    const previous = auction.bids[auction.bids.length - 2];
    if (!Number.isInteger(amount) || amount < 1 || (previous && amount <= previous.amount)) {
      return { ok: false, error: 'invalid_bid_amount' };
    }
    last.amount = amount;
    this.emit({ type: 'bid_amount_set', amount });
    return { ok: true };
  }

  /** Bonus (+) o malus (−) de créditos de un participante. Permitido incluso con el asta terminada. */
  adjustBudget(participantId: string, delta: number): EngineResult {
    const participant = this.state.participants.find((p) => p.id === participantId);
    if (!participant) return { ok: false, error: 'unknown_participant' };
    if (!Number.isInteger(delta)) return { ok: false, error: 'invalid_delta' };
    participant.budgetBonus += delta;
    this.emit({ type: 'budget_adjusted', participantId, delta });
    return { ok: true };
  }

  /** Anula la subasta en curso: el jugador vuelve a estar disponible (NO va a richiama). */
  cancel(): EngineResult {
    const { phase, playerId } = this.state.auction;
    if ((phase !== 'called' && phase !== 'bidding') || playerId === null) {
      return { ok: false, error: 'no_auction' };
    }
    this.clearTimer();
    this.state.auction = emptyAuction();
    this.emit({ type: 'cancelled', playerId });
    return { ok: true };
  }

  /**
   * Pausa el countdown activo (called o bidding con deadline). Guarda los ms
   * restantes; las ofertas quedan bloqueadas (validateBid → 'paused').
   */
  pause(): EngineResult {
    const auction = this.state.auction;
    if (auction.phase !== 'called' && auction.phase !== 'bidding') {
      return { ok: false, error: 'no_auction' };
    }
    if (auction.deadline === null || auction.pausedRemainingMs !== null) {
      return { ok: false, error: 'not_pausable' };
    }
    auction.pausedRemainingMs = Math.max(0, auction.deadline - this.clock.now());
    auction.deadline = null;
    this.clearTimer();
    this.emit({ type: 'paused' });
    return { ok: true };
  }

  /** Reanuda con los ms que restaban al pausar. */
  resume(): EngineResult {
    const auction = this.state.auction;
    if (auction.phase !== 'called' && auction.phase !== 'bidding') {
      return { ok: false, error: 'no_auction' };
    }
    if (auction.pausedRemainingMs === null) return { ok: false, error: 'not_paused' };

    const remaining = auction.pausedRemainingMs;
    auction.pausedRemainingMs = null;
    auction.deadline = this.clock.now() + remaining;
    this.clearTimer();
    this.timer =
      auction.phase === 'called'
        ? this.clock.setTimeout(() => this.finalizeUnsold(), remaining)
        : this.clock.setTimeout(() => this.finalizeSold(), remaining);
    this.emit({ type: 'resumed' });
    return { ok: true };
  }

  /**
   * Da por terminada el asta (pantalla de resumen). Solo en idle, sin subasta
   * activa; idempotente si ya terminó. No hay evento para reabrir: las
   * correcciones post-asta van por assign/unassign, que siguen permitidas.
   */
  finish(): EngineResult {
    if (this.state.finishedAt !== null) return { ok: true }; // idempotente
    if (this.state.auction.phase !== 'idle') return { ok: false, error: 'auction_in_progress' };
    this.state.finishedAt = this.clock.now();
    this.emit({ type: 'finished' });
    return { ok: true };
  }

  /** Cierre manual del admin: adjudica al último postor, o desierto si no hubo ofertas. */
  close(): EngineResult {
    const { phase } = this.state.auction;
    if (phase !== 'called' && phase !== 'bidding') return { ok: false, error: 'no_auction' };
    if (this.state.auction.bids.length > 0) this.finalizeSold();
    else this.finalizeUnsold();
    return { ok: true };
  }

  // ── Transiciones internas ────────────────────────────────────────────────

  private finalizeSold(): void {
    this.clearTimer();
    const auction = this.state.auction;
    const last = auction.bids[auction.bids.length - 1];
    if (auction.playerId === null || !last) return;
    const winner = this.state.participants.find((p) => p.id === last.participantId);
    if (!winner) return;

    winner.roster.push({ playerId: auction.playerId, price: last.amount });
    auction.phase = 'sold';
    auction.winnerId = winner.id;
    auction.deadline = null;
    auction.pausedRemainingMs = null;
    this.emit({ type: 'sold', playerId: auction.playerId, participantId: winner.id, price: last.amount });
    this.timer = this.clock.setTimeout(() => this.toIdle(), RESULT_DISPLAY_MS);
    this.checkAutoFinish();
    this.advanceTurn(); // subasta resuelta: pasa el turno (si no terminó el asta)
  }

  // ── Turnos ───────────────────────────────────────────────────────────────

  /**
   * Primer índice de callOrder desde `start` (circular, inclusive) cuyo
   * participante existe y todavía tiene cupos libres. null si no hay ninguno.
   */
  private firstEligibleFrom(start: number): number | null {
    const len = this.state.callOrder.length;
    if (len === 0) return null;
    for (let i = 0; i < len; i++) {
      const idx = (((start + i) % len) + len) % len;
      const id = this.state.callOrder[idx];
      const p = this.state.participants.find((x) => x.id === id);
      if (p && !rosterComplete(p, this.state.config)) return idx;
    }
    return null;
  }

  /**
   * Pasa el turno al siguiente con cupos libres (circular) y emite 'turn'.
   * Si nadie tiene cupos libres no avanza (el auto-finish ya habrá cerrado).
   */
  private advanceTurn(): void {
    if (this.state.config.callMode !== 'turns' || this.state.turnIndex === null) return;
    if (this.state.finishedAt !== null) return;
    const next = this.firstEligibleFrom(this.state.turnIndex + 1);
    if (next === null) return;
    this.state.turnIndex = next;
    this.emit({ type: 'turn', participantId: this.state.callOrder[next]! });
  }

  /** Fin automático: todos los participantes con los cupos llenos. Una vez finished, queda finished. */
  private checkAutoFinish(): void {
    if (this.state.finishedAt !== null) return;
    const everyoneFull =
      this.state.participants.length > 0 &&
      this.state.participants.every((p) => rosterComplete(p, this.state.config));
    if (everyoneFull) {
      this.state.finishedAt = this.clock.now();
      this.emit({ type: 'finished' });
    }
  }

  private finalizeUnsold(): void {
    this.clearTimer();
    const auction = this.state.auction;
    if (auction.playerId === null) return;
    auction.phase = 'unsold';
    auction.deadline = null;
    auction.winnerId = null;
    this.state.unsoldPlayerIds.push(auction.playerId);
    this.emit({ type: 'unsold', playerId: auction.playerId });
    this.timer = this.clock.setTimeout(() => this.toIdle(), RESULT_DISPLAY_MS);
    this.advanceTurn(); // también un desierto resuelve la subasta y pasa el turno
  }

  private toIdle(): void {
    this.timer = null;
    this.state.auction = emptyAuction();
    this.emit(); // snapshot sin evento: solo refresco de fase
  }

  private rearmTimersAfterRestore(): void {
    const { phase, deadline, pausedRemainingMs } = this.state.auction;
    const now = this.clock.now();
    // Una sala pausada se restaura pausada: sin timer hasta que el admin reanude.
    if (pausedRemainingMs !== null) return;
    if (phase === 'called' && deadline !== null) {
      this.timer = this.clock.setTimeout(() => this.finalizeUnsold(), Math.max(0, deadline - now));
    } else if (phase === 'bidding' && deadline !== null) {
      this.timer = this.clock.setTimeout(() => this.finalizeSold(), Math.max(0, deadline - now));
    } else if (phase === 'sold' || phase === 'unsold') {
      this.timer = this.clock.setTimeout(() => this.toIdle(), RESULT_DISPLAY_MS);
    }
  }

  private isAssigned(playerId: number): boolean {
    return this.state.participants.some((p) => p.roster.some((e) => e.playerId === playerId));
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private emit(event?: RoomEvent): void {
    this.state.serverTime = this.clock.now();
    this.onChange?.(this.state, event);
  }

  /** Libera timers (apagado del server o sala descartada). */
  dispose(): void {
    this.clearTimer();
  }
}

function emptyAuction() {
  return {
    phase: 'idle' as const,
    playerId: null,
    bids: [],
    deadline: null,
    pausedRemainingMs: null,
    winnerId: null,
  };
}
