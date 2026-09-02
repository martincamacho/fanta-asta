import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { budgetRemaining, type Participant, type RoomState } from '@fanta/shared';
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
      <div className="pitch-bg flex min-h-dvh items-center justify-center text-2xl text-chalk-dim">
        {t('board.searching')}
      </div>
    );
  if (guard.status === 'missing') return <RoomMissing code={code} />;
  if (!state)
    return (
      <div className="pitch-bg flex min-h-dvh items-center justify-center text-2xl text-chalk-dim">
        {t('board.connecting')}
      </div>
    );

  return (
    <div className="pitch-bg flex h-dvh flex-col overflow-hidden">
      <header className="flex items-baseline justify-between border-b chalk-line px-8 py-3">
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
      <main className="min-h-0 flex-1">
        {state.finishedAt !== null ? (
          <BoardFinished state={state} />
        ) : state.auction.phase === 'idle' ? (
          <BoardIdle state={state} />
        ) : (
          <BoardAuction state={state} />
        )}
      </main>
      <AssignmentsPanel className="fixed bottom-16 left-4 z-30 w-96 max-w-[calc(100vw-2rem)] backdrop-blur" />
      <CreditsRail state={state} />
      {drawOrder && <DrawOverlay state={state} order={drawOrder} />}
    </div>
  );
}

/** Overlay del sorteo: los equipos se revelan uno por uno en su posición (puesta en escena;
 *  el orden ya viene decidido en el evento). Se cierra solo. */
