import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  BID_REJECT_MESSAGES,
  ROLES,
  ROLE_NAMES,
  budgetRemaining,
  maxBid,
  nextMinBid,
  slotsLeftForRole,
  validateBid,
  type Player,
  type RoomState,
} from '@fanta/shared';
import { useStore } from '../store';
import { useAuth } from '../authStore';
import { actions, joinRoom, leaveRoom } from '../lib/socket';
import { loadPlayers } from '../lib/api';
import { getRoomTicket } from '../lib/leagueApi';
import { MOCK } from '../lib/mock';
import { persist, type StoredTicket } from '../lib/persist';
import { useProfile } from '../lib/profile';
import { useSoundPref } from '../lib/sound';
import { useAuctionSounds } from '../lib/useAuctionSounds';
import { useWakeLock } from '../lib/useWakeLock';
import { useRoomGuard } from '../lib/useRoomGuard';
import { useCountdown, auctionTimerMs, formatCountdown } from '../lib/useCountdown';
import { currentBid, currentCallerId, normalize, participantName } from '../lib/format';
import { PlayerImg } from '../components/PlayerImg';
import { RoleBadge, ROLE_STYLES } from '../components/RoleBadge';
import { NotLeagueMember, RoomMissing } from '../components/RoomMissing';
import { SoundToggle } from '../components/SoundToggle';
import { StatBadges } from '../components/StatBadges';

/** Cómo entra este cliente a la sala: con ticket de liga o como anónimo por código. */
type Identity =
  | { kind: 'resolving' }
  | { kind: 'anon' }
  | { kind: 'ticket'; ticket: StoredTicket }
  | { kind: 'forbidden' };

export default function Buzzer() {
  const { code = '' } = useParams();
  const guard = useRoomGuard(code);
  useWakeLock(); // el celular es el pulsador: la pantalla no se apaga
  const authStatus = useAuth((s) => s.status);
  const [name, setName] = useState(() => persist.getName(code) ?? '');
  const [identity, setIdentity] = useState<Identity>({ kind: 'resolving' });
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    void loadPlayers(code);
    return () => leaveRoom();
  }, [code]);

  // Con sesión, intenta el ticket de liga (identidad estable); si no, flujo anónimo.
  useEffect(() => {
    if (guard.status !== 'ok') return;
    if (MOCK || authStatus === 'anonymous') {
      setIdentity({ kind: 'anon' });
      return;
    }
    if (authStatus !== 'authed') return;
    let alive = true;
    getRoomTicket(code)
      .then((r) => {
        if (!alive) return;
        if (r.kind === 'ticket') {
          persist.setTicket(code, r.ticket);
          setIdentity({ kind: 'ticket', ticket: r.ticket });
        } else if (r.kind === 'forbidden') {
          setIdentity({ kind: 'forbidden' });
        } else {
          setIdentity({ kind: 'anon' });
        }
      })
      .catch(() => {
        if (!alive) return;
        // Sin red hacia el endpoint: si hay ticket guardado de esta sala, sirve para reconectar.
        const saved = persist.getTicket(code);
        setIdentity(saved ? { kind: 'ticket', ticket: saved } : { kind: 'anon' });
      });
    return () => {
      alive = false;
    };
  }, [guard.status, authStatus, code]);

  useEffect(() => {
    if (guard.status !== 'ok' || joined) return;
    if (identity.kind === 'ticket') {
      useStore.getState().setSelfId(identity.ticket.participantId);
      joinRoom({
        code,
        as: 'player',
        name: identity.ticket.name,
        participantId: identity.ticket.participantId,
      });
      setJoined(true);
    } else if (identity.kind === 'anon' && name) {
      joinRoom({
        code,
        as: 'player',
        name,
        participantId: persist.getParticipantId(code) ?? undefined,
      });
      setJoined(true);
    }
  }, [guard.status, identity, name, joined, code]);

  if (guard.status === 'checking') return <CenterMsg>Buscando la sala…</CenterMsg>;
  if (guard.status === 'missing') return <RoomMissing code={code} />;
  if (identity.kind === 'forbidden') return <NotLeagueMember leagueName={guard.leagueName} />;
  if (identity.kind === 'resolving') return <CenterMsg>Preparando tu asiento…</CenterMsg>;
  if (identity.kind === 'anon' && !name) return <NameGate code={code} onReady={setName} />;
  return <BuzzerLive code={code} leagueName={guard.leagueName} />;
}

