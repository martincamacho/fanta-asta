import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  budgetRemaining,
  maxBid,
  nextMinBid,
  rosterComplete,
  type Participant,
  type RoomState,
} from '@fanta/shared';
import { useStore } from '../store';
import { useAuth } from '../authStore';
import { useT } from '../i18n';
import { joinRoom, leaveRoom } from '../lib/socket';
import { loadPlayers } from '../lib/api';
import { getRoomTicket } from '../lib/leagueApi';
import { MOCK } from '../lib/mock';
import { useProfile } from '../lib/profile';
import { sound, useSoundPref } from '../lib/sound';
import { useAuctionSounds } from '../lib/useAuctionSounds';
import { useRoomGuard } from '../lib/useRoomGuard';
import { buzzerUrl, currentBid, currentCallerId, participantName } from '../lib/format';
import { CountdownRing } from '../components/CountdownRing';
import { auctionTimerMs } from '../lib/useCountdown';
import { Icon } from '../components/icons';
import { PlayerImg } from '../components/PlayerImg';
import { RoleBadge } from '../components/RoleBadge';
import { NotLeagueMember, RoomMissing } from '../components/RoomMissing';
import { AssignmentsPanel } from '../components/AssignmentsPanel';
import { LangSwitcher } from '../components/LangSwitcher';
import { SoundToggle } from '../components/SoundToggle';
import { StatBadges } from '../components/StatBadges';

export default function Board() {
  const { code = '' } = useParams();
  const guard = useRoomGuard(code);
  const authStatus = useAuth((s) => s.status);
  const state = useStore((s) => s.state);
  const { t } = useT();
  const [gate, setGate] = useState<'resolving' | 'ok' | 'forbidden'>('resolving');
  const soundPref = useSoundPref('board');
  useAuctionSounds(state, soundPref.enabled, { bidBlip: true });

  // Sorteo animado: el RoomEvent 'order_drawn' dispara el overlay de revelación.
  const lastEvent = useStore((s) => s.lastEvent);
  const eventSeq = useStore((s) => s.eventSeq);
  const [drawOrder, setDrawOrder] = useState<string[] | null>(null);
  const seenSeq = useRef(eventSeq);
  useEffect(() => {
    if (eventSeq === seenSeq.current) return;
    seenSeq.current = eventSeq;
    if (lastEvent?.type !== 'order_drawn' || lastEvent.order.length === 0) return;
    const order = lastEvent.order;
    setDrawOrder(order);
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (soundPref.enabled) {
      order.forEach((_, i) => {
        timers.push(setTimeout(() => sound.blip(), 400 + i * 600));
      });
    }
    timers.push(setTimeout(() => setDrawOrder(null), 400 + order.length * 600 + 2600));
    return () => timers.forEach(clearTimeout);
  }, [eventSeq, lastEvent, soundPref.enabled]);

  useEffect(() => {
    void loadPlayers(code);
    return () => leaveRoom();
  }, [code]);

  // Con sesión, el ticket confirma membresía en salas de liga (403 → no miembro).
  useEffect(() => {
    if (guard.status !== 'ok') return;
    if (MOCK || authStatus === 'anonymous') {
      setGate('ok');
      return;
    }
    if (authStatus !== 'authed') return;
    let alive = true;
    getRoomTicket(code)
      .then((r) => {
        if (alive) setGate(r.kind === 'forbidden' ? 'forbidden' : 'ok');
      })
      .catch(() => {
        if (alive) setGate('ok');
      });
    return () => {
      alive = false;
    };
  }, [guard.status, authStatus, code]);

  useEffect(() => {
    if (guard.status === 'ok' && gate === 'ok') joinRoom({ code, as: 'board' });
  }, [guard.status, gate, code]);

  if (guard.status === 'ok' && gate === 'forbidden')
    return <NotLeagueMember leagueName={guard.leagueName} />;
  if (guard.status === 'checking')
    return (
      <div className="theme-buzz buzz-bg flex min-h-dvh items-center justify-center text-2xl text-chalk-dim">
        {t('board.searching')}
      </div>
    );
  if (guard.status === 'missing') return <RoomMissing code={code} />;
  if (!state)
    return (
      <div className="theme-buzz buzz-bg flex min-h-dvh items-center justify-center text-2xl text-chalk-dim">
        {t('board.connecting')}
      </div>
    );

  return (
    <div className="theme-buzz buzz-bg flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="flex items-baseline justify-between px-8 py-3">
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-chalk">
          {state.config.leagueName}
          {guard.status === 'ok' &&
            guard.leagueName &&
            guard.leagueName !== state.config.leagueName && (
              <span className="ml-3 align-middle text-sm font-body font-semibold uppercase tracking-widest text-chalk-dim">
                {t('board.league', { name: guard.leagueName })}
              </span>
            )}
        </h1>
        <div className="flex items-center gap-4">
          <LangSwitcher compact />
          <SoundToggle enabled={soundPref.enabled} onToggle={soundPref.toggle} />
          <p className="font-display text-3xl font-bold uppercase tracking-[0.35em] text-gold">
            {state.code}
          </p>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 lg:overflow-hidden">
        {state.finishedAt !== null ? (
          <BoardFinished state={state} />
        ) : (
          <div className="grid h-full gap-6 lg:grid-cols-[1.05fr_1fr_1.05fr]">
            <PlayerColumn state={state} />
            <BanditoreColumn state={state} />
            <TeamsColumn state={state} />
          </div>
        )}
      </main>
      <AssignmentsPanel className="fixed bottom-6 left-6 z-30 w-96 max-w-[calc(100vw-2rem)] backdrop-blur" />
      {drawOrder && <DrawOverlay state={state} order={drawOrder} />}
    </div>
  );
}