function DrawOverlay({ state, order }: { state: RoomState; order: string[] }) {
  const { t } = useT();
  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-[hsl(230_28%_8%/0.94)] px-10 backdrop-blur-sm">
      <p className="animate-rise font-display text-6xl font-bold uppercase tracking-wide text-white">
        {t('board.drawTitle1')} <span className="text-secondary">{t('board.drawTitle2')}</span>
      </p>
      <ol className="flex max-w-5xl flex-wrap items-center justify-center gap-4">
        {order.map((id, i) => (
          <li
            key={id}
            className="animate-rise flex items-center gap-3 rounded-2xl border-2 border-primary/60 bg-pitch-800 px-6 py-4"
            style={{ animationDelay: `${0.4 + i * 0.6}s`, animationDuration: '0.45s' }}
          >
            <span className="font-display text-4xl font-bold text-secondary">
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

/* ————— idle: código + QR + participantes ————— */

function BoardIdle({ state }: { state: RoomState }) {
  const { t } = useT();
  const callerId = currentCallerId(state);
  return (
    <div className="grid h-full grid-cols-[minmax(20rem,2fr)_3fr] items-center gap-8 px-10">
      <div className="flex flex-col items-center gap-6 text-center">
        {callerId && (
          <p className="animate-rise rounded-xl bg-primary px-5 py-2 font-display text-3xl font-bold uppercase text-white">
            {t('board.calls', { name: participantName(state, callerId) })}
          </p>
        )}
        {state.callOrder.length > 0 && (
          <ol className="flex max-w-md flex-wrap justify-center gap-1.5">
            {state.callOrder.map((id, i) => (
              <li
                key={id}
                className={`rounded-lg px-2 py-0.5 text-sm ${
                  i === state.turnIndex
                    ? 'bg-primary font-bold text-white'
                    : 'border chalk-line text-chalk-dim'
                }`}
              >
                {i + 1}. {participantName(state, id)}
              </li>
            ))}
          </ol>
        )}
        <p className="text-lg font-semibold uppercase tracking-[0.4em] text-chalk-dim">
          {t('board.enterWithPhone')}
        </p>
        <div className="rounded-2xl bg-chalk p-5">
          <QRCodeSVG value={buzzerUrl(state.code)} size={230} bgColor="#eef0f7" fgColor="#131627" />
        </div>
        <p className="font-display text-[6rem] font-bold uppercase leading-none tracking-[0.25em] text-gold">
          {state.code}
        </p>
        <p className="text-chalk-dim">{buzzerUrl(state.code).replace(/^https?:\/\//, '')}</p>
      </div>
      <div className="max-h-full overflow-y-auto py-8">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.3em] text-chalk-dim">
          {t('board.teamsInRoom', { n: state.participants.length })}
        </p>
        {state.participants.length === 0 ? (
          <p className="text-2xl text-chalk-faint">{t('board.nobodyYet')}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {state.participants.map((p) => (
              <li key={p.id} className="animate-rise rounded-xl border chalk-line bg-pitch-800/70 px-5 py-4">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${p.connected ? 'bg-role-d' : 'bg-chalk-faint'}`}
                  />
                  <span className="truncate font-display text-2xl font-semibold text-chalk">
                    {p.name}
                  </span>
                </div>
                <p className="tabular mt-1 font-display text-3xl font-bold text-gold">
                  {budgetRemaining(p, state.config)}
                  <span className="ml-1 text-base font-semibold text-chalk-dim">cr</span>
                  {p.budgetBonus !== 0 && (
                    <span
                      className={`ml-2 align-middle font-body text-sm font-semibold ${
                        p.budgetBonus > 0 ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {state.config.budget} {p.budgetBonus > 0 ? '+' : '−'}
                      {Math.abs(p.budgetBonus)}
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ————— subasta / sold / unsold ————— */

function BoardAuction({ state }: { state: RoomState }) {
  const players = useStore((s) => s.players);
  const eventSeq = useStore((s) => s.eventSeq);
  const { t } = useT();
  const player = state.auction.playerId !== null ? players.get(state.auction.playerId) : undefined;
  const profile = useProfile(state.config.hideValues ? null : (player?.id ?? null));
  if (!player) return null;
  const phase = state.auction.phase;
  const bid = currentBid(state);

  return (
    <div className="relative grid h-full grid-cols-[1fr_auto_1fr] items-center gap-10 px-12">
      {/* jugador gigante */}
      <div key={player.id} className="animate-rise flex items-center justify-end gap-8">
        <div className="text-right">
          <RoleBadge role={player.role} size="lg" full />
          <h2 className="mt-2 font-display text-[clamp(3rem,7vw,7rem)] font-bold uppercase leading-[0.9] text-chalk">
            {player.name}
          </h2>
          <p className="mt-3 text-2xl text-chalk-dim">
            {player.team}
            {!state.config.hideValues && (
              <>
                {' '}
                · {t('board.quotazione')}{' '}
                <span className="tabular font-semibold text-chalk">{player.quotazione}</span>
              </>
            )}
          </p>
          {!state.config.hideValues && (
            <div className="mt-3 flex justify-end">
              <StatBadges profile={profile} />
            </div>
          )}
        </div>
        <PlayerImg player={player} className="w-[clamp(12rem,20vw,20rem)] shrink-0" />
      </div>

      {/* countdown */}
      <div className="flex flex-col items-center gap-4">
        <CountdownRing
          deadline={phase === 'sold' || phase === 'unsold' ? null : state.auction.deadline}
          durationMs={auctionTimerMs(state)}
          pausedMs={phase === 'sold' || phase === 'unsold' ? null : state.auction.pausedRemainingMs}
          className="h-[clamp(10rem,24vh,16rem)] w-[clamp(10rem,24vh,16rem)]"
          accent
        />
      </div>

      {/* oferta + feed */}
      <div className="min-w-0">
        {phase === 'sold' ? (
          <div className="animate-sold">
            <p className="font-display text-[clamp(3rem,6vw,6rem)] font-bold uppercase leading-none text-gold animate-ticker-glow">
              {t('board.sold')}
            </p>
            <p className="mt-4 text-3xl text-chalk">
              {t('board.soldTo')}{' '}
              <span className="font-display font-bold">
                {participantName(state, state.auction.winnerId)}
              </span>
            </p>
            <p className="tabular mt-2 font-display text-[clamp(4rem,8vw,8rem)] font-bold leading-none text-gold">
              {bid?.amount ?? 0}
            </p>
          </div>
        ) : phase === 'unsold' ? (
          <div className="animate-rise">
            <p className="font-display text-[clamp(3rem,6vw,6rem)] font-bold uppercase leading-none text-chalk-dim">
              {t('board.unsold')}
            </p>
            <p className="mt-3 text-2xl text-chalk-faint">{t('board.unsoldText')}</p>
          </div>
        ) : (
          <>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-chalk-dim">
              {state.config.auctionMode === 'premi_parla' ? t('board.word') : t('board.currentBid')}
            </p>
            {bid ? (
              <>
                <p
                  key={eventSeq}
                  className="tabular animate-bid-pop font-display text-[clamp(5rem,11vw,11rem)] font-bold leading-none text-gold"
                >
                  {bid.amount}
                </p>
                <p className="mt-1 truncate font-display text-4xl font-semibold text-chalk">
                  {participantName(state, bid.participantId)}
                </p>
              </>
            ) : (
              <p className="mt-2 font-display text-5xl font-semibold uppercase text-chalk-faint">
                {t('board.whoOpens')}
              </p>
            )}
            <BidFeed state={state} />
          </>
        )}
      </div>
    </div>
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

/* ————— rail de créditos, siempre visible ————— */

function CreditsRail({ state }: { state: RoomState }) {
  const bid = currentBid(state);
  const active = state.auction.phase === 'called' || state.auction.phase === 'bidding';
  return (
    <footer className="flex gap-2 overflow-x-auto border-t chalk-line px-6 py-3">
      {state.participants.map((p) => (
        <RailChip
          key={p.id}
          participant={p}
          state={state}
          leading={active && bid?.participantId === p.id}
        />
      ))}
    </footer>
  );
}

function RailChip({
  participant,
  state,
  leading,
}: {
  participant: Participant;
  state: RoomState;
  leading: boolean;
}) {
  return (
    <div
      className={`flex shrink-0 items-baseline gap-2 rounded-lg px-3 py-1.5 ${
        leading ? 'bg-gold text-pitch-950' : 'bg-pitch-800'
      }`}
    >
      <span
        className={`self-center h-2 w-2 rounded-full ${
          participant.connected ? (leading ? 'bg-pitch-950' : 'bg-role-d') : 'bg-chalk-faint'
        }`}
      />
      <span className={`max-w-[12rem] truncate font-display text-xl font-semibold ${leading ? '' : 'text-chalk'}`}>
        {participant.name}
      </span>
      <span className={`tabular font-display text-xl font-bold ${leading ? '' : 'text-gold'}`}>
        {budgetRemaining(participant, state.config)}
      </span>
    </div>
  );
}