function CenterMsg({ children }: { children: ReactNode }) {
  return (
    <div className="pitch-bg flex min-h-dvh items-center justify-center px-6 text-center text-chalk-dim">
      {children}
    </div>
  );
}

/** Pide el nombre de equipo si se entró por link directo, sin pasar por el home. */
function NameGate({ code, onReady }: { code: string; onReady: (name: string) => void }) {
  const [value, setValue] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = value.trim();
    if (!clean) return;
    persist.setName(code, clean);
    onReady(clean);
  }
  return (
    <div className="pitch-bg flex min-h-dvh flex-col justify-center px-6">
      <form onSubmit={submit} className="mx-auto w-full max-w-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-gold">
          Sala {code.toUpperCase()}
        </p>
        <h1 className="mb-6 mt-1 font-display text-5xl font-bold uppercase text-chalk">
          ¿Cómo se llama tu equipo?
        </h1>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Nombre de equipo"
          maxLength={24}
          autoFocus
          className="w-full rounded-lg border chalk-line bg-pitch-900 px-4 py-3 text-lg text-chalk placeholder:text-chalk-faint"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="mt-4 w-full rounded-xl bg-primary py-4 font-display text-2xl font-bold uppercase tracking-wider text-white disabled:bg-pitch-700 disabled:text-chalk-faint"
        >
          Entrar
        </button>
      </form>
    </div>
  );
}

function BuzzerLive({ code, leagueName }: { code: string; leagueName?: string }) {
  const state = useStore((s) => s.state);
  const selfId = useStore((s) => s.selfId);
  const players = useStore((s) => s.players);
  const joinError = useStore((s) => s.joinError);
  const soundPref = useSoundPref('buzzer');
  useAuctionSounds(state, soundPref.enabled);

  if (joinError) {
    return (
      <CenterMsg>
        <div>
          <p className="mb-2 font-display text-3xl font-bold uppercase text-danger">No pudiste entrar</p>
          <p>{joinError}</p>
        </div>
      </CenterMsg>
    );
  }
  if (!state) return <CenterMsg>Conectando a la sala…</CenterMsg>;

  const me = state.participants.find((p) => p.id === selfId);
  if (selfId && !me) {
    return (
      <CenterMsg>
        <div>
          <p className="mb-2 font-display text-3xl font-bold uppercase text-danger">
            Fuiste expulsado de la sala
          </p>
          <p>Hablá con el banditore si fue un error.</p>
        </div>
      </CenterMsg>
    );
  }
  if (!me) return <CenterMsg>Reclamando tu asiento…</CenterMsg>;

  const player = state.auction.playerId !== null ? players.get(state.auction.playerId) : undefined;

  return (
    <div className="pitch-bg flex h-dvh flex-col overflow-hidden">
      <TopBar
        code={code}
        state={state}
        meId={me.id}
        leagueName={leagueName}
        soundEnabled={soundPref.enabled}
        onToggleSound={soundPref.toggle}
      />
      {state.finishedAt !== null ? (
        <FinishedBody state={state} meId={me.id} />
      ) : state.auction.phase === 'idle' || !player ? (
        <IdleBody state={state} meId={me.id} />
      ) : state.auction.phase === 'sold' ? (
        <SoldBody state={state} player={player} meId={me.id} />
      ) : state.auction.phase === 'unsold' ? (
        <UnsoldBody player={player} />
      ) : (
        <AuctionBody state={state} player={player} meId={me.id} />
      )}
    </div>
  );
}