/** Panel indigo de columna, con el título afuera como en el software oficial. */
function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col">
      <p className="mb-2 px-1 text-xl font-semibold text-chalk">{title}</p>
      <div className="min-h-0 flex-1 overflow-hidden rounded-3xl bg-pitch-950/80 p-6">
        {children}
      </div>
    </section>
  );
}

/** Overlay del sorteo: los equipos se revelan uno por uno en su posición (puesta en escena;
 *  el orden ya viene decidido en el evento). Se cierra solo. */
function DrawOverlay({ state, order }: { state: RoomState; order: string[] }) {
  const { t } = useT();
  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-[hsl(251_70%_9%/0.94)] px-10 backdrop-blur-sm">
      <p className="animate-rise font-display text-6xl font-bold uppercase tracking-wide text-white">
        {t('board.drawTitle1')} <span className="text-gold">{t('board.drawTitle2')}</span>
      </p>
      <ol className="flex max-w-5xl flex-wrap items-center justify-center gap-4">
        {order.map((id, i) => (
          <li
            key={id}
            className="animate-rise flex items-center gap-3 rounded-2xl border-2 border-gold/50 bg-pitch-800 px-6 py-4"
            style={{ animationDelay: `${0.4 + i * 0.6}s`, animationDuration: '0.45s' }}
          >
            <span className="font-display text-4xl font-bold text-gold">
              {t('board.pos', { n: i + 1 })}
            </span>
            <span className="max-w-[16rem] truncate font-display text-3xl font-semibold text-chalk">
              {participantName(state, id)}
            </span>
          </li>
        ))}
      </ol>
      <p
        className="animate-rise text-sm uppercase tracking-[0.3em] text-chalk-dim"
        style={{ animationDelay: `${0.4 + order.length * 0.6}s` }}
      >
        {t('board.drawFirst', { name: participantName(state, order[0]) })}
      </p>
    </div>
  );
}

/* ————— columna izquierda: calciatore ————— */

