import { Fragment, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  ROLES,
  budgetRemaining,
  maxBid,
  minSlots,
  nextMinBid,
  rosterTarget,
  slotsLeftForRole,
  validateBid,
  type Participant,
  type Player,
  type Role,
  type RoomState,
} from '@fanta/shared';
import { useStore } from '../store';
import { AuthFlowError, useAuth } from '../authStore';
import { errorText, useT, type MessageKey, type TFunc } from '../i18n';
import { actions, joinRoom, leaveRoom } from '../lib/socket';
import { loadPlayers } from '../lib/api';
import { getRoomTicket } from '../lib/leagueApi';
import { MOCK } from '../lib/mock';
import { persist, type StoredTicket } from '../lib/persist';
import { useProfile } from '../lib/profile';
import { useSoundPref } from '../lib/sound';
import { useAuctionSounds } from '../lib/useAuctionSounds';
import { useWatchlist } from '../lib/watchlist';
import { useWakeLock } from '../lib/useWakeLock';
import { useRoomGuard } from '../lib/useRoomGuard';
import { useCountdown, auctionTimerMs, formatCountdown } from '../lib/useCountdown';
import { currentBid, currentCallerId, normalize, participantName } from '../lib/format';
import { PlayerImg } from '../components/PlayerImg';
import { PlayerSheet } from '../components/PlayerSheet';
import { RoleBadge, ROLE_STYLES } from '../components/RoleBadge';
import { NotLeagueMember, RoomMissing } from '../components/RoomMissing';
import { LangSwitcher } from '../components/LangSwitcher';
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
  const { t } = useT();
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

  if (guard.status === 'checking') return <CenterMsg>{t('buzzer.searching')}</CenterMsg>;
  if (guard.status === 'missing') return <RoomMissing code={code} />;
  if (identity.kind === 'forbidden') return <NotLeagueMember leagueName={guard.leagueName} />;
  if (identity.kind === 'resolving') return <CenterMsg>{t('buzzer.preparingSeat')}</CenterMsg>;
  if (identity.kind === 'anon' && !name) return <AccessGate code={code} onAnonReady={setName} />;
  return <BuzzerLive code={code} leagueName={guard.leagueName} />;
}

function CenterMsg({ children }: { children: ReactNode }) {
  return (
    <div className="theme-buzz buzz-bg flex min-h-dvh items-center justify-center px-6 text-center text-chalk-dim">
      {children}
    </div>
  );
}

/** Gate unificado al entrar por link directo: email + equipo (claim passwordless-lite),
 *  con paso de contraseña si la cuenta está protegida, o flujo anónimo (solo nombre). */