function TopBar({
  code,
  state,
  meId,
  leagueName,
  soundEnabled,
  onToggleSound,
}: {
  code: string;
  state: RoomState;
  meId: string;
  leagueName?: string;
  soundEnabled: boolean;
  onToggleSound: () => void;
}) {
  const connection = useStore((s) => s.connection);
  const me = state.participants.find((p) => p.id === meId);
  const credits = me ? budgetRemaining(me, state.config) : 0;
  return (
    <header className="flex items-center justify-between gap-2 border-b chalk-line px-4 py-2.5">
      <div className="flex items-center gap-2 overflow-hidden">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            connection === 'connected' ? 'bg-success' : 'bg-danger animate-pulse-danger'
          }`}
          aria-label={connection === 'connected' ? 'Conectado' : 'Sin conexión'}
        />
        <span className="truncate text-sm text-chalk-dim">
          {leagueName && leagueName !== state.config.leagueName
            ? `Liga: ${leagueName}`
            : state.config.leagueName}{' '}
          · <span className="tracking-widest">{code.toUpperCase()}</span>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SoundToggle enabled={soundEnabled} onToggle={onToggleSound} />
        <span className="tabular rounded-md bg-pitch-800 px-2.5 py-1 font-display text-xl font-bold text-gold">
          {credits} cr
        </span>
      </div>
    </header>
  );
}

/* ————— idle ————— */

function IdleBody({ state, meId }: { state: RoomState; meId: string }) {
  const callerId = currentCallerId(state);
  const myTurn = callerId !== null && callerId === meId;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6">
      {myTurn ? (
        <TurnPicker state={state} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
          <div className="h-24 w-24 opacity-30">
            <svg viewBox="0 0 120 120" className="h-full w-full">
              <circle cx="60" cy="60" r="54" fill="none" stroke="var(--color-chalk)" strokeWidth="4" strokeDasharray="6 10" />
              <circle cx="60" cy="60" r="4" fill="var(--color-chalk)" />
            </svg>
          </div>
          {callerId ? (
            <>
              <p className="font-display text-3xl font-bold uppercase text-chalk-dim">
                Turno de llamada
              </p>
              <p className="font-display text-4xl font-bold uppercase text-gold">
                {participantName(state, callerId)}
              </p>
              <p className="max-w-xs text-sm text-chalk-faint">
                Está eligiendo qué jugador sale a subasta.
              </p>
            </>
          ) : (
            <>
              <p className="font-display text-3xl font-bold uppercase text-chalk-dim">
                Esperando la próxima llamada
              </p>
              <p className="max-w-xs text-sm text-chalk-faint">
                El banditore todavía no llamó a ningún jugador. Mantené el dedo listo.
              </p>
            </>
          )}
        </div>
      )}
      <MyPanel state={state} meId={meId} open={!myTurn} />
    </main>
  );
}

/** Modo 'turns' y me toca: elijo qué jugador sale a subasta desde el celular. */
function TurnPicker({ state }: { state: RoomState }) {
  const players = useStore((s) => s.players);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Player | null>(null);

  const sold = useMemo(
    () => new Set(state.participants.flatMap((p) => p.roster.map((e) => e.playerId))),
    [state],
  );
  const results = useMemo(() => {
    const q = normalize(query.trim());
    const all = [...players.values()].filter((p) => !sold.has(p.id));
    const filtered = q
      ? all.filter((p) => normalize(p.name).includes(q) || normalize(p.team).includes(q))
      : all;
    filtered.sort((a, b) => b.quotazione - a.quotazione);
    return filtered.slice(0, 15);
  }, [players, sold, query]);

  return (
    <div className="flex flex-1 flex-col">
      <p className="animate-rise text-center font-display text-4xl font-bold uppercase text-gold">
        ¡Te toca llamar!
      </p>
      <p className="mb-3 mt-1 text-center text-sm text-chalk-dim">
        Elegí qué jugador sale a subasta.
      </p>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPicked(null);
        }}
        placeholder="Buscar jugador o equipo…"
        className="w-full rounded-lg border chalk-line bg-pitch-900 px-4 py-3 text-chalk placeholder:text-chalk-faint"
      />
      {picked ? (
        <div className="animate-rise mt-3 rounded-xl border-2 border-primary/60 bg-pitch-800 p-4">
          <div className="flex items-center gap-3">
            <RoleBadge role={picked.role} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-2xl font-bold uppercase text-chalk">
                {picked.name}
              </p>
              <p className="text-xs text-chalk-dim">
                {picked.team}
                {!state.config.hideValues && <> · quot. {picked.quotazione}</>}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPicked(null)}
              aria-label="Descartar"
              className="rounded px-2 text-chalk-faint"
            >
              ✕
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.vibrate?.(30);
              actions.call(picked.id);
            }}
            className="mt-3 w-full rounded-xl bg-primary py-3.5 font-display text-2xl font-bold uppercase tracking-wider text-white active:scale-[0.98]"
          >
            Llamar a subasta
          </button>
        </div>
      ) : (
        <ul className="mt-2 min-h-0 flex-1 divide-y divide-chalk/5 overflow-y-auto">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setPicked(p)}
                className="flex w-full items-center gap-3 px-1 py-2.5 text-left"
              >
                <RoleBadge role={p.role} size="sm" />
                <span className="min-w-0 flex-1 truncate text-chalk">
                  {p.name}
                  <span className="ml-2 text-xs text-chalk-faint">{p.team}</span>
                </span>
                {!state.config.hideValues && (
                  <span className="tabular font-display text-lg font-bold text-chalk-dim">
                    {p.quotazione}
                  </span>
                )}
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="py-6 text-center text-sm text-chalk-faint">Sin resultados.</li>
          )}
        </ul>
      )}
    </div>
  );
}

/* ————— subasta ————— */

function AuctionBody({ state, player, meId }: { state: RoomState; player: Player; meId: string }) {
  const players = useStore((s) => s.players);
  const eventSeq = useStore((s) => s.eventSeq);
  const errorSeq = useStore((s) => s.errorSeq);
  const lastError = useStore((s) => s.lastError);
  const [customOpen, setCustomOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [shake, setShake] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const profile = useProfile(player.id);

  const bid = currentBid(state);
  const minAmount = nextMinBid(state, players);
  const check = useMemo(
    () => validateBid(state, players, meId, minAmount),
    [state, players, meId, minAmount],
  );
  const iAmWinning = bid?.participantId === meId;
  /** Premi&Parla: el botón solo reserva la palabra; el monto se canta de viva voz. */
  const premi = state.config.auctionMode === 'premi_parla';

  // room:error → toast + sacudida del botón
  useEffect(() => {
    if (errorSeq === 0 || !lastError) return;
    setToast(lastError.message);
    setShake((s) => s + 1);
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [errorSeq, lastError]);

  function fire(amount?: number) {
    navigator.vibrate?.(30);
    actions.bid(amount);
  }

  function submitCustom(e: FormEvent) {
    e.preventDefault();
    const amount = Number(customAmount);
    if (!Number.isFinite(amount) || amount < minAmount) return;
    fire(Math.floor(amount));
    setCustomAmount('');
    setCustomOpen(false);
  }

  const customCheck =
    customAmount !== ''
      ? validateBid(state, players, meId, Math.floor(Number(customAmount)) || 0)
      : null;

  return (
    <>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-4">
        {/* jugador llamado */}
        <div key={player.id} className="animate-rise flex items-center gap-4">
          <PlayerImg player={player} className="w-24 shrink-0 sm:w-28" />
          <div className="min-w-0">
            <RoleBadge role={player.role} size="sm" full />
            <h1 className="mt-1 truncate font-display text-4xl font-bold uppercase leading-none text-chalk sm:text-5xl">
              {player.name}
            </h1>
            <p className="mt-1 text-sm text-chalk-dim">
              {player.team}
              {!state.config.hideValues && (
                <>
                  {' '}
                  · quot. <span className="tabular">{player.quotazione}</span>
                </>
              )}
            </p>
            {!state.config.hideValues && (
              <div className="mt-1.5">
                <StatBadges profile={profile} compact />
              </div>
            )}
          </div>
        </div>

        {/* oferta vigente / palabra */}
        <div className="mt-4 flex items-end justify-between gap-3 rounded-xl border chalk-line bg-pitch-800/70 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
              {premi ? 'Palabra' : 'Oferta vigente'}
            </p>
            {bid ? (
              <p className="truncate text-sm text-chalk">
                {iAmWinning ? 'Tuya' : participantName(state, bid.participantId)}
              </p>
            ) : (
              <p className="text-sm text-chalk-faint">Sin ofertas todavía</p>
            )}
          </div>
          <span
            key={eventSeq}
            className="tabular animate-bid-pop font-display text-6xl font-bold leading-none text-gold"
          >
            {bid ? bid.amount : '—'}
          </span>
        </div>

        <CountdownBar state={state} />
      </main>

      {/* zona de rilancio: mínimo 40% de la pantalla */}
      <section className="flex min-h-[42dvh] flex-col gap-2 border-t chalk-line px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
        {toast && (
          <p role="alert" className="animate-rise rounded-lg bg-danger/15 px-3 py-2 text-center text-sm font-semibold text-danger">
            {toast}
          </p>
        )}
        <button
          key={shake}
          type="button"
          onClick={() => fire()}
          disabled={!check.ok}
          className={`flex flex-1 flex-col items-center justify-center rounded-2xl transition active:scale-[0.97] ${
            check.ok
              ? 'bg-primary text-white shadow-[0_0_60px_-10px_hsl(217_93%_52%_/_0.65)]'
              : premi && !check.ok && check.reason === 'own_bid'
                ? 'bg-secondary text-navy'
                : 'bg-pitch-800 text-chalk-faint'
          } ${shake > 0 ? 'animate-shake' : ''}`}
        >
          {check.ok ? (
            premi ? (
              <>
                <span className="font-display text-[clamp(2.6rem,10vw,4rem)] font-bold uppercase leading-tight tracking-wide">
                  Pedir la palabra
                </span>
                <span className="mt-2 text-xs font-semibold uppercase tracking-widest opacity-70">
                  La oferta se canta de viva voz
                </span>
              </>
            ) : (
              <>
                <span className="font-display text-3xl font-semibold uppercase tracking-[0.2em]">
                  Rilancio
                </span>
                <span className="tabular font-display text-[clamp(4rem,20vw,7rem)] font-bold leading-none">
                  {minAmount}
                </span>
                <span className="text-xs font-semibold uppercase tracking-widest opacity-70">
                  créditos
                </span>
              </>
            )
          ) : premi && check.reason === 'own_bid' ? (
            <>
              <span className="animate-sold font-display text-[clamp(2.4rem,9vw,3.6rem)] font-bold uppercase leading-tight">
                ¡Tenés la palabra!
              </span>
              <span className="mt-1 text-sm font-semibold uppercase tracking-widest">
                Cantá tu oferta al banditore
              </span>
            </>
          ) : (
            <>
              <span className="font-display text-2xl font-semibold uppercase tracking-wider">
                {REJECT_TITLES[check.reason] ?? 'No podés ofertar'}
              </span>
              <span className="mt-1 max-w-[26ch] px-4 text-center text-sm">
                {BID_REJECT_MESSAGES[check.reason]}
              </span>
            </>
          )}
        </button>

        {/* puja libre (solo modo digital) */}
        {premi ? null : customOpen ? (
          <form onSubmit={submitCustom} className="flex items-stretch gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={minAmount}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder={`Mínimo ${minAmount}`}
              autoFocus
              className="tabular w-0 flex-1 rounded-xl border chalk-line bg-pitch-900 px-4 text-center font-display text-3xl font-bold text-chalk placeholder:text-base placeholder:font-body placeholder:font-normal placeholder:text-chalk-faint"
            />
            <button
              type="submit"
              disabled={!customCheck || !customCheck.ok}
              className="rounded-xl border-2 border-primary/70 px-5 font-display text-xl font-bold uppercase text-primary disabled:border-pitch-700 disabled:text-chalk-faint"
            >
              Ofertar
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomOpen(false);
                setCustomAmount('');
              }}
              aria-label="Cerrar puja libre"
              className="rounded-xl border chalk-line px-4 text-chalk-dim"
            >
              ✕
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCustomOpen(true)}
            disabled={!check.ok && check.reason !== 'own_bid' && check.reason !== 'too_low'}
            className="rounded-xl border chalk-line py-2.5 text-sm font-semibold uppercase tracking-widest text-chalk-dim disabled:opacity-40"
          >
            Puja libre · monto a elección
          </button>
        )}
        {customOpen && customAmount !== '' && customCheck && !customCheck.ok && (
          <p className="text-center text-xs text-danger">{BID_REJECT_MESSAGES[customCheck.reason]}</p>
        )}
        <MyPanel state={state} meId={meId} />
      </section>
    </>
  );
}

const REJECT_TITLES: Record<string, string> = {
  own_bid: 'Vas ganando',
  role_full: 'Cupo lleno',
  roster_full: 'Plantilla completa',
  min_conflict: 'Cupos mínimos',
  exceeds_max: 'Sin créditos',
  too_low: 'Oferta baja',
  no_auction: 'Sin subasta',
  paused: 'Pausada',
  unknown_participant: 'Fuera de la sala',
};

function CountdownBar({ state }: { state: RoomState }) {
  const { remainingMs, fraction, active } = useCountdown(
    state.auction.deadline,
    auctionTimerMs(state),
  );
  const danger = active && remainingMs < 2000;
  const pausedMs = state.auction.pausedRemainingMs;
  if (pausedMs !== null) {
    const total = auctionTimerMs(state);
    return (
      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-gold">
            Pausada por el banditore
          </span>
          <span className="tabular font-display text-3xl font-bold leading-none text-gold">
            {formatCountdown(pausedMs)}
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-pitch-700">
          <div
            className="h-full rounded-full bg-gold/70"
            style={{ width: `${total > 0 ? Math.min(1, pausedMs / total) * 100 : 0}%` }}
          />
        </div>
      </div>
    );
  }
  if (state.auction.deadline === null) {
    return (
      <p className="mt-3 text-center text-xs uppercase tracking-widest text-chalk-faint">
        Sin límite — cierra el banditore
      </p>
    );
  }
  return (
    <div className="mt-3" role="timer" aria-label={`${formatCountdown(remainingMs)} restantes`}>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
          {state.auction.phase === 'called' ? 'Primera oferta' : 'Cierra en'}
        </span>
        <span
          className={`tabular font-display text-3xl font-bold leading-none ${
            danger ? 'text-danger animate-pulse-danger' : 'text-chalk'
          }`}
        >
          {formatCountdown(remainingMs)}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-pitch-700">
        <div
          className={`h-full rounded-full ${danger ? 'bg-danger' : 'bg-chalk'}`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}

/* ————— sold / unsold ————— */

function SoldBody({ state, player, meId }: { state: RoomState; player: Player; meId: string }) {
  const winnerId = state.auction.winnerId;
  const price = currentBid(state)?.amount ?? 0;
  const mine = winnerId === meId;
  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6 text-center">
      <div className="animate-sold flex flex-col items-center gap-4">
        <PlayerImg player={player} className="w-40" />
        <div>
          <p className={`font-display text-6xl font-bold uppercase leading-none ${mine ? 'text-gold animate-ticker-glow' : 'text-chalk'}`}>
            ¡Vendido!
          </p>
          <p className="mt-3 text-lg text-chalk-dim">
            <span className="font-semibold text-chalk">{player.name}</span> a{' '}
            <span className="font-semibold text-chalk">
              {mine ? 'tu equipo' : participantName(state, winnerId)}
            </span>{' '}
            por <span className="tabular font-display text-3xl font-bold text-gold">{price}</span>
          </p>
          {mine && (
            <p className="mt-2 font-display text-2xl font-semibold uppercase tracking-wider text-gold">
              ¡Es tuyo!
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

function UnsoldBody({ player }: { player: Player }) {
  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <PlayerImg player={player} className="w-32 opacity-50 grayscale" />
      <p className="font-display text-5xl font-bold uppercase text-chalk-dim">Desierto</p>
      <p className="text-sm text-chalk-faint">
        Nadie ofertó por {player.name}. Queda en la lista de richiama.
      </p>
    </main>
  );
}

/** Resumen final: el asta terminó (todos los cupos llenos o cierre del admin). */
function FinishedBody({ state, meId }: { state: RoomState; meId: string }) {
  const me = state.participants.find((p) => p.id === meId);
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6">
      <div className="animate-sold flex flex-col items-center gap-2 py-8 text-center">
        <p className="font-display text-6xl font-bold uppercase leading-none text-gold">
          ¡Asta terminada!
        </p>
        <p className="mt-2 max-w-xs text-sm text-chalk-dim">
          {me
            ? `Cerraste con ${me.roster.length} jugadores. Esta es tu plantilla final.`
            : 'Se terminó la subasta.'}
        </p>
      </div>
      <MyPanel state={state} meId={meId} open />
    </main>
  );
}

/* ————— mi equipo ————— */

function MyPanel({ state, meId, open = false }: { state: RoomState; meId: string; open?: boolean }) {
  const players = useStore((s) => s.players);
  const me = state.participants.find((p) => p.id === meId);
  if (!me) return null;
  const credits = budgetRemaining(me, state.config);
  const max = maxBid(me, state.config);

  return (
    <details open={open} className="rounded-xl border chalk-line bg-pitch-800/60">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="text-xs font-semibold uppercase tracking-widest text-chalk-dim">
          Mi equipo · {me.name}
        </span>
        <span className="tabular text-sm text-chalk-dim">
          <span className="font-display text-lg font-bold text-gold">{credits}</span> cr · max{' '}
          <span className="font-display text-lg font-bold text-chalk">{Math.max(0, max)}</span>
        </span>
      </summary>
      <div className="border-t chalk-line px-4 py-3">
        <div className="mb-3 grid grid-cols-4 gap-2">
          {ROLES.map((role) => {
            const left = slotsLeftForRole(me, state.config, role, players);
            const total = state.config.slots[role];
            return (
              <div
                key={role}
                className={`rounded-lg border px-2 py-1.5 text-center ${
                  left <= 0 ? 'border-pitch-600 bg-pitch-700/60 opacity-60' : 'chalk-line'
                }`}
                title={ROLE_NAMES[role]}
              >
                <span className={`font-display text-lg font-bold ${ROLE_STYLES[role].text}`}>
                  {role}
                </span>
                <span className="tabular block text-xs text-chalk-dim">
                  {total - left}/{total}
                  {left <= 0 ? ' · lleno' : ''}
                </span>
              </div>
            );
          })}
        </div>
        {me.roster.length === 0 ? (
          <p className="text-xs text-chalk-faint">Todavía no compraste a nadie.</p>
        ) : (
          <ul className="space-y-1">
            {me.roster.map((entry) => {
              const p = players.get(entry.playerId);
              return (
                <li key={entry.playerId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    {p && <RoleBadge role={p.role} size="sm" />}
                    <span className="truncate text-chalk">{p?.name ?? `#${entry.playerId}`}</span>
                    <span className="truncate text-xs text-chalk-faint">{p?.team}</span>
                  </span>
                  <span className="tabular font-display text-base font-bold text-gold">
                    {entry.price}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