function PlayerColumn({ state }: { state: RoomState }) {
  const players = useStore((s) => s.players);
  const { t } = useT();
  const player = state.auction.playerId !== null ? players.get(state.auction.playerId) : undefined;
  const profile = useProfile(state.config.hideValues || !player ? null : player.id);

  return (
    <Column title={t('board.colPlayer')}>
      {player ? (
        <div key={player.id} className="animate-rise flex h-full flex-col items-center justify-center gap-4 text-center">
          <PlayerImg player={player} className="w-[clamp(10rem,18vh,16rem)]" />
          <div className="min-w-0">
            <p className="text-sm text-chalk-faint">#{player.id}</p>
            <h2 className="mt-1 font-display text-[clamp(2.6rem,4.5vw,4.5rem)] font-bold uppercase leading-[0.95] text-chalk">
              {player.name}
            </h2>
            <p className="mt-2 text-2xl text-chalk-dim">
              {player.team}
              {!state.config.hideValues && (
                <>
                  {' '}
                  · {t('board.quotazione')}{' '}
                  <span className="tabular font-semibold text-chalk">{player.quotazione}</span>
                </>
              )}
            </p>
            <div className="mt-3 flex justify-center">
              <RoleBadge role={player.role} size="lg" full />
            </div>
            {!state.config.hideValues && (
              <div className="mt-3 flex justify-center">
                <StatBadges profile={profile} />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
          <p className="text-base font-semibold uppercase tracking-[0.35em] text-chalk-dim">
            {t('board.enterWithPhone')}
          </p>
          <div className="rounded-2xl bg-chalk p-4">
            <QRCodeSVG value={buzzerUrl(state.code)} size={190} bgColor="#eef0f7" fgColor="#1b1147" />
          </div>
          <p className="font-display text-[clamp(3.5rem,5vw,5.5rem)] font-bold uppercase leading-none tracking-[0.2em] text-gold">
            {state.code}
          </p>
          <p className="text-chalk-dim">{buzzerUrl(state.code).replace(/^https?:\/\//, '')}</p>
        </div>
      )}
    </Column>
  );
}

/* ————— columna central: banditore ————— */

function BanditoreColumn({ state }: { state: RoomState }) {
  const players = useStore((s) => s.players);
  const eventSeq = useStore((s) => s.eventSeq);
  const { t } = useT();
  const phase = state.auction.phase;
  const bid = currentBid(state);
  const callerId = currentCallerId(state);
  const active = phase === 'called' || phase === 'bidding';
  const paused = state.auction.pausedRemainingMs !== null;
  const premi = state.config.auctionMode === 'premi_parla';

  // Situación del mejor postor (solo modo digital): restantes, post-oferta y % del budget total.
  const bidder = bid ? state.participants.find((p) => p.id === bid.participantId) : undefined;
  const bidderRemaining = bidder ? budgetRemaining(bidder, state.config) : 0;
  const bidderBudgetTotal = bidder ? state.config.budget + (bidder.budgetBonus ?? 0) : 0;
  const bidPct =
    bid && bidderBudgetTotal > 0
      ? Math.max(1, Math.round((bid.amount / bidderBudgetTotal) * 100))
      : null;
  /** La oferta ya superó la quotazione del jugador llamado (oculto con hideValues). */
  const calledQuota =
    state.auction.playerId !== null ? (players.get(state.auction.playerId)?.quotazione ?? 0) : 0;
  const aboveQuota =
    !premi &&
    !state.config.hideValues &&
    bid != null &&
    calledQuota > 0 &&
    bid.amount > calledQuota;

  return (
    <Column title={t('board.colBanditore')}>
      <div className="flex h-full flex-col items-center justify-center gap-6">
        <CountdownRing
          deadline={active ? state.auction.deadline : null}
          durationMs={auctionTimerMs(state)}
          pausedMs={active ? state.auction.pausedRemainingMs : null}
          className="h-[clamp(9rem,22vh,14rem)] w-[clamp(9rem,22vh,14rem)]"
          accent
        />

        {phase === 'sold' ? (
          <div className="animate-sold text-center">
            <p className="font-display text-[clamp(2.6rem,4.5vw,4.5rem)] font-bold uppercase leading-none text-gold animate-ticker-glow">
              <Icon name="gavel" className="mr-3 text-[0.6em]" />
              {t('board.sold')}
            </p>
            <p className="mt-3 text-2xl text-chalk">
              {t('board.soldTo')}{' '}
              <span className="font-display font-bold">
                {participantName(state, state.auction.winnerId)}
              </span>
            </p>
            <p className="tabular mt-1 font-display text-[clamp(3.5rem,6vw,6rem)] font-bold leading-none text-gold">
              <Icon name="coin" className="mr-2 text-[0.4em] opacity-70" />
              {bid?.amount ?? 0}
            </p>
          </div>
        ) : phase === 'unsold' ? (
          <div className="animate-rise text-center">
            <p className="font-display text-[clamp(2.6rem,4.5vw,4.5rem)] font-bold uppercase leading-none text-chalk-dim">
              {t('board.unsold')}
            </p>
            <p className="mt-2 text-xl text-chalk-faint">{t('board.unsoldText')}</p>
          </div>
        ) : active ? (
          <div className="w-full max-w-md rounded-2xl bg-pitch-800/80 px-6 py-5 text-center">
            {paused && (
              <p className="mb-2 inline-block rounded-full bg-gold/20 px-4 py-1 text-sm font-bold uppercase tracking-widest text-gold">
                <Icon name="pause" className="mr-1" />
                {t('board.paused')}
              </p>
            )}
            {bid ? (
              premi ? (
                <>
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-chalk-dim">
                    {t('board.word')}
                  </p>
                  <p className="mt-1 truncate font-display text-4xl font-bold uppercase text-gold">
                    {t('board.wordTo', { name: participantName(state, bid.participantId) })}
                  </p>
                  <p key={eventSeq} className="tabular animate-bid-pop mt-1 font-display text-[clamp(3rem,5vw,5rem)] font-bold leading-none text-gold">
                    {bid.amount}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-chalk-dim">
                    {t('board.currentBid')}
                  </p>
                  <p
                    key={eventSeq}
                    className="tabular animate-bid-pop font-display text-[clamp(4rem,8vw,7.5rem)] font-bold leading-none text-gold"
                  >
                    <Icon name="coin" className="mr-2 text-[0.35em] opacity-70" />
                    {bid.amount}
                  </p>
                  {aboveQuota && (
                    <p className="mt-1 text-sm font-semibold uppercase tracking-widest text-gold/80">
                      <Icon name="trendUp" className="mr-1" />
                      {t('buzzer.aboveQuota')}
                    </p>
                  )}
                  <p className="mt-1 truncate font-display text-3xl font-semibold text-chalk">
                    {participantName(state, bid.participantId)}
                  </p>
                  {bidder && (
                    <p className="tabular mt-1 truncate text-lg text-chalk-faint">
                      <Icon name="coin" className="mr-1.5" />
                      {t('buzzer.bidderCredits', {
                        n: bidderRemaining,
                        m: bidderRemaining - bid.amount,
                      })}
                      {bidPct !== null && <> · {t('buzzer.pctOfBudget', { n: bidPct })}</>}
                    </p>
                  )}
                </>
              )
            ) : (
              <>
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-chalk-dim">
                  {t('board.baseAsta')}
                </p>
                <p className="tabular font-display text-[clamp(4rem,8vw,7.5rem)] font-bold leading-none text-gold">
                  {nextMinBid(state, players)}
                </p>
                <p className="mt-1 font-display text-2xl font-semibold uppercase text-chalk-faint">
                  {t('board.whoOpens')}
                </p>
              </>
            )}
            <BidFeed state={state} />
          </div>
        ) : (
          <div className="text-center">
            {callerId ? (
              <p className="animate-rise rounded-xl bg-gold px-5 py-2 font-display text-3xl font-bold uppercase text-pitch-950">
                {t('board.calls', { name: participantName(state, callerId) })}
              </p>
            ) : (
              <p className="text-xl uppercase tracking-[0.2em] text-chalk-faint">
                {t('board.teamsInRoom', { n: state.participants.length })}
              </p>
            )}
          </div>
        )}

        {/* franja del orden de turnos */}
        {state.callOrder.length > 0 && phase === 'idle' && (
          <ol className="flex max-w-md flex-wrap justify-center gap-1.5">
            {state.callOrder.map((id, i) => (
              <li
                key={id}
                className={`rounded-lg px-2 py-0.5 text-sm ${
                  i === state.turnIndex
                    ? 'bg-gold font-bold text-pitch-950'
                    : 'border chalk-line text-chalk-dim'
                }`}
              >
                {i + 1}. {participantName(state, id)}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Column>
  );
}

function BidFeed({ state }: { state: RoomState }) {
  const feed = state.auction.bids.slice(0, -1).slice(-4).reverse();
  if (feed.length === 0) return null;
  return (
    <ul className="mt-6 space-y-1 border-t chalk-line pt-3">
      {feed.map((b) => (
        <li key={`${b.at}-${b.participantId}`} className="flex items-baseline gap-3 text-xl text-chalk-dim">
          <span className="tabular font-display text-2xl font-bold text-chalk-dim">{b.amount}</span>
          <span className="truncate">{participantName(state, b.participantId)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ————— resumen final ————— */

function BoardFinished({ state }: { state: RoomState }) {
  const players = useStore((s) => s.players);
  const { t } = useT();
  const teams = [...state.participants].sort(
    (a, b) => budgetRemaining(a, state.config) - budgetRemaining(b, state.config),
  );
  return (
    <div className="flex h-full flex-col overflow-hidden px-10 py-6">
      <p className="animate-sold text-center font-display text-[clamp(3rem,6vw,6rem)] font-bold uppercase leading-none text-gold animate-ticker-glow">
        {t('board.finished')}
      </p>
      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {teams.map((p) => (
            <li key={p.id} className="animate-rise rounded-xl border chalk-line bg-pitch-800/70 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-display text-2xl font-semibold text-chalk">
                  {p.name}
                </span>
                <span className="tabular shrink-0 font-display text-xl font-bold text-gold">
                  <Icon name="coin" className="mr-1 text-sm opacity-80" />
                  {budgetRemaining(p, state.config)} cr
                </span>
              </div>
              <ul className="mt-2 space-y-0.5">
                {p.roster.map((entry) => {
                  const pl = players.get(entry.playerId);
                  return (
                    <li key={entry.playerId} className="flex justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate text-chalk-dim">
                        {pl ? `${pl.role} · ${pl.name}` : `#${entry.playerId}`}
                      </span>
                      <span className="tabular text-chalk">{entry.price}</span>
                    </li>
                  );
                })}
                {p.roster.length === 0 && (
                  <li className="text-sm text-chalk-faint">{t('board.noBuys')}</li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ————— columna derecha: squadre ————— */

function TeamsColumn({ state }: { state: RoomState }) {
  const { t } = useT();
  const bid = currentBid(state);
  const active = state.auction.phase === 'called' || state.auction.phase === 'bidding';
  const leadingId = active ? (bid?.participantId ?? null) : null;
  const teams = [...state.participants].sort(
    (a, b) =>
      budgetRemaining(b, state.config) - budgetRemaining(a, state.config) ||
      a.name.localeCompare(b.name),
  );
  const soldCount = state.participants.reduce((sum, p) => sum + p.roster.length, 0);
  const soldIds = new Set(state.participants.flatMap((p) => p.roster.map((e) => e.playerId)));
  const richiamaCount = state.unsoldPlayerIds.filter((id) => !soldIds.has(id)).length;

  return (
    <Column title={t('board.colTeams')}>
      <div className="flex h-full flex-col">
        {teams.length === 0 ? (
          <p className="py-8 text-center text-2xl text-chalk-faint">{t('board.nobodyYet')}</p>
        ) : (
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {teams.map((p) => (
              <TeamRow key={p.id} participant={p} state={state} leading={p.id === leadingId} />
            ))}
          </ul>
        )}
        <p className="tabular mt-3 border-t chalk-line pt-2 text-center text-sm font-semibold uppercase tracking-widest text-chalk-dim">
          {t('board.counter', { x: soldCount, y: richiamaCount })}
        </p>
      </div>
    </Column>
  );
}

function TeamRow({
  participant: p,
  state,
  leading,
}: {
  participant: Participant;
  state: RoomState;
  leading: boolean;
}) {
  const { t } = useT();
  const complete = rosterComplete(p, state.config);
  const credits = budgetRemaining(p, state.config);
  return (
    <li
      className={`animate-rise flex items-center gap-3 rounded-2xl px-4 py-3 ${
        leading ? 'bg-gold text-pitch-950' : `bg-pitch-800/80 ${complete ? 'opacity-60' : ''}`
      }`}
    >
      <span
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
          p.connected ? (leading ? 'bg-pitch-950' : 'bg-success') : 'bg-chalk-faint'
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-display text-2xl font-semibold ${leading ? '' : 'text-chalk'}`}>
          {p.name}
          {complete && (
            <span className="ml-2 align-middle text-base" title={t('bidTitle.roster_full')}>
              ✓
            </span>
          )}
        </span>
        <span className={`tabular block text-sm ${leading ? 'text-pitch-950/80' : 'text-chalk-faint'}`}>
          <Icon name="coin" className="mr-1 text-xs" />
          {t('board.maxOffer', { n: Math.max(0, maxBid(p, state.config)) })}
        </span>
      </span>
      <span className={`tabular shrink-0 font-display text-3xl font-bold ${leading ? '' : 'text-gold'}`}>
        <Icon name="coin" className="mr-1.5 text-lg opacity-80" />
        {credits}
        <span className={`ml-1 text-sm font-semibold ${leading ? 'text-pitch-950/70' : 'text-chalk-dim'}`}>
          cr
        </span>
      </span>
    </li>
  );
}