function AccessGate({ code, onAnonReady }: { code: string; onAnonReady: (name: string) => void }) {
  const { t } = useT();
  const claim = useAuth((s) => s.claim);
  const login = useAuth((s) => s.login);
  const [mode, setMode] = useState<'email' | 'anon'>('email');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inputCls =
    'w-full rounded-lg border chalk-line bg-pitch-900 px-4 py-3 text-lg text-chalk placeholder:text-chalk-faint';

  const valid =
    mode === 'anon'
      ? name.trim().length > 0
      : email.includes('@') && name.trim().length > 0 && (!needsPassword || password.length >= 6);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    if (mode === 'anon') {
      persist.setName(code, name.trim());
      onAnonReady(name.trim());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (needsPassword) await login(email.trim(), password);
      else await claim(email.trim(), name.trim());
      // Con sesión, el Buzzer resuelve el ticket y entra solo.
    } catch (err) {
      if (err instanceof AuthFlowError && err.flags.needsPassword) {
        setNeedsPassword(true);
      } else {
        setError(err instanceof Error ? err.message : t('auth.fallbackError'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="theme-buzz buzz-bg flex min-h-dvh flex-col justify-center px-6">
      <form onSubmit={submit} className="mx-auto w-full max-w-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-gold">
          {t('buzzer.room', { code: code.toUpperCase() })}
        </p>
        <h1 className="mb-2 mt-1 font-display text-5xl font-bold uppercase text-chalk">
          {t('buzzer.nameQuestion')}
        </h1>
        {mode === 'email' ? (
          <>
            <p className="mb-5 text-sm text-chalk-dim">{t('gate.emailIntro')}</p>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setNeedsPassword(false);
              }}
              placeholder={t('auth.emailPh')}
              className={inputCls}
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('buzzer.namePh')}
              maxLength={24}
              className={`${inputCls} mt-3`}
            />
            {needsPassword && (
              <div className="animate-rise mt-3">
                <p className="mb-2 text-sm font-semibold text-gold">{t('gate.protected')}</p>
                <input
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('auth.password')}
                  className={inputCls}
                />
              </div>
            )}
          </>
        ) : (
          <div className="mt-4">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('buzzer.namePh')}
              maxLength={24}
              autoFocus
              className={inputCls}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !valid}
          className="mt-4 w-full rounded-xl bg-gold py-4 font-display text-2xl font-bold uppercase tracking-wider text-pitch-950 disabled:bg-pitch-700 disabled:text-chalk-faint"
        >
          {busy ? t('auth.busy') : t('buzzer.enter')}
        </button>
        <div className="mt-4 text-center text-sm">
          {mode === 'email' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setMode('anon');
                  setError(null);
                }}
                className="font-semibold text-chalk-dim underline decoration-dotted hover:text-chalk"
              >
                {t('gate.continueNoAccount')}
              </button>
              <p className="mt-1 text-xs text-chalk-faint">{t('gate.noAccountNote')}</p>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMode('email');
                setError(null);
              }}
              className="font-semibold text-gold underline decoration-dotted"
            >
              {t('gate.useEmail')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function BuzzerLive({ code, leagueName }: { code: string; leagueName?: string }) {
  const state = useStore((s) => s.state);
  const selfId = useStore((s) => s.selfId);
  const players = useStore((s) => s.players);
  const joinError = useStore((s) => s.joinError);
  const authStatus = useAuth((s) => s.status);
  const { t } = useT();
  const soundPref = useSoundPref('buzzer');
  useAuctionSounds(state, soundPref.enabled);

  // Watchlist privada de la sala (local + sync con sesión).
  useEffect(() => {
    void useWatchlist.getState().init(code, authStatus === 'authed');
  }, [code, authStatus]);

  if (joinError) {
    return (
      <CenterMsg>
        <div>
          <p className="mb-2 font-display text-3xl font-bold uppercase text-danger">
            {t('buzzer.joinErrTitle')}
          </p>
          <p>{joinError}</p>
        </div>
      </CenterMsg>
    );
  }
  if (!state) return <CenterMsg>{t('buzzer.connecting')}</CenterMsg>;

  const me = state.participants.find((p) => p.id === selfId);
  if (selfId && !me) {
    return (
      <CenterMsg>
        <div>
          <p className="mb-2 font-display text-3xl font-bold uppercase text-danger">
            {t('buzzer.kickedTitle')}
          </p>
          <p>{t('buzzer.kickedText')}</p>
        </div>
      </CenterMsg>
    );
  }
  if (!me) return <CenterMsg>{t('buzzer.claimingSeat')}</CenterMsg>;

  const player = state.auction.playerId !== null ? players.get(state.auction.playerId) : undefined;

  return (
    <div className="theme-buzz buzz-bg flex min-h-dvh flex-col">
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
      <BottomTabs state={state} meId={me.id} />
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
  const { t } = useT();
  const me = state.participants.find((p) => p.id === meId);
  const credits = me ? budgetRemaining(me, state.config) : 0;
  return (
    <header className="flex items-center justify-between gap-2 border-b chalk-line px-4 py-2.5">
      <div className="flex items-center gap-2 overflow-hidden">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            connection === 'connected' ? 'bg-success' : 'bg-danger animate-pulse-danger'
          }`}
          aria-label={connection === 'connected' ? t('conn.connected') : t('conn.offline')}
        />
        <span className="truncate text-sm text-chalk-dim">
          {leagueName && leagueName !== state.config.leagueName
            ? t('buzzer.league', { name: leagueName })
            : state.config.leagueName}{' '}
          · <span className="tracking-widest">{code.toUpperCase()}</span>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <LangSwitcher compact />
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
  const { t } = useT();
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
                {t('buzzer.turnOf')}
              </p>
              <p className="font-display text-4xl font-bold uppercase text-gold">
                {participantName(state, callerId)}
              </p>
              <p className="max-w-xs text-sm text-chalk-faint">{t('buzzer.turnPicking')}</p>
            </>
          ) : (
            <>
              <p className="font-display text-3xl font-bold uppercase text-chalk-dim">
                {t('buzzer.waitingCall')}
              </p>
              <p className="max-w-xs text-sm text-chalk-faint">{t('buzzer.waitingText')}</p>
            </>
          )}
        </div>
      )}
    </main>
  );
}

/** Modo 'turns' y me toca: elijo qué jugador sale a subasta desde el celular. */
function TurnPicker({ state }: { state: RoomState }) {
  const players = useStore((s) => s.players);
  const { t } = useT();
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
        {t('buzzer.yourTurn')}
      </p>
      <p className="mb-3 mt-1 text-center text-sm text-chalk-dim">{t('buzzer.yourTurnText')}</p>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPicked(null);
        }}
        placeholder={t('buzzer.searchPh')}
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
                {!state.config.hideValues && (
                  <>
                    {' '}
                    · {t('buzzer.quot')} {picked.quotazione}
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPicked(null)}
              aria-label={t('buzzer.dismiss')}
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
            {t('buzzer.callToAuction')}
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
            <li className="py-6 text-center text-sm text-chalk-faint">{t('buzzer.noResults')}</li>
          )}
        </ul>
      )}
    </div>
  );
}

/* ————— subasta ————— */

function rejectTitle(t: TFunc, reason: string): string {
  const key = `bidTitle.${reason}` as MessageKey;
  try {
    return t(key);
  } catch {
    return t('bidTitle.fallback');
  }
}

function AuctionBody({ state, player, meId }: { state: RoomState; player: Player; meId: string }) {
  const players = useStore((s) => s.players);
  const eventSeq = useStore((s) => s.eventSeq);
  const errorSeq = useStore((s) => s.errorSeq);
  const lastError = useStore((s) => s.lastError);
  const { t } = useT();
  const [customOpen, setCustomOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [shake, setShake] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const profile = useProfile(player.id);
  // El jugador llamado está en MI watchlist → marca bien visible (solo la ve este cliente).
  const watchEntry = useWatchlist((s) => s.entries.find((e) => e.playerId === player.id));

  const bid = currentBid(state);
  const minAmount = nextMinBid(state, players);
  const check = useMemo(
    () => validateBid(state, players, meId, minAmount),
    [state, players, meId, minAmount],
  );
  const iAmWinning = bid?.participantId === meId;
  /** Premi&Parla: el botón solo reserva la palabra; el monto se canta de viva voz. */
  const premi = state.config.auctionMode === 'premi_parla';

  // room:error → toast localizado por código + sacudida del botón
  useEffect(() => {
    if (errorSeq === 0 || !lastError) return;
    setToast(errorText(t, lastError));
    setShake((s) => s + 1);
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [errorSeq, lastError, t]);

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
                  · {t('buzzer.quot')} <span className="tabular">{player.quotazione}</span>
                </>
              )}
            </p>
            {!state.config.hideValues && (
              <div className="mt-1.5">
                <StatBadges profile={profile} compact />
              </div>
            )}
            {watchEntry && (
              <p className="animate-rise mt-1.5 inline-flex items-center gap-1 rounded-full bg-gold/20 px-2.5 py-0.5 text-xs font-bold text-gold">
                ★{' '}
                {watchEntry.maxPrice !== null
                  ? t('watch.calledMax', { n: watchEntry.maxPrice })
                  : t('watch.called')}
              </p>
            )}
          </div>
        </div>

        {/* oferta vigente / palabra */}
        <div className="mt-4 flex items-end justify-between gap-3 rounded-xl border chalk-line bg-pitch-800/70 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
              {premi ? t('buzzer.word') : t('buzzer.currentBid')}
            </p>
            {bid ? (
              <p className="truncate text-sm text-chalk">
                {iAmWinning ? t('buzzer.yourBid') : participantName(state, bid.participantId)}
              </p>
            ) : (
              <p className="text-sm text-chalk-faint">{t('buzzer.noBidsYet')}</p>
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
          className={`flex flex-1 flex-col items-center justify-center rounded-3xl transition active:scale-[0.97] ${
            check.ok
              ? 'bg-gold text-pitch-950 shadow-[0_0_70px_-12px_hsl(70_90%_55%/0.8)]'
              : premi && !check.ok && check.reason === 'own_bid'
                ? 'bg-secondary text-navy'
                : 'bg-pitch-800 text-chalk-faint'
          } ${shake > 0 ? 'animate-shake' : ''}`}
        >
          {check.ok ? (
            premi ? (
              <>
                <span className="font-display text-[clamp(2.6rem,10vw,4rem)] font-bold uppercase leading-tight tracking-wide">
                  {t('buzzer.bookWord')}
                </span>
                <span className="mt-2 text-xs font-semibold uppercase tracking-widest opacity-70">
                  {t('buzzer.bookWordHint')}
                </span>
              </>
            ) : (
              <>
                <span className="font-display text-3xl font-semibold uppercase tracking-[0.2em]">
                  {t('buzzer.rilancia')}
                </span>
                <span className="tabular font-display text-[clamp(4rem,20vw,7rem)] font-bold leading-none">
                  {minAmount}
                </span>
                <span className="text-xs font-semibold uppercase tracking-widest opacity-70">
                  {t('buzzer.credits')}
                </span>
              </>
            )
          ) : premi && check.reason === 'own_bid' ? (
            <>
              <span className="animate-sold font-display text-[clamp(2.4rem,9vw,3.6rem)] font-bold uppercase leading-tight">
                {t('buzzer.haveWord')}
              </span>
              <span className="mt-1 text-sm font-semibold uppercase tracking-widest">
                {t('buzzer.haveWordHint')}
              </span>
            </>
          ) : (
            <>
              <span className="font-display text-2xl font-semibold uppercase tracking-wider">
                {rejectTitle(t, check.reason)}
              </span>
              <span className="mt-1 max-w-[26ch] px-4 text-center text-sm">
                {errorText(t, { code: check.reason })}
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
              placeholder={t('buzzer.freeBidMin', { n: minAmount })}
              autoFocus
              className="tabular w-0 flex-1 rounded-xl border chalk-line bg-pitch-900 px-4 text-center font-display text-3xl font-bold text-chalk placeholder:text-base placeholder:font-body placeholder:font-normal placeholder:text-chalk-faint"
            />
            <button
              type="submit"
              disabled={!customCheck || !customCheck.ok}
              className="rounded-xl border-2 border-gold/70 px-5 font-display text-xl font-bold uppercase text-gold disabled:border-pitch-700 disabled:text-chalk-faint"
            >
              {t('buzzer.offer')}
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomOpen(false);
                setCustomAmount('');
              }}
              aria-label={t('buzzer.closeFreeBid')}
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
            {t('buzzer.freeBid')}
          </button>
        )}
        {customOpen && customAmount !== '' && customCheck && !customCheck.ok && (
          <p className="text-center text-xs text-danger">
            {errorText(t, { code: customCheck.reason })}
          </p>
        )}
      </section>
    </>
  );
}

/** Countdown circular estilo FantaAsta Buzz: anillo violeta claro, número en lima
 *  y la palabra "secondi" debajo. En pausa el anillo queda quieto en lima. */
function CountdownBar({ state }: { state: RoomState }) {
  const { t } = useT();
  const total = auctionTimerMs(state);
  const { remainingMs, fraction, active } = useCountdown(state.auction.deadline, total);
  const pausedMs = state.auction.pausedRemainingMs;
  const paused = pausedMs !== null;
  const danger = !paused && active && remainingMs < 2000;

  if (!paused && state.auction.deadline === null) {
    return (
      <p className="mt-3 text-center text-xs uppercase tracking-widest text-chalk-dim">
        {t('buzzer.noTimer')}
      </p>
    );
  }

  const shownMs = paused ? pausedMs : remainingMs;
  const shownFraction = paused ? (total > 0 ? Math.min(1, pausedMs / total) : 0) : fraction;
  const seconds = Math.max(0, Math.ceil(shownMs / 1000));
  const R = 54;
  const C = 2 * Math.PI * R;

  return (
    <div
      className="mt-3 flex items-center justify-center gap-5"
      role="timer"
      aria-label={
        paused
          ? t('count.pausedRemaining', { time: formatCountdown(shownMs) })
          : t('count.remaining', { time: formatCountdown(shownMs) })
      }
    >
      <p
        className={`max-w-[9rem] text-right text-[11px] font-semibold uppercase tracking-widest ${
          paused ? 'text-gold' : 'text-chalk-dim'
        }`}
      >
        {paused
          ? t('buzzer.pausedBy')
          : state.auction.phase === 'called'
            ? t('buzzer.firstBid')
            : t('buzzer.closesIn')}
      </p>
      <div className={`relative h-28 w-28 shrink-0 ${danger ? 'animate-pulse-danger' : ''}`}>
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r={R} fill="none" stroke="var(--color-chalk)" strokeOpacity="0.16" strokeWidth="6" />
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke={paused ? 'var(--color-gold)' : danger ? 'var(--color-danger)' : 'hsl(252 90% 80%)'}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - shownFraction)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`tabular font-display text-5xl font-bold leading-none ${
              danger ? 'text-danger' : 'text-gold'
            }`}
          >
            {seconds}
          </span>
          <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.3em] text-chalk-dim">
            {t('buzzer.seconds')}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ————— sold / unsold ————— */

function SoldBody({ state, player, meId }: { state: RoomState; player: Player; meId: string }) {
  const { t } = useT();
  const winnerId = state.auction.winnerId;
  const price = currentBid(state)?.amount ?? 0;
  const mine = winnerId === meId;
  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6 text-center">
      <div className="animate-sold flex flex-col items-center gap-4">
        <PlayerImg player={player} className="w-40" />
        <div>
          <p className={`font-display text-6xl font-bold uppercase leading-none ${mine ? 'text-gold animate-ticker-glow' : 'text-chalk'}`}>
            {t('buzzer.sold')}
          </p>
          <p className="mt-3 text-lg text-chalk-dim">
            <span className="font-semibold text-chalk">{player.name}</span>{' '}
            {t('buzzer.soldLine', {
              winner: mine ? t('buzzer.yourTeam') : participantName(state, winnerId),
            })}{' '}
            <span className="tabular font-display text-3xl font-bold text-gold">{price}</span>{' '}
            {t('buzzer.credits')}
          </p>
          {mine && (
            <p className="mt-2 font-display text-2xl font-semibold uppercase tracking-wider text-gold">
              {t('buzzer.itsYours')}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

function UnsoldBody({ player }: { player: Player }) {
  const { t } = useT();
  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <PlayerImg player={player} className="w-32 opacity-50 grayscale" />
      <p className="font-display text-5xl font-bold uppercase text-chalk-dim">{t('buzzer.unsold')}</p>
      <p className="text-sm text-chalk-faint">{t('buzzer.unsoldText', { player: player.name })}</p>
    </main>
  );
}

/** Resumen final: el asta terminó (todos los cupos llenos o cierre del admin). */
function FinishedBody({ state, meId }: { state: RoomState; meId: string }) {
  const { t } = useT();
  const me = state.participants.find((p) => p.id === meId);
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6">
      <div className="animate-sold flex flex-col items-center gap-2 py-8 text-center">
        <p className="font-display text-6xl font-bold uppercase leading-none text-gold">
          {t('buzzer.finished')}
        </p>
        <p className="mt-2 max-w-xs text-sm text-chalk-dim">
          {me ? t('buzzer.finishedMine', { n: me.roster.length }) : t('buzzer.finishedText')}
        </p>
      </div>
    </main>
  );
}

/* ————— pestañas inferiores: mi rosa / squadre ————— */

const TAB_STORAGE_KEY = 'fanta:buzzerTab';
type TabId = 'rosa' | 'squadre' | 'listone';

/** Tres pestañas con estado vivo bajo cualquier fase; la activa persiste en localStorage. */
function BottomTabs({ state, meId }: { state: RoomState; meId: string }) {
  const { t } = useT();
  const [tab, setTab] = useState<TabId>(() => {
    try {
      const stored = localStorage.getItem(TAB_STORAGE_KEY);
      return stored === 'squadre' || stored === 'listone' ? stored : 'rosa';
    } catch {
      return 'rosa';
    }
  });

  function pick(next: TabId) {
    setTab(next);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      /* sin storage */
    }
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: 'rosa', label: t('tabs.myRose') },
    { id: 'squadre', label: t('tabs.squads') },
    { id: 'listone', label: t('tabs.listone') },
  ];
  const activeLabel = tabs.find((x) => x.id === tab)?.label;

  return (
    <section className="border-t chalk-line px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
      <div role="tablist" className="grid grid-cols-3 gap-1 rounded-xl bg-pitch-800/70 p-1">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => pick(id)}
            className={`rounded-lg py-2 font-display text-lg font-bold uppercase tracking-wider transition ${
              tab === id ? 'bg-gold text-pitch-950' : 'text-chalk-dim hover:text-chalk'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={activeLabel} className="mt-3">
        {tab === 'rosa' ? (
          <MyRoseTab state={state} meId={meId} />
        ) : tab === 'squadre' ? (
          <SquadsTab state={state} meId={meId} />
        ) : (
          <ListoneTab state={state} meId={meId} />
        )}
      </div>
    </section>
  );
}

/* ————— watchlist (estrella + budget estimado) ————— */

function WatchStar({ player, className = '' }: { player: Player; className?: string }) {
  const { t } = useT();
  const watched = useWatchlist((s) => s.entries.some((e) => e.playerId === player.id));
  const toggle = useWatchlist((s) => s.toggle);
  return (
    <button
      type="button"
      onClick={() => toggle(player.id)}
      aria-pressed={watched}
      aria-label={
        watched ? t('watch.unstar', { name: player.name }) : t('watch.star', { name: player.name })
      }
      className={`shrink-0 rounded px-1 text-xl leading-none transition ${
        watched ? 'text-gold' : 'text-chalk-faint hover:text-chalk'
      } ${className}`}
    >
      {watched ? '★' : '☆'}
    </button>
  );
}

/** Input chico de "budget stimato": aparece solo si el jugador está en la watchlist. */
function WatchMaxInput({ player }: { player: Player }) {
  const { t } = useT();
  const entry = useWatchlist((s) => s.entries.find((e) => e.playerId === player.id));
  const setMaxPrice = useWatchlist((s) => s.setMaxPrice);
  if (!entry) return null;
  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      value={entry.maxPrice ?? ''}
      onChange={(e) => {
        const n = Math.floor(Number(e.target.value));
        setMaxPrice(player.id, Number.isFinite(n) && n > 0 ? n : null);
      }}
      placeholder={t('watch.maxPh')}
      aria-label={t('watch.maxAria', { name: player.name })}
      className="tabular w-16 shrink-0 rounded-lg border chalk-line bg-pitch-900 px-2 py-1 text-center text-sm font-bold text-gold placeholder:text-[10px] placeholder:font-normal placeholder:text-chalk-faint"
    />
  );
}

/* ————— pestaña listone ————— */

/** Estado de un jugador en la sala: vendido (a quién y por cuánto) / richiama / disponible. */
function playerStatus(
  state: RoomState,
  playerId: number,
): { kind: 'sold'; name: string; price: number } | { kind: 'richiama' } | { kind: 'available' } {
  for (const p of state.participants) {
    const entry = p.roster.find((e) => e.playerId === playerId);
    if (entry) return { kind: 'sold', name: p.name, price: entry.price };
  }
  if (state.unsoldPlayerIds.includes(playerId)) return { kind: 'richiama' };
  return { kind: 'available' };
}

const LISTONE_PAGE_SIZE = 20;

/** Explorador del listone efectivo para cualquier participante: búsqueda, filtros por
 *  rol, salto por letra, orden, paginación client-side, estado de cada jugador,
 *  ficha y watchlist con budget estimado. */
function ListoneTab({ state, meId }: { state: RoomState; meId: string }) {
  const players = useStore((s) => s.players);
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const [letter, setLetter] = useState<string | null>(null);
  const [sort, setSort] = useState<'quotazione' | 'name' | 'role'>(
    state.config.hideValues ? 'name' : 'quotazione',
  );
  const [watchOnly, setWatchOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [sheet, setSheet] = useState<Player | null>(null);
  const entries = useWatchlist((s) => s.entries);
  const hideValues = state.config.hideValues;
  const me = state.participants.find((p) => p.id === meId);

  const watchedIds = useMemo(() => new Set(entries.map((e) => e.playerId)), [entries]);

  const list = useMemo(() => {
    const q = normalize(query.trim());
    const out = [...players.values()].filter(
      (p) =>
        (!role || p.role === role) &&
        (!watchOnly || watchedIds.has(p.id)) &&
        (!letter || normalize(p.name).startsWith(letter)) &&
        (!q || normalize(p.name).includes(q) || normalize(p.team).includes(q)),
    );
    out.sort((a, b) => {
      // "Ruolo": desde el arco — P → D → C → A; adentro por quotazione desc (o nombre con hideValues).
      if (sort === 'role') {
        const d = ROLES.indexOf(a.role) - ROLES.indexOf(b.role);
        if (d !== 0) return d;
        return hideValues
          ? a.name.localeCompare(b.name)
          : b.quotazione - a.quotazione || a.name.localeCompare(b.name);
      }
      return sort === 'name' || hideValues
        ? a.name.localeCompare(b.name)
        : b.quotazione - a.quotazione || a.name.localeCompare(b.name);
    });
    return out;
  }, [players, query, role, sort, hideValues, watchOnly, watchedIds, letter]);

  // Cualquier cambio de búsqueda/filtro/orden vuelve a la página 1.
  useEffect(() => {
    setPage(0);
  }, [query, role, letter, sort, watchOnly]);

  const totalPages = Math.max(1, Math.ceil(list.length / LISTONE_PAGE_SIZE));
  const cur = Math.min(page, totalPages - 1);
  const shown = watchOnly
    ? list
    : list.slice(cur * LISTONE_PAGE_SIZE, cur * LISTONE_PAGE_SIZE + LISTONE_PAGE_SIZE);

  const pageBtn =
    'flex h-11 min-w-11 items-center justify-center rounded-xl border chalk-line px-2 font-display text-xl font-bold text-chalk transition disabled:opacity-30 hover:bg-pitch-700';

  return (
    <div>
      {/* barra de búsqueda/filtros, sticky al scrollear la pestaña */}
      <div className="sticky top-0 z-10 -mx-4 space-y-2 bg-[hsl(250_92%_52%/0.92)] px-4 pb-2 pt-1 backdrop-blur-md">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.searchPh')}
          className="w-full rounded-lg border chalk-line bg-pitch-900 px-3 py-2 text-chalk placeholder:text-chalk-faint"
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(role === r ? null : r)}
                aria-pressed={role === r}
                title={t(`role.${r}`)}
                className={`h-9 w-9 rounded-full font-display text-base font-bold transition ${
                  role === r
                    ? ROLE_STYLES[r].badge
                    : `border chalk-line ${ROLE_STYLES[r].text} hover:bg-pitch-700`
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'quotazione' | 'name' | 'role')}
            className="h-9 rounded-lg border chalk-line bg-pitch-900 px-2 text-sm text-chalk"
          >
            {!hideValues && <option value="quotazione">{t('admin.byQuota')}</option>}
            <option value="name">{t('admin.byName')}</option>
            <option value="role">{t('admin.byRole')}</option>
          </select>
          <button
            type="button"
            onClick={() => setWatchOnly((v) => !v)}
            aria-pressed={watchOnly}
            className={`h-9 rounded-full px-3 text-xs font-bold uppercase tracking-wider transition ${
              watchOnly ? 'bg-gold text-pitch-950' : 'border chalk-line text-chalk-dim hover:text-chalk'
            }`}
          >
            ★ {t('watch.only')}
          </button>
        </div>
      </div>

      {watchOnly ? (
        <WatchlistView state={state} me={me} list={list} onSheet={setSheet} />
      ) : (
        <>
          {/* salto por letra */}
          <div className="mt-2 flex flex-wrap gap-0.5">
            {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => {
              const active = letter === l.toLowerCase();
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLetter(active ? null : l.toLowerCase())}
                  aria-pressed={active}
                  className={`h-8 w-8 rounded text-xs font-bold ${
                    active
                      ? 'bg-gold text-pitch-950'
                      : 'text-chalk-dim hover:bg-pitch-700 hover:text-chalk'
                  }`}
                >
                  {l}
                </button>
              );
            })}
          </div>
          <p className="tabular mt-1.5 text-xs font-semibold uppercase tracking-widest text-chalk-dim">
            {t('listone.count', { n: list.length })}
          </p>

          <ul className="mt-1 divide-y divide-chalk/10">
            {shown.map((p, i) => (
              <Fragment key={p.id}>
                {sort === 'role' && shown[i - 1]?.role !== p.role && (
                  <li className="flex items-center gap-2 pb-1 pt-3">
                    <RoleBadge role={p.role} size="sm" />
                    <span className={`text-[11px] font-semibold uppercase tracking-widest ${ROLE_STYLES[p.role].text}`}>
                      {t(`role.${p.role}`)}
                    </span>
                  </li>
                )}
                <ListoneRow player={p} state={state} onSheet={() => setSheet(p)} />
              </Fragment>
            ))}
            {shown.length === 0 && (
              <li className="py-6 text-center text-sm text-chalk-faint">{t('buzzer.noResults')}</li>
            )}
          </ul>

          {/* paginación (slice en memoria: instantánea) */}
          {totalPages > 1 && (
            <nav className="mt-2 flex items-center justify-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage(0)}
                disabled={cur === 0}
                aria-label={t('listone.first')}
                className={pageBtn}
              >
                «
              </button>
              <button
                type="button"
                onClick={() => setPage(Math.max(0, cur - 1))}
                disabled={cur === 0}
                aria-label={t('listone.prev')}
                className={pageBtn}
              >
                ‹
              </button>
              <span className="tabular min-w-28 px-2 text-center text-sm font-semibold text-chalk">
                {t('listone.page', { p: cur + 1, total: totalPages })}
              </span>
              <button
                type="button"
                onClick={() => setPage(Math.min(totalPages - 1, cur + 1))}
                disabled={cur >= totalPages - 1}
                aria-label={t('listone.next')}
                className={pageBtn}
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => setPage(totalPages - 1)}
                disabled={cur >= totalPages - 1}
                aria-label={t('listone.last')}
                className={pageBtn}
              >
                »
              </button>
            </nav>
          )}
        </>
      )}

      {sheet && (
        <PlayerSheet
          player={sheet}
          onClose={() => setSheet(null)}
          actions={
            <span className="flex items-center gap-2">
              <WatchStar player={sheet} />
              <WatchMaxInput player={sheet} />
            </span>
          }
        />
      )}
    </div>
  );
}

function ListoneRow({
  player: p,
  state,
  onSheet,
}: {
  player: Player;
  state: RoomState;
  onSheet: () => void;
}) {
  const { t } = useT();
  const status = playerStatus(state, p.id);
  const sold = status.kind === 'sold';
  return (
    <li className={`flex items-center gap-2 py-2.5 ${sold ? 'opacity-55' : ''}`}>
      <WatchStar player={p} className="flex h-10 w-10 items-center justify-center" />
      <PlayerImg player={p} className="w-11 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <RoleBadge role={p.role} size="sm" />
          <span className={`truncate text-[15px] font-semibold text-chalk ${sold ? 'line-through' : ''}`}>
            {p.name}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-chalk-faint">
          {p.team}
          {' · '}
          {status.kind === 'sold' ? (
            t('listone.sold', { name: status.name, n: status.price })
          ) : status.kind === 'richiama' ? (
            <span className="rounded bg-role-p/20 px-1.5 py-px font-bold uppercase tracking-wider text-role-p">
              {t('admin.richiamaTag')}
            </span>
          ) : (
            t('listone.available')
          )}
        </span>
      </span>
      <WatchMaxInput player={p} />
      {!state.config.hideValues && (
        <span className="tabular shrink-0 rounded-lg bg-pitch-800 px-2 py-1 text-right font-display text-lg font-bold text-chalk-dim">
          {p.quotazione}
        </span>
      )}
      <button
        type="button"
        onClick={onSheet}
        aria-label={t('admin.fichaOf', { name: p.name })}
        title={t('admin.seeFicha')}
        className="flex h-10 shrink-0 items-center rounded-lg px-2 text-xs font-bold uppercase text-gold hover:bg-pitch-700/60"
      >
        {t('admin.ficha')}
      </button>
    </li>
  );
}

/** Vista "Solo watchlist": agrupada por rol, con suma de budgets estimados vs créditos. */
function WatchlistView({
  state,
  me,
  list,
  onSheet,
}: {
  state: RoomState;
  me: Participant | undefined;
  list: Player[];
  onSheet: (p: Player) => void;
}) {
  const { t } = useT();
  const entries = useWatchlist((s) => s.entries);
  const credits = me ? budgetRemaining(me, state.config) : 0;
  const total = entries.reduce((sum, e) => sum + (e.maxPrice ?? 0), 0);
  const over = me !== undefined && total > credits;

  if (list.length === 0) {
    return <p className="mt-4 py-4 text-center text-sm text-chalk-faint">{t('watch.empty')}</p>;
  }

  return (
    <div className="mt-2">
      <p className={`rounded-lg px-3 py-2 text-xs font-semibold ${over ? 'bg-danger/15 text-danger' : 'bg-pitch-800/70 text-chalk-dim'}`}>
        {t('watch.total', { sum: total, left: credits })}
        {over && <span className="block">{t('watch.over')}</span>}
      </p>
      <div className="mt-2 space-y-3">
        {ROLES.map((role) => {
          const group = list.filter((p) => p.role === role);
          if (group.length === 0) return null;
          const roleSum = group.reduce(
            (sum, p) => sum + (entries.find((e) => e.playerId === p.id)?.maxPrice ?? 0),
            0,
          );
          return (
            <div key={role}>
              <p className="mb-1 flex items-baseline justify-between">
                <span className={`text-[11px] font-semibold uppercase tracking-widest ${ROLE_STYLES[role].text}`}>
                  {t(`role.${role}`)}
                </span>
                <span className="tabular text-xs text-chalk-faint">{roleSum} cr</span>
              </p>
              <ul className="divide-y divide-chalk/10">
                {group.map((p) => (
                  <ListoneRow key={p.id} player={p} state={state} onSheet={() => onSheet(p)} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Progreso por rol (P 2/3 · D 5/8 · …) con los colores de rol. */
function RoleProgress({ participant, state }: { participant: Participant; state: RoomState }) {
  const players = useStore((s) => s.players);
  const { t } = useT();
  return (
    <div className="grid grid-cols-4 gap-2">
      {ROLES.map((role) => {
        const left = slotsLeftForRole(participant, state.config, role, players);
        const total = state.config.slots[role];
        return (
          <div
            key={role}
            className={`rounded-lg border px-2 py-1.5 text-center ${
              left <= 0 ? 'border-pitch-600 bg-pitch-700/60 opacity-70' : 'chalk-line'
            }`}
            title={t(`role.${role}`)}
          >
            <span className="tabular font-display text-lg font-bold text-chalk-dim">
              <span className={ROLE_STYLES[role].text}>{role}</span> {total - left}/{total}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Plantilla agrupada por rol con precios; cupos vacíos como "— libero —".
 *  En modo rango los placeholders garantizados son los mínimos por rol. */
function RosterByRole({ participant, state }: { participant: Participant; state: RoomState }) {
  const players = useStore((s) => s.players);
  const { t } = useT();
  return (
    <div className="space-y-3">
      {ROLES.map((role) => {
        const entries = participant.roster.filter((e) => players.get(e.playerId)?.role === role);
        const placeholders = Math.max(0, minSlots(state.config, role) - entries.length);
        return (
          <div key={role}>
            <p className={`mb-1 text-[11px] font-semibold uppercase tracking-widest ${ROLE_STYLES[role].text}`}>
              {t(`role.${role}`)}
            </p>
            <ul className="space-y-1">
              {entries.map((entry) => {
                const p = players.get(entry.playerId);
                return (
                  <li key={entry.playerId} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <RoleBadge role={role} size="sm" />
                      <span className="truncate text-chalk">{p?.name ?? `#${entry.playerId}`}</span>
                      <span className="truncate text-xs text-chalk-faint">{p?.team}</span>
                    </span>
                    <span className="tabular font-display text-base font-bold text-gold">
                      {entry.price}
                    </span>
                  </li>
                );
              })}
              {Array.from({ length: placeholders }, (_, i) => (
                <li
                  key={`free-${i}`}
                  className="rounded border border-dashed border-chalk/15 px-2 py-1 text-xs text-chalk-faint"
                >
                  {t('tabs.freeSlot')}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function MyRoseTab({ state, meId }: { state: RoomState; meId: string }) {
  const { t } = useT();
  const me = state.participants.find((p) => p.id === meId);
  if (!me) return null;
  const credits = budgetRemaining(me, state.config);
  const max = Math.max(0, maxBid(me, state.config));
  const slotsLeft = Math.max(0, rosterTarget(state.config) - me.roster.length);

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-chalk-dim">
        {t('buzzer.myTeam', { name: me.name })}
      </p>
      <div className="flex items-end justify-between gap-3 rounded-xl border chalk-line bg-pitch-800/60 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
            {t('tabs.creditsLeft')}
          </p>
          <p className={`tabular font-display text-6xl font-bold leading-none ${credits < 0 ? 'text-danger' : 'text-gold'}`}>
            {credits}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
            {t('tabs.maxBid')}
          </p>
          <p className="tabular font-display text-4xl font-bold leading-none text-chalk">{max}</p>
        </div>
      </div>
      <RoleProgress participant={me} state={state} />
      <p className={`text-xs font-semibold ${slotsLeft === 0 ? 'text-gold' : 'text-chalk-dim'}`}>
        {slotsLeft === 0 ? t('tabs.rosterDone') : t('tabs.slotsLeft', { n: slotsLeft })}
      </p>
      {me.roster.length === 0 && (
        <p className="text-xs text-chalk-faint">{t('buzzer.emptyRoster')}</p>
      )}
      <RosterByRole participant={me} state={state} />
    </div>
  );
}

/** Los demás equipos, ordenados por créditos restantes (desc), con rosa expandible.
 *  Los precios pagados son públicos: hideValues oculta solo quotazioni/MV. */
function SquadsTab({ state, meId }: { state: RoomState; meId: string }) {
  const players = useStore((s) => s.players);
  const { t } = useT();
  const config = state.config;
  const others = state.participants
    .filter((p) => p.id !== meId)
    .sort(
      (a, b) =>
        budgetRemaining(b, config) - budgetRemaining(a, config) || a.name.localeCompare(b.name),
    );

  if (others.length === 0) {
    return <p className="py-3 text-center text-sm text-chalk-faint">{t('tabs.noOthers')}</p>;
  }

  return (
    <ul className="space-y-2">
      {others.map((p) => (
        <li key={p.id}>
          <details className="rounded-xl border chalk-line bg-pitch-800/50">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${p.connected ? 'bg-success' : 'bg-chalk-faint'}`}
                aria-label={p.connected ? t('conn.connected') : t('conn.offline')}
              />
              <span className="min-w-0 flex-1 truncate font-display text-lg font-semibold text-chalk">
                {p.name}
              </span>
              <span className="flex shrink-0 gap-1.5 text-[11px]">
                {ROLES.map((role) => {
                  const have = p.roster.filter((e) => players.get(e.playerId)?.role === role).length;
                  const full = have >= config.slots[role];
                  return (
                    <span
                      key={role}
                      className={`tabular ${full ? ROLE_STYLES[role].text : 'text-chalk-faint'}`}
                    >
                      {role}
                      {have}/{config.slots[role]}
                    </span>
                  );
                })}
              </span>
              <span className={`tabular shrink-0 font-display text-2xl font-bold ${budgetRemaining(p, config) < 0 ? 'text-danger' : 'text-gold'}`}>
                {budgetRemaining(p, config)}
                <span className="ml-0.5 text-xs font-semibold text-chalk-dim">cr</span>
              </span>
            </summary>
            <div className="border-t chalk-line px-3 py-3">
              {p.roster.length === 0 ? (
                <p className="text-xs text-chalk-faint">{t('buzzer.emptyRoster')}</p>
              ) : (
                <RosterByRole participant={p} state={state} />
              )}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
