import { Fragment, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ROLES,
  budgetRemaining,
  rosterTarget,
  spent,
  totalSlots,
  type Participant,
  type Player,
  type Role,
  type RoomConfig,
  type RoomState,
} from '@fanta/shared';
import { useStore } from '../store';
import { errorText, useT } from '../i18n';
import { actions, joinRoom, leaveRoom } from '../lib/socket';
import { addPlayer, ApiError, loadPlayers, uploadListone } from '../lib/api';
import { downloadTabellone } from '../lib/tabellone';
import { persist } from '../lib/persist';
import { useRoomGuard } from '../lib/useRoomGuard';
import { auctionTimerMs } from '../lib/useCountdown';
import { buzzerUrl, currentBid, currentCallerId, normalize, participantName } from '../lib/format';
import { flexSlotsError } from '../components/AuctionConfigForm';
import { AssignmentsPanel } from '../components/AssignmentsPanel';
import { CountdownRing } from '../components/CountdownRing';
import { LangSwitcher } from '../components/LangSwitcher';
import { PlayerImg } from '../components/PlayerImg';
import { PlayerSheet } from '../components/PlayerSheet';
import { RoleBadge, ROLE_STYLES } from '../components/RoleBadge';
import { RoomMissing } from '../components/RoomMissing';

const btnGhost =
  'rounded-lg border chalk-line px-3 py-1.5 text-sm font-semibold text-chalk-dim hover:bg-pitch-700 hover:text-chalk transition';
const inputCls =
  'rounded-lg border chalk-line bg-pitch-900 px-3 py-2 text-chalk placeholder:text-chalk-faint';

export default function Admin() {
  const { code = '' } = useParams();
  const guard = useRoomGuard(code);
  const state = useStore((s) => s.state);
  const joinError = useStore((s) => s.joinError);
  const { t } = useT();
  const token = persist.getAdminToken(code);

  useEffect(() => {
    void loadPlayers(code);
    return () => leaveRoom();
  }, [code]);

  useEffect(() => {
    if (guard.status === 'ok' && token) {
      joinRoom({ code, as: 'admin', adminToken: token });
    }
  }, [guard.status, code, token]);

  if (guard.status === 'checking') return <Center>{t('admin.searching')}</Center>;
  if (guard.status === 'missing') return <RoomMissing code={code} />;
  if (!token)
    return (
      <Center>
        <div className="text-center">
          <p className="mb-2 font-display text-4xl font-bold uppercase text-danger">
            {t('admin.noTokenTitle')}
          </p>
          <p className="mb-6 max-w-sm text-chalk-dim">
            {t('admin.noTokenText', { code: code.toUpperCase() })}
          </p>
          <Link to="/" className={btnGhost}>
            {t('admin.backHome')}
          </Link>
        </div>
      </Center>
    );
  if (joinError)
    return (
      <Center>
        <div className="text-center">
          <p className="mb-2 font-display text-4xl font-bold uppercase text-danger">
            {t('admin.joinErrTitle')}
          </p>
          <p className="text-chalk-dim">{joinError}</p>
        </div>
      </Center>
    );
  if (!state) return <Center>{t('admin.connecting')}</Center>;
  return <AdminLive state={state} />;
}

function Center({ children }: { children: ReactNode }) {
  return (
    <div className="theme-buzz buzz-bg flex min-h-dvh items-center justify-center px-6 text-chalk-dim">
      {children}
    </div>
  );
}

function AdminLive({ state }: { state: RoomState }) {
  const connection = useStore((s) => s.connection);
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const locked = state.participants.some((p) => p.roster.length > 0);

  function copyLink() {
    navigator.clipboard
      ?.writeText(buzzerUrl(state.code))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <div className="theme-buzz buzz-bg min-h-dvh">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-6 gap-y-2 bg-pitch-950/90 px-6 py-3 shadow-md backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              connection === 'connected' ? 'bg-role-d' : 'bg-danger animate-pulse-danger'
            }`}
          />
          <h1 className="font-display text-2xl font-bold uppercase text-chalk">
            {state.config.leagueName}
          </h1>
          <span className="text-xs uppercase tracking-widest text-chalk-faint">
            {t('admin.roleLabel')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-display text-5xl font-bold uppercase tracking-[0.3em] text-gold">
            {state.code}
          </span>
          <LangSwitcher compact />
          <button type="button" onClick={copyLink} className={btnGhost}>
            {copied ? t('admin.copied') : t('admin.copyLink')}
          </button>
          <Link to={`/tablero/${state.code}`} target="_blank" className={btnGhost}>
            {t('admin.openBoard')}
          </Link>
          <Link
            to={`/sala/${state.code}`}
            target="_blank"
            rel="noopener"
            title={t('admin.myBuzzerTip')}
            className="rounded-lg border-2 border-gold/70 px-3 py-1.5 text-sm font-bold uppercase text-gold transition hover:bg-gold/10"
          >
            {t('admin.myBuzzer')}
          </Link>
          <a href={`/api/rooms/${state.code}/export/rose.csv`} download className={btnGhost}>
            {t('admin.exportCsv')}
          </a>
          <a href={`/api/rooms/${state.code}/export/rose.xlsx`} download className={btnGhost}>
            {t('admin.exportXlsx')}
          </a>
          <TabelloneButton state={state} />
          {state.finishedAt === null && <FinishButton state={state} />}
        </div>
      </header>

      <main className="mx-auto grid max-w-[110rem] gap-6 px-6 py-6 lg:grid-cols-[minmax(24rem,2fr)_3fr]">
        <div className="min-w-0 space-y-6">
          {state.config.callMode === 'turns' && state.finishedAt === null && (
            <TurnPanel state={state} />
          )}
          <Listone state={state} />
          <Richiama state={state} />
          {!locked && <ListoneUpload state={state} />}
        </div>
        <div className="min-w-0 space-y-6">
          {state.finishedAt !== null ? (
            <section className="rounded-2xl border-2 border-gold/50 bg-pitch-950/80 px-6 py-5">
              <p className="font-display text-3xl font-bold uppercase text-gold">
                {t('admin.finishedTitle')}
              </p>
              <p className="mt-1 text-sm text-chalk-dim">{t('admin.finishedText')}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a
                  href={`/api/rooms/${state.code}/export/rose.csv`}
                  download
                  className="rounded-xl bg-gold px-5 py-2.5 font-display text-xl font-bold uppercase text-pitch-950"
                >
                  {t('admin.exportCsv')}
                </a>
                <a
                  href={`/api/rooms/${state.code}/export/rose.xlsx`}
                  download
                  className="rounded-xl border-2 border-gold/70 px-5 py-2.5 font-display text-xl font-bold uppercase text-gold"
                >
                  {t('admin.exportXlsx')}
                </a>
                <TabelloneButton state={state} big />
              </div>
            </section>
          ) : (
            <AuctionPanel state={state} />
          )}
          <AssignmentsPanel />
          <ParticipantsPanel state={state} />
          <ConfigPanel state={state} locked={locked} />
        </div>
      </main>
    </div>
  );
}

/** Tabellone final como PNG, renderizado client-side. */
function TabelloneButton({ state, big = false }: { state: RoomState; big?: boolean }) {
  const players = useStore((s) => s.players);
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={() => downloadTabellone(state, players)}
      disabled={state.participants.length === 0}
      className={
        big
          ? 'rounded-xl border-2 border-gold/70 px-5 py-2.5 font-display text-xl font-bold uppercase text-gold disabled:opacity-40'
          : `${btnGhost} disabled:opacity-40`
      }
    >
      {t('admin.exportPng')}
    </button>
  );
}

/** Terminar el asta requiere doble click: es el cierre definitivo. */
function FinishButton({ state }: { state: RoomState }) {
  const { t } = useT();
  const [arm, setArm] = useState(false);
  const busy = state.auction.phase === 'called' || state.auction.phase === 'bidding';
  useEffect(() => {
    if (!arm) return;
    const timer = setTimeout(() => setArm(false), 3000);
    return () => clearTimeout(timer);
  }, [arm]);
  return (
    <button
      type="button"
      disabled={busy}
      title={busy ? t('admin.finishBusyTip') : t('admin.finishTip')}
      onClick={() => {
        if (!arm) {
          setArm(true);
          return;
        }
        actions.finish();
        setArm(false);
      }}
      className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition disabled:opacity-40 ${
        arm
          ? 'border-danger bg-danger/15 text-danger'
          : 'border-danger/40 text-danger/80 hover:bg-danger/10'
      }`}
    >
      {arm ? t('admin.finishConfirm') : t('admin.finish')}
    </button>
  );
}

/* ————— ronda de turnos ————— */

function TurnPanel({ state }: { state: RoomState }) {
  const { t } = useT();
  const caller = currentCallerId(state);
  return (
    <section className="rounded-2xl border chalk-line bg-pitch-950/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold uppercase text-chalk">
            {t('admin.turnRound')}
          </h2>
          {caller ? (
            <p className="mt-1 text-sm text-chalk-dim">
              {t('admin.turnCalls')}{' '}
              <span className="font-semibold text-gold">{participantName(state, caller)}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-chalk-dim">{t('admin.turnNotDrawn')}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => actions.drawOrder()}
            className="rounded-lg bg-gold px-4 py-2 font-display text-lg font-bold uppercase text-pitch-950"
          >
            {state.callOrder.length === 0 ? t('admin.drawOrder') : t('admin.redraw')}
          </button>
          <button
            type="button"
            onClick={() => actions.skipTurn()}
            disabled={caller === null}
            className={btnGhost + ' disabled:opacity-40'}
          >
            {t('admin.skipTurn')}
          </button>
        </div>
      </div>
      {state.callOrder.length > 0 && (
        <ol className="mt-3 flex flex-wrap gap-2">
          {state.callOrder.map((id, i) => (
            <li
              key={id}
              className={`rounded-lg px-2.5 py-1 text-sm ${
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
    </section>
  );
}

/* ————— listone ————— */

function soldPlayerIds(state: RoomState): Set<number> {
  return new Set(state.participants.flatMap((p) => p.roster.map((e) => e.playerId)));
}

function Listone({ state }: { state: RoomState }) {
  const players = useStore((s) => s.players);
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const [team, setTeam] = useState('');
  const [sort, setSort] = useState<'quotazione' | 'name' | 'role'>('quotazione');
  const [letter, setLetter] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<Player | null>(null);
  const [sheet, setSheet] = useState<Player | null>(null);

  const sold = useMemo(() => soldPlayerIds(state), [state]);
  const inAuction =
    state.auction.phase === 'called' || state.auction.phase === 'bidding'
      ? state.auction.playerId
      : null;

  const teams = useMemo(
    () => [...new Set([...players.values()].map((p) => p.team))].sort((a, b) => a.localeCompare(b)),
    [players],
  );

  const list = useMemo(() => {
    const q = normalize(query.trim());
    const out = [...players.values()].filter(
      (p) =>
        !sold.has(p.id) &&
        p.id !== inAuction &&
        (!role || p.role === role) &&
        (!team || p.team === team) &&
        (!letter || normalize(p.name).startsWith(letter)) &&
        (!q || normalize(p.name).includes(q) || normalize(p.team).includes(q)),
    );
    out.sort((a, b) => {
      // "Ruolo": desde el arco — P → D → C → A; adentro por quotazione desc.
      if (sort === 'role') {
        const d = ROLES.indexOf(a.role) - ROLES.indexOf(b.role);
        if (d !== 0) return d;
        return b.quotazione - a.quotazione || a.name.localeCompare(b.name);
      }
      return sort === 'name' ? a.name.localeCompare(b.name) : b.quotazione - a.quotazione;
    });
    return out;
  }, [players, sold, inAuction, query, role, team, letter, sort]);

  function callRandom() {
    const pick = list[Math.floor(Math.random() * list.length)];
    if (pick) setCandidate(pick);
  }

  const busy = inAuction !== null;

  return (
    <section className="rounded-2xl border chalk-line bg-pitch-950/70 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-bold uppercase text-chalk">
          {t('admin.listone')}
        </h2>
        <button
          type="button"
          onClick={callRandom}
          disabled={busy || list.length === 0}
          className="rounded-lg border-2 border-gold/70 px-4 py-1.5 font-display text-lg font-bold uppercase text-gold hover:bg-gold/10 disabled:opacity-40"
        >
          {t('admin.callRandom')}
          {role ? ` (${role})` : ''}
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.searchPh')}
          className={`${inputCls} w-full sm:w-56`}
        />
        <div className="flex gap-1">
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(role === r ? null : r)}
              aria-pressed={role === r}
              className={`h-9 w-9 rounded-lg font-display text-lg font-bold transition ${
                role === r
                  ? ROLE_STYLES[r].badge
                  : `border chalk-line ${ROLE_STYLES[r].text} hover:bg-pitch-700`
              }`}
              title={t(`role.${r}`)}
            >
              {r}
            </button>
          ))}
        </div>
        <select value={team} onChange={(e) => setTeam(e.target.value)} className={inputCls}>
          <option value="">{t('admin.allTeams')}</option>
          {teams.map((tm) => (
            <option key={tm} value={tm}>
              {tm}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as 'quotazione' | 'name' | 'role')}
          className={inputCls}
        >
          <option value="quotazione">{t('admin.byQuota')}</option>
          <option value="name">{t('admin.byName')}</option>
          <option value="role">{t('admin.byRole')}</option>
        </select>
      </div>

      {/* salto a letra */}
      <div className="mb-3 flex flex-wrap gap-0.5">
        {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => {
          const active = letter === l.toLowerCase();
          return (
            <button
              key={l}
              type="button"
              onClick={() => setLetter(active ? null : l.toLowerCase())}
              aria-pressed={active}
              className={`h-7 w-7 rounded text-xs font-bold ${
                active ? 'bg-gold text-pitch-950' : 'text-chalk-dim hover:bg-pitch-700 hover:text-chalk'
              }`}
            >
              {l}
            </button>
          );
        })}
      </div>

      {candidate && (
        <CallConfirm
          player={candidate}
          disabled={busy}
          isRichiama={state.unsoldPlayerIds.includes(candidate.id)}
          onCall={() => {
            actions.call(candidate.id);
            setCandidate(null);
          }}
          onSheet={() => setSheet(candidate)}
          onDismiss={() => setCandidate(null)}
        />
      )}
      {sheet && <PlayerSheet player={sheet} onClose={() => setSheet(null)} />}

      <ul className="max-h-[26rem] divide-y divide-chalk/5 overflow-y-auto">
        {list.slice(0, 100).map((p, i, arr) => (
          <Fragment key={p.id}>
          {sort === 'role' && arr[i - 1]?.role !== p.role && (
            <li className="flex items-center gap-2 pb-1 pt-3">
              <RoleBadge role={p.role} size="sm" />
              <span className={`text-[11px] font-semibold uppercase tracking-widest ${ROLE_STYLES[p.role].text}`}>
                {t(`role.${p.role}`)}
              </span>
            </li>
          )}
          <li className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCandidate(p)}
              className="flex min-w-0 flex-1 items-center gap-3 px-1 py-2 text-left hover:bg-pitch-700/50"
            >
              <RoleBadge role={p.role} size="sm" />
              <span className="min-w-0 flex-1 truncate text-chalk">
                {p.name}
                <span className="ml-2 text-xs text-chalk-faint">{p.team}</span>
                {state.unsoldPlayerIds.includes(p.id) && (
                  <span className="ml-2 rounded bg-role-p/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-role-p">
                    {t('admin.richiamaTag')}
                  </span>
                )}
              </span>
              <span className="tabular font-display text-lg font-bold text-chalk-dim">
                {p.quotazione}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSheet(p)}
              aria-label={t('admin.fichaOf', { name: p.name })}
              title={t('admin.seeFicha')}
              className="shrink-0 rounded px-1.5 py-1 text-xs font-bold text-gold hover:bg-pitch-700/60"
            >
              {t('admin.ficha')}
            </button>
          </li>
          </Fragment>
        ))}
        {list.length === 0 && (
          <li className="py-6 text-center text-sm text-chalk-faint">{t('admin.noPlayers')}</li>
        )}
        {list.length > 100 && (
          <li className="py-2 text-center text-xs text-chalk-faint">
            {t('admin.morePlayers', { n: list.length - 100 })}
          </li>
        )}
      </ul>

      <AddPlayerForm code={state.code} teams={teams} />
    </section>
  );
}

/** Alta manual de un jugador que falta en el listone. A diferencia del CSV,
 *  disponible SIEMPRE (aún con compras o subasta activa): es el "uy, falta uno". */
function AddPlayerForm({ code, teams }: { code: string; teams: string[] }) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [team, setTeam] = useState('');
  const [role, setRole] = useState<Role>('P');
  const [quota, setQuota] = useState('1');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // El toast de éxito se va solo; los errores quedan hasta el próximo intento.
  useEffect(() => {
    if (status?.kind !== 'ok') return;
    const timer = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(timer);
  }, [status]);

  const valid = name.trim().length > 0 && team.trim().length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    const token = persist.getAdminToken(code);
    if (!token) {
      setStatus({ kind: 'error', text: t('admin.listoneNoToken') });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await addPlayer(code, token, {
        name: name.trim(),
        team: team.trim(),
        role,
        quotazione: Math.max(1, Math.floor(Number(quota)) || 1),
      });
      // El listone se recarga solo vía el RoomEvent 'listone_loaded'.
      setStatus({ kind: 'ok', text: t('admin.addOk') });
      setName('');
      setQuota('1');
    } catch (err) {
      const text =
        err instanceof ApiError && err.code
          ? errorText(t, { code: err.code, message: err.message })
          : err instanceof Error && err.message
            ? err.message
            : t('admin.addErr');
      setStatus({ kind: 'error', text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-3 rounded-lg border chalk-line px-3 py-2">
      <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-widest text-chalk-dim hover:text-chalk [&::-webkit-details-marker]:hidden">
        {t('admin.addPlayer')}
      </summary>
      <p className="mt-1 text-xs text-chalk-faint">{t('admin.addPlayerText')}</p>
      <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2">
        <label className="block min-w-36 flex-1">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
            {t('admin.addName')}
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            className={`${inputCls} w-full py-1.5`}
          />
        </label>
        <label className="block min-w-32">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
            {t('admin.addTeam')}
          </span>
          <input
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            list="add-player-teams"
            maxLength={40}
            className={`${inputCls} w-full py-1.5`}
          />
          <datalist id="add-player-teams">
            {teams.map((tm) => (
              <option key={tm} value={tm} />
            ))}
          </datalist>
        </label>
        <div>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
            {t('admin.addRole')}
          </span>
          <div className="flex gap-1">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                aria-pressed={role === r}
                title={t(`role.${r}`)}
                className={`h-9 w-9 rounded-lg font-display text-lg font-bold transition ${
                  role === r
                    ? ROLE_STYLES[r].badge
                    : `border chalk-line ${ROLE_STYLES[r].text} hover:bg-pitch-700`
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
            {t('admin.addQuota')}
          </span>
          <input
            type="number"
            min={1}
            value={quota}
            onChange={(e) => setQuota(e.target.value)}
            className={`${inputCls} tabular w-20 py-1.5`}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !valid}
          className="rounded-lg bg-gold px-4 py-2 font-display text-lg font-bold uppercase text-pitch-950 disabled:opacity-40"
        >
          {busy ? t('admin.addBusy') : t('admin.addSubmit')}
        </button>
      </form>
      {status && (
        <p
          role="status"
          className={`mt-2 text-sm font-semibold ${status.kind === 'ok' ? 'text-success' : 'text-danger'}`}
        >
          {status.text}
        </p>
      )}
    </details>
  );
}

function CallConfirm({
  player,
  disabled,
  isRichiama,
  onCall,
  onSheet,
  onDismiss,
}: {
  player: Player;
  disabled: boolean;
  isRichiama: boolean;
  onCall: () => void;
  onSheet: () => void;
  onDismiss: () => void;
}) {
  const { t } = useT();
  return (
    <div className="animate-rise mb-3 flex items-center gap-4 rounded-xl border-2 border-gold/50 bg-pitch-900 p-4">
      <PlayerImg player={player} className="w-16 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-2xl font-bold uppercase text-chalk">{player.name}</p>
        <p className="text-sm text-chalk-dim">
          {player.team} · {t(`role.${player.role}`)} · {t('buzzer.quot')}{' '}
          <span className="tabular">{player.quotazione}</span>
          {isRichiama && (
            <span className="ml-2 font-semibold text-role-p">{t('admin.richiamaTag')}</span>
          )}
        </p>
        {disabled && <p className="mt-1 text-xs text-danger">{t('admin.auctionBusy')}</p>}
        <button
          type="button"
          onClick={onSheet}
          className="mt-1 text-xs font-semibold uppercase tracking-wider text-gold underline decoration-dotted"
        >
          {t('admin.seeFicha')}
        </button>
      </div>
      <button
        type="button"
        onClick={onCall}
        disabled={disabled}
        className="rounded-xl bg-gold px-6 py-3 font-display text-xl font-bold uppercase text-pitch-950 disabled:opacity-40"
      >
        {t('admin.call')}
      </button>
      <button type="button" onClick={onDismiss} aria-label={t('admin.dismiss')} className={btnGhost}>
        ✕
      </button>
    </div>
  );
}

/** Listone propio de la sala: el admin sube un CSV y todas las vistas pasan a usarlo.
 *  Solo disponible mientras no haya compras. */
function ListoneUpload({ state }: { state: RoomState }) {
  const { t } = useT();
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const token = persist.getAdminToken(state.code);
    if (!token) {
      setStatus({ kind: 'error', text: t('admin.listoneNoToken') });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const csv = await file.text();
      const { count } = await uploadListone(state.code, token, csv);
      setStatus({ kind: 'ok', text: t('admin.listoneLoaded', { n: count }) });
      await loadPlayers(state.code, true);
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof Error ? err.message : t('admin.listoneErr'),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border chalk-line bg-pitch-950/70 p-5">
      <h2 className="font-display text-2xl font-bold uppercase text-chalk">
        {t('admin.listoneOwn')}
      </h2>
      <p className="mb-3 mt-1 text-xs text-chalk-dim">{t('admin.listoneOwnText')}</p>
      <label
        className={`inline-block cursor-pointer rounded-lg border-2 border-gold/70 px-4 py-2 font-display text-lg font-bold uppercase text-gold hover:bg-gold/10 ${busy ? 'opacity-50' : ''}`}
      >
        {busy ? t('admin.listoneUploading') : t('admin.listonePick')}
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          disabled={busy}
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
          className="hidden"
        />
      </label>
      {status && (
        <p
          role="status"
          className={`mt-2 text-sm font-semibold ${status.kind === 'ok' ? 'text-success' : 'text-danger'}`}
        >
          {status.text}
        </p>
      )}
    </section>
  );
}

/* ————— richiama ————— */

function Richiama({ state }: { state: RoomState }) {
  const players = useStore((s) => s.players);
  const { t } = useT();
  const sold = useMemo(() => soldPlayerIds(state), [state]);
  const list = state.unsoldPlayerIds.filter((id) => !sold.has(id));
  if (list.length === 0) return null;
  const busy = state.auction.phase === 'called' || state.auction.phase === 'bidding';
  return (
    <section className="rounded-2xl border chalk-line bg-pitch-950/70 p-5">
      <h2 className="mb-1 font-display text-2xl font-bold uppercase text-chalk">
        {t('admin.richiama')}
      </h2>
      <p className="mb-3 text-xs text-chalk-dim">{t('admin.richiamaText')}</p>
      <ul className="flex flex-wrap gap-2">
        {list.map((id) => {
          const p = players.get(id);
          if (!p) return null;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => actions.call(id)}
                disabled={busy}
                className="flex items-center gap-2 rounded-lg border chalk-line px-3 py-1.5 text-sm text-chalk hover:bg-pitch-700 disabled:opacity-40"
              >
                <RoleBadge role={p.role} size="sm" />
                {p.name}
                <span className="tabular text-chalk-faint">{p.quotazione}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ————— subasta en curso ————— */

function AuctionPanel({ state }: { state: RoomState }) {
  const players = useStore((s) => s.players);
  const eventSeq = useStore((s) => s.eventSeq);
  const { t } = useT();
  const phase = state.auction.phase;
  const player = state.auction.playerId !== null ? players.get(state.auction.playerId) : undefined;
  const bid = currentBid(state);

  if (phase === 'idle' || !player) {
    return (
      <section className="flex items-center justify-between rounded-2xl border chalk-line bg-pitch-950/70 px-6 py-5">
        <p className="font-display text-2xl font-bold uppercase text-chalk-dim">
          {t('admin.noAuction')}
        </p>
        <p className="text-sm text-chalk-faint">{t('admin.noAuctionText')}</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border-2 border-gold/40 bg-pitch-950/80 p-6">
      <div className="flex flex-wrap items-start gap-6">
        <PlayerImg player={player} className="w-28 shrink-0" />
        <div className="min-w-0 flex-1">
          <RoleBadge role={player.role} size="sm" full />
          <h2 className="mt-1 font-display text-4xl font-bold uppercase leading-none text-chalk">
            {player.name}
          </h2>
          <p className="mt-1 text-sm text-chalk-dim">
            {player.team} · {t('buzzer.quot')} <span className="tabular">{player.quotazione}</span>
          </p>
          <div className="mt-3 flex items-baseline gap-3">
            {phase === 'sold' ? (
              <p className="animate-sold font-display text-3xl font-bold uppercase text-gold">
                {t('admin.soldTo', { name: participantName(state, state.auction.winnerId) })}{' '}
                <span className="tabular">{bid?.amount ?? 0}</span>
              </p>
            ) : phase === 'unsold' ? (
              <p className="font-display text-3xl font-bold uppercase text-chalk-dim">
                {t('admin.unsold')}
              </p>
            ) : bid ? (
              <>
                <span key={eventSeq} className="tabular animate-bid-pop font-display text-6xl font-bold leading-none text-gold">
                  {bid.amount}
                </span>
                <span className="truncate font-display text-2xl font-semibold text-chalk">
                  {participantName(state, bid.participantId)}
                </span>
              </>
            ) : (
              <span className="font-display text-2xl font-semibold uppercase text-chalk-faint">
                {t('admin.noBids')}
              </span>
            )}
          </div>
        </div>
        <CountdownRing
          deadline={phase === 'sold' || phase === 'unsold' ? null : state.auction.deadline}
          durationMs={auctionTimerMs(state)}
          pausedMs={phase === 'sold' || phase === 'unsold' ? null : state.auction.pausedRemainingMs}
          className="h-32 w-32 shrink-0"
          accent
        />
      </div>

      {(phase === 'called' || phase === 'bidding') && (
        <div className="mt-4 flex flex-wrap gap-3 border-t chalk-line pt-4">
          <button
            type="button"
            onClick={() => actions.close()}
            className="rounded-xl bg-gold px-5 py-2.5 font-display text-xl font-bold uppercase text-pitch-950"
          >
            {bid ? t('admin.closeAward') : t('admin.closeDesert')}
          </button>
          {state.auction.pausedRemainingMs === null ? (
            <button
              type="button"
              onClick={() => actions.pause()}
              className="rounded-xl border-2 border-chalk/40 px-5 py-2.5 font-display text-xl font-bold uppercase text-chalk hover:bg-pitch-700"
            >
              {t('admin.pause')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => actions.resume()}
              className="rounded-xl border-2 border-gold px-5 py-2.5 font-display text-xl font-bold uppercase text-gold hover:bg-gold/10"
            >
              {t('admin.resume')}
            </button>
          )}
          <button
            type="button"
            onClick={() => actions.cancel()}
            className="rounded-xl border-2 border-danger/60 px-5 py-2.5 font-display text-xl font-bold uppercase text-danger hover:bg-danger/10"
          >
            {t('admin.cancel')}
          </button>
        </div>
      )}

      {state.auction.pausedRemainingMs !== null &&
        (phase === 'called' || phase === 'bidding') && (
          <p className="mt-3 rounded-lg bg-gold/10 px-3 py-2 text-sm font-semibold text-gold">
            {t('admin.pausedNote')}
          </p>
        )}

      {state.config.auctionMode === 'premi_parla' &&
        (phase === 'called' || phase === 'bidding') &&
        bid && <SpokenBid key={`${player.id}-${bid.participantId}`} state={state} />}

      {(phase === 'called' || phase === 'bidding') && (
        <DirectAward key={player.id} state={state} player={player} />
      )}

      {state.auction.bids.length > 0 && (
        <div className="mt-4 border-t chalk-line pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-chalk-dim">
            {t('admin.bidHistory')}
          </p>
          <ul className="max-h-36 space-y-1 overflow-y-auto">
            {[...state.auction.bids].reverse().map((b, i) => (
              <li key={`${b.at}-${b.participantId}`} className="flex items-baseline gap-3 text-sm">
                <span className={`tabular font-display text-lg font-bold ${i === 0 ? 'text-gold' : 'text-chalk-dim'}`}>
                  {b.amount}
                </span>
                <span className={i === 0 ? 'text-chalk' : 'text-chalk-dim'}>
                  {participantName(state, b.participantId)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Premi&Parla: quien tiene la palabra cantó su oferta de viva voz; el banditore fija el monto. */
function SpokenBid({ state }: { state: RoomState }) {
  const { t } = useT();
  const bid = currentBid(state);
  const [value, setValue] = useState('');
  if (!bid) return null;
  const amount = Math.floor(Number(value)) || 0;

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border-2 border-gold/50 bg-pitch-900 p-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (amount <= 0) return;
        actions.setBid(amount);
        setValue('');
      }}
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-widest text-gold">
          {t('admin.wordLabel')}
        </p>
        <p className="truncate font-display text-2xl font-bold text-chalk">
          {participantName(state, bid.participantId)}
        </p>
        <p className="tabular text-xs text-chalk-dim">
          {t('admin.wordReserve')} <span className="font-semibold text-gold">{bid.amount}</span>
        </p>
      </div>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
          {t('admin.wordAmount')}
        </span>
        <input
          type="number"
          min={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={String(bid.amount)}
          className={`${inputCls} tabular w-32 py-2 font-display text-2xl font-bold`}
        />
      </label>
      <button
        type="submit"
        disabled={amount <= 0}
        className="rounded-xl bg-gold px-6 py-2.5 font-display text-xl font-bold uppercase text-pitch-950 disabled:opacity-40"
      >
        {t('admin.wordSet')}
      </button>
    </form>
  );
}

/** Adjudicación directa: nadie más va a ofertar (o se arregló de palabra) y no se quiere
 *  esperar el countdown. Emite auction:cancel + admin:assign, en ese orden. */
function DirectAward({ state, player }: { state: RoomState; player: Player }) {
  const { t } = useT();
  const bid = currentBid(state);
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');
  const [price, setPrice] = useState('');
  const [confirming, setConfirming] = useState(false);

  function openForm() {
    setWho(bid?.participantId ?? state.participants[0]?.id ?? '');
    setPrice(String(bid?.amount ?? 1));
    setConfirming(false);
    setOpen(true);
  }

  const priceNum = Math.max(0, Math.floor(Number(price)) || 0);
  const target = state.participants.find((x) => x.id === who);

  function award() {
    if (!target) return;
    actions.cancel();
    actions.assign(player.id, target.id, priceNum);
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openForm}
        disabled={state.participants.length === 0}
        className="mt-3 text-sm font-semibold uppercase tracking-wider text-chalk-dim underline decoration-dotted hover:text-chalk disabled:opacity-40"
      >
        {t('admin.directAward')}
      </button>
    );
  }

  return (
    <div className="animate-rise mt-3 rounded-xl border-2 border-role-p/60 bg-pitch-900 p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-role-p">
        {t('admin.directTitle')}
      </p>
      {confirming && target ? (
        <>
          <p className="mt-2 text-sm text-chalk">
            {t('admin.directConfirm', { player: player.name, name: target.name, n: priceNum })}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={award}
              className="rounded-lg bg-role-p px-4 py-1.5 font-display text-lg font-bold uppercase text-pitch-950"
            >
              {t('admin.confirm')}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={btnGhost}>
              {t('admin.back')}
            </button>
          </div>
        </>
      ) : (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (target) setConfirming(true);
          }}
        >
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
              {t('admin.directParticipant')}
            </span>
            <select
              value={who}
              onChange={(e) => setWho(e.target.value)}
              className={`${inputCls} py-1.5`}
            >
              {state.participants.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
              {t('admin.directCredits')}
            </span>
            <input
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={`${inputCls} tabular w-24 py-1.5`}
            />
          </label>
          <button
            type="submit"
            disabled={!target}
            className="rounded-lg bg-gold px-4 py-2 font-display text-lg font-bold uppercase text-pitch-950 disabled:opacity-40"
          >
            {t('admin.directSubmit')}
          </button>
          <button type="button" onClick={() => setOpen(false)} className={btnGhost}>
            {t('admin.cancelBtn')}
          </button>
        </form>
      )}
    </div>
  );
}

/* ————— participantes + ajustes manuales ————— */

/** Ajuste pendiente de confirmación (operaciones sensibles: el server no valida reglas). */
type Adjust =
  | { kind: 'assign'; playerId: number; participantId: string; price: number; label: string }
  | { kind: 'unassign'; playerId: number; label: string }
  /** Devuelve los créditos y vuelve a llamar al jugador (unassign + call). */
  | { kind: 're_auction'; playerId: number; label: string }
  /** Bonus (+) o malus (−) de créditos (reglas caseras). */
  | { kind: 'budget'; participantId: string; delta: number; label: string };

function ParticipantsPanel({ state }: { state: RoomState }) {
  const { t } = useT();
  const [adjust, setAdjust] = useState<Adjust | null>(null);

  return (
    <section className="rounded-2xl border chalk-line bg-pitch-950/70 p-5">
      <h2 className="mb-1 font-display text-2xl font-bold uppercase text-chalk">
        {t('admin.participants', { n: state.participants.length })}
      </h2>
      <p className="mb-4 text-xs text-chalk-dim">{t('admin.participantsText')}</p>

      {adjust && <AdjustConfirm state={state} adjust={adjust} onDone={() => setAdjust(null)} />}

      {state.participants.length === 0 ? (
        <p className="py-4 text-center text-sm text-chalk-faint">
          {t('admin.nobodyYet', { code: state.code })}
        </p>
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {state.participants.map((p) => (
            <ParticipantCard key={p.id} participant={p} state={state} onAdjust={setAdjust} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ParticipantCard({
  participant: p,
  state,
  onAdjust,
}: {
  participant: Participant;
  state: RoomState;
  onAdjust: (a: Adjust) => void;
}) {
  const players = useStore((s) => s.players);
  const { t } = useT();
  const credits = budgetRemaining(p, state.config);
  const filled = p.roster.length;
  // Con cupos flexibles el total es rosterSize, no la suma de máximos.
  const total = rosterTarget(state.config);

  return (
    <li className="rounded-xl border chalk-line bg-pitch-900/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.connected ? 'bg-role-d' : 'bg-chalk-faint'}`} />
          <span className="truncate font-display text-xl font-semibold text-chalk">{p.name}</span>
        </div>
        <span className="flex items-center gap-1">
          <BudgetAdjust participant={p} state={state} onAdjust={onAdjust} />
          <button
            type="button"
            onClick={() => actions.kick(p.id)}
            disabled={p.roster.length > 0}
            title={p.roster.length > 0 ? t('admin.kickTip') : t('admin.kick')}
            className="rounded px-2 py-1 text-xs font-semibold uppercase text-danger/80 hover:bg-danger/10 disabled:opacity-30"
          >
            {t('admin.kick')}
          </button>
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-4">
        <span className={`tabular font-display text-3xl font-bold ${credits < 0 ? 'text-danger' : 'text-gold'}`}>
          {credits} <span className="text-sm font-semibold text-chalk-dim">cr</span>
        </span>
        {p.budgetBonus !== 0 && (
          <span
            className={`tabular text-xs font-semibold ${p.budgetBonus > 0 ? 'text-success' : 'text-danger'}`}
            title={t('admin.bonusTip')}
          >
            {state.config.budget} {p.budgetBonus > 0 ? '+' : '−'}
            {Math.abs(p.budgetBonus)}
          </span>
        )}
        <span className="tabular text-sm text-chalk-dim">
          {filled}/{total} {t('admin.slots')}
        </span>
        <span className="flex gap-1.5 text-xs">
          {ROLES.map((r) => {
            const have = p.roster.filter((e) => players.get(e.playerId)?.role === r).length;
            const full = have >= state.config.slots[r];
            return (
              <span key={r} className={`tabular ${full ? ROLE_STYLES[r].text : 'text-chalk-faint'}`}>
                {r}
                {have}/{state.config.slots[r]}
              </span>
            );
          })}
        </span>
      </div>
      {credits < 0 && (
        <p className="mt-1 text-xs font-semibold text-danger">{t('admin.negativeWarn')}</p>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-widest text-chalk-dim hover:text-chalk [&::-webkit-details-marker]:hidden">
          {t('admin.rosterToggle')}
        </summary>
        <RosterEditor participant={p} state={state} onAdjust={onAdjust} />
      </details>
    </li>
  );
}

/** Bonus/malus de créditos (reglas caseras): input delta con confirmación. */
function BudgetAdjust({
  participant: p,
  state,
  onAdjust,
}: {
  participant: Participant;
  state: RoomState;
  onAdjust: (a: Adjust) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  return open ? (
    <form
      className="flex items-center gap-1"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const delta = Math.trunc(Number(value));
        if (!Number.isFinite(delta) || delta === 0) return;
        onAdjust({
          kind: 'budget',
          participantId: p.id,
          delta,
          label: t('admin.budgetLabel', {
            sign: delta > 0 ? t('admin.bonusWord') : t('admin.malusWord'),
            delta: `${delta > 0 ? '+' : ''}${delta}`,
            name: p.name,
            left: budgetRemaining(p, state.config) + delta,
          }),
        });
        setOpen(false);
        setValue('');
      }}
    >
      <input
        type="number"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="±N"
        aria-label={t('admin.budgetAria', { name: p.name })}
        className={`${inputCls} tabular w-16 py-0.5 text-sm`}
      />
      <button type="submit" className="text-xs font-bold uppercase text-gold">
        {t('admin.okBtn')}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setValue('');
        }}
        className="text-xs text-chalk-faint"
      >
        ✕
      </button>
    </form>
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title={t('admin.budgetTip')}
      className="rounded px-2 py-1 text-xs font-semibold uppercase text-chalk-dim hover:bg-pitch-700 hover:text-chalk"
    >
      {t('admin.budgetBtn')}
    </button>
  );
}

function RosterEditor({
  participant: p,
  state,
  onAdjust,
}: {
  participant: Participant;
  state: RoomState;
  onAdjust: (a: Adjust) => void;
}) {
  const players = useStore((s) => s.players);
  const { t } = useT();
  const [priceEdit, setPriceEdit] = useState<{ playerId: number; value: string } | null>(null);
  const [moveEdit, setMoveEdit] = useState<number | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const auctionBusy = state.auction.phase === 'called' || state.auction.phase === 'bidding';

  return (
    <div className="mt-2 space-y-1 border-t chalk-line pt-2">
      {p.roster.length === 0 && <p className="text-xs text-chalk-faint">{t('admin.emptyRoster')}</p>}
      {p.roster.map((entry) => {
        const pl = players.get(entry.playerId);
        const playerLabel = pl?.name ?? `#${entry.playerId}`;
        return (
          <div key={entry.playerId} className="flex flex-wrap items-center gap-2 text-sm">
            {pl && <RoleBadge role={pl.role} size="sm" />}
            <span className="min-w-0 flex-1 truncate text-chalk">{playerLabel}</span>
            {priceEdit?.playerId === entry.playerId ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  const price = Math.max(0, Math.floor(Number(priceEdit.value)) || 0);
                  onAdjust({
                    kind: 'assign',
                    playerId: entry.playerId,
                    participantId: p.id,
                    price,
                    label: t('admin.adjPrice', { player: playerLabel, n: price, old: entry.price }),
                  });
                  setPriceEdit(null);
                }}
              >
                <input
                  type="number"
                  min={0}
                  autoFocus
                  value={priceEdit.value}
                  onChange={(e) => setPriceEdit({ playerId: entry.playerId, value: e.target.value })}
                  className={`${inputCls} tabular w-20 py-1 text-sm`}
                />
                <button type="submit" className="text-xs font-bold uppercase text-gold">
                  {t('admin.okBtn')}
                </button>
                <button type="button" onClick={() => setPriceEdit(null)} className="text-xs text-chalk-faint">
                  ✕
                </button>
              </form>
            ) : moveEdit === entry.playerId ? (
              <span className="flex items-center gap-1">
                <select
                  autoFocus
                  defaultValue=""
                  onChange={(e) => {
                    const target = e.target.value;
                    if (!target) return;
                    onAdjust({
                      kind: 'assign',
                      playerId: entry.playerId,
                      participantId: target,
                      price: entry.price,
                      label: t('admin.adjMove', {
                        player: playerLabel,
                        from: p.name,
                        to: participantName(state, target),
                        n: entry.price,
                      }),
                    });
                    setMoveEdit(null);
                  }}
                  className={`${inputCls} py-1 text-sm`}
                >
                  <option value="" disabled>
                    {t('admin.moveTo')}
                  </option>
                  {state.participants
                    .filter((x) => x.id !== p.id)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
                <button type="button" onClick={() => setMoveEdit(null)} className="text-xs text-chalk-faint">
                  ✕
                </button>
              </span>
            ) : (
              <>
                <span className="tabular font-display text-base font-bold text-gold">{entry.price}</span>
                <button
                  type="button"
                  onClick={() => setPriceEdit({ playerId: entry.playerId, value: String(entry.price) })}
                  className="text-xs text-chalk-dim underline decoration-dotted hover:text-chalk"
                >
                  {t('admin.priceBtn')}
                </button>
                <button
                  type="button"
                  onClick={() => setMoveEdit(entry.playerId)}
                  className="text-xs text-chalk-dim underline decoration-dotted hover:text-chalk"
                >
                  {t('admin.moveBtn')}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onAdjust({
                      kind: 'unassign',
                      playerId: entry.playerId,
                      label: t('admin.adjRemove', {
                        player: playerLabel,
                        name: p.name,
                        n: entry.price,
                      }),
                    })
                  }
                  className="text-xs text-danger/80 underline decoration-dotted hover:text-danger"
                >
                  {t('admin.removeBtn')}
                </button>
                <button
                  type="button"
                  disabled={auctionBusy}
                  title={auctionBusy ? t('admin.finishBusyTip') : t('admin.reauctionTip')}
                  onClick={() =>
                    onAdjust({
                      kind: 're_auction',
                      playerId: entry.playerId,
                      label: t('admin.adjReauction', {
                        player: playerLabel,
                        name: p.name,
                        n: entry.price,
                      }),
                    })
                  }
                  className="text-xs text-gold underline decoration-dotted hover:brightness-110 disabled:opacity-40"
                >
                  {t('admin.reauctionBtn')}
                </button>
              </>
            )}
          </div>
        );
      })}

      {assignOpen ? (
        <AssignPicker
          state={state}
          participant={p}
          onAdjust={(a) => {
            onAdjust(a);
            setAssignOpen(false);
          }}
          onClose={() => setAssignOpen(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAssignOpen(true)}
          className="mt-1 text-xs font-semibold uppercase tracking-wider text-chalk-dim underline decoration-dotted hover:text-chalk"
        >
          {t('admin.assignDirect')}
        </button>
      )}
    </div>
  );
}

/** Picker para asignar un jugador disponible directamente a un participante. */
function AssignPicker({
  state,
  participant,
  onAdjust,
  onClose,
}: {
  state: RoomState;
  participant: Participant;
  onAdjust: (a: Adjust) => void;
  onClose: () => void;
}) {
  const players = useStore((s) => s.players);
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [price, setPrice] = useState('1');
  const [picked, setPicked] = useState<Player | null>(null);
  const sold = useMemo(() => soldPlayerIds(state), [state]);

  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return [];
    return [...players.values()]
      .filter((pl) => !sold.has(pl.id) && normalize(pl.name).includes(q))
      .slice(0, 6);
  }, [players, sold, query]);

  return (
    <div className="mt-2 rounded-lg border chalk-line bg-pitch-950/60 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-chalk-dim">
          {t('admin.assignTo', { name: participant.name })}
        </p>
        <button type="button" onClick={onClose} aria-label={t('admin.close')} className="text-xs text-chalk-faint">
          ✕
        </button>
      </div>
      {picked ? (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const value = Math.max(0, Math.floor(Number(price)) || 0);
            onAdjust({
              kind: 'assign',
              playerId: picked.id,
              participantId: participant.id,
              price: value,
              label: t('admin.adjAssign', { player: picked.name, name: participant.name, n: value }),
            });
          }}
        >
          <RoleBadge role={picked.role} size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm text-chalk">{picked.name}</span>
          <input
            type="number"
            min={0}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={`${inputCls} tabular w-20 py-1 text-sm`}
            aria-label={t('admin.assignPrice')}
          />
          <button type="submit" className="rounded bg-gold px-3 py-1 font-display text-sm font-bold uppercase text-pitch-950">
            {t('admin.assignSubmit')}
          </button>
        </form>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('admin.assignSearchPh')}
            autoFocus
            className={`${inputCls} mt-2 w-full py-1.5 text-sm`}
          />
          <ul className="mt-1">
            {results.map((pl) => (
              <li key={pl.id}>
                <button
                  type="button"
                  onClick={() => setPicked(pl)}
                  className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm text-chalk hover:bg-pitch-700/60"
                >
                  <RoleBadge role={pl.role} size="sm" />
                  {pl.name}
                  <span className="text-xs text-chalk-faint">{pl.team}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Confirmación de ajuste manual, con advertencia si deja créditos negativos. */
function AdjustConfirm({
  state,
  adjust,
  onDone,
}: {
  state: RoomState;
  adjust: Adjust;
  onDone: () => void;
}) {
  const { t } = useT();
  const warning = useMemo(() => {
    if (adjust.kind === 'budget') {
      const target = state.participants.find((x) => x.id === adjust.participantId);
      if (!target) return null;
      const remaining = budgetRemaining(target, state.config) + adjust.delta;
      return remaining < 0 ? t('admin.adjustWarn', { name: target.name, n: remaining }) : null;
    }
    if (adjust.kind !== 'assign') return null;
    const target = state.participants.find((x) => x.id === adjust.participantId);
    if (!target) return null;
    const existing = target.roster.find((e) => e.playerId === adjust.playerId);
    const newSpent = spent(target) - (existing?.price ?? 0) + adjust.price;
    const remaining = state.config.budget + target.budgetBonus - newSpent;
    return remaining < 0 ? t('admin.adjustWarn', { name: target.name, n: remaining }) : null;
  }, [state, adjust, t]);

  function confirm() {
    if (adjust.kind === 'assign') {
      actions.assign(adjust.playerId, adjust.participantId, adjust.price);
    } else if (adjust.kind === 're_auction') {
      actions.unassign(adjust.playerId);
      actions.call(adjust.playerId);
    } else if (adjust.kind === 'budget') {
      actions.budget(adjust.participantId, adjust.delta);
    } else {
      actions.unassign(adjust.playerId);
    }
    onDone();
  }

  return (
    <div className="animate-rise mb-4 rounded-xl border-2 border-role-p/60 bg-pitch-900 p-4" role="alertdialog" aria-label={t('admin.adjustTitle')}>
      <p className="text-xs font-semibold uppercase tracking-widest text-role-p">
        {t('admin.adjustTitle')}
      </p>
      <p className="mt-1 text-sm text-chalk">{adjust.label}</p>
      <p className="mt-1 text-xs text-chalk-dim">{t('admin.adjustNote')}</p>
      {warning && <p className="mt-2 text-sm font-semibold text-danger">{warning}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={confirm}
          className="rounded-lg bg-role-p px-4 py-1.5 font-display text-lg font-bold uppercase text-pitch-950"
        >
          {t('admin.confirm')}
        </button>
        <button type="button" onClick={onDone} className={btnGhost}>
          {t('admin.cancelBtn')}
        </button>
      </div>
    </div>
  );
}

/* ————— config ————— */

function ConfigPanel({ state, locked }: { state: RoomState; locked: boolean }) {
  const { t } = useT();
  return (
    <section className="rounded-2xl border chalk-line bg-pitch-950/70 p-5">
      <h2 className="mb-1 font-display text-2xl font-bold uppercase text-chalk">
        {t('admin.configTitle')}
      </h2>
      {locked ? (
        <p className="text-xs text-chalk-dim">{t('admin.configLocked')}</p>
      ) : (
        <ConfigForm key={JSON.stringify(state.config)} config={state.config} />
      )}
    </section>
  );
}

function ConfigForm({ config }: { config: RoomConfig }) {
  const { t } = useT();
  const [draft, setDraft] = useState<RoomConfig>({ ...config, slots: { ...config.slots } });
  const [flexOn, setFlexOn] = useState(config.slotsMin !== undefined);
  const [slotsMin, setSlotsMin] = useState<Record<Role, number>>(
    config.slotsMin ? { ...config.slotsMin } : { ...config.slots },
  );
  const [rosterSize, setRosterSize] = useState(config.rosterSize ?? totalSlots(config));

  const flexError = flexOn ? flexSlotsError(t, draft.slots, slotsMin, rosterSize) : null;

  function payload(): Partial<RoomConfig> {
    const base: Partial<RoomConfig> = { ...draft };
    if (flexOn) {
      base.slotsMin = { ...slotsMin };
      base.rosterSize = rosterSize;
    } else if (config.slotsMin) {
      // La config parcial no puede "borrar" campos: min = max y total = suma equivalen a cupos fijos.
      base.slotsMin = { ...draft.slots };
      base.rosterSize = totalSlots(draft);
    } else {
      delete base.slotsMin;
      delete base.rosterSize;
    }
    return base;
  }

  const dirty = JSON.stringify(payload()) !== JSON.stringify(config);

  function field(label: string, value: number, onChange: (n: number) => void, min = 0) {
    return (
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
          {label}
        </span>
        <input
          type="number"
          min={min}
          value={value}
          onChange={(e) => onChange(Math.max(min, Math.floor(Number(e.target.value)) || 0))}
          className={`${inputCls} tabular w-full py-1.5`}
        />
      </label>
    );
  }

  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (flexError) return;
        actions.config(payload());
      }}
    >
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
          {t('cfg.leagueName')}
        </span>
        <input
          value={draft.leagueName}
          onChange={(e) => setDraft({ ...draft, leagueName: e.target.value })}
          maxLength={40}
          className={`${inputCls} w-full py-1.5`}
        />
      </label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {field(t('cfg.credits'), draft.budget, (n) => setDraft({ ...draft, budget: n }), 1)}
        {field(t('cfg.bidTimer'), draft.bidTimerSeconds, (n) => setDraft({ ...draft, bidTimerSeconds: n }), 2)}
        {field(t('cfg.callTimer'), draft.callTimerSeconds, (n) => setDraft({ ...draft, callTimerSeconds: n }))}
        {field(t('cfg.minIncrement'), draft.minIncrement, (n) => setDraft({ ...draft, minIncrement: n }), 1)}
      </div>
      <div className="grid grid-cols-4 gap-3">
        {ROLES.map((r) =>
          field(`${t('cfg.slotsByRole')} ${r}`, draft.slots[r], (n) =>
            setDraft({ ...draft, slots: { ...draft.slots, [r]: n } }),
          ),
        )}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
            {t('cfg.baseBid')}
          </span>
          <select
            value={draft.baseBidMode}
            onChange={(e) =>
              setDraft({ ...draft, baseBidMode: e.target.value as RoomConfig['baseBidMode'] })
            }
            className={`${inputCls} py-1.5`}
          >
            <option value="fixed">{t('cfg.baseFixed')}</option>
            <option value="quotazione">{t('cfg.baseQuota')}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
            {t('cfg.whoCalls')}
          </span>
          <select
            value={draft.callMode}
            onChange={(e) =>
              setDraft({ ...draft, callMode: e.target.value as RoomConfig['callMode'] })
            }
            className={`${inputCls} py-1.5`}
          >
            <option value="admin">{t('cfg.callAdmin')}</option>
            <option value="turns">{t('cfg.callTurns')}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
            {t('cfg.offerMode')}
          </span>
          <select
            value={draft.auctionMode}
            onChange={(e) =>
              setDraft({ ...draft, auctionMode: e.target.value as RoomConfig['auctionMode'] })
            }
            className={`${inputCls} py-1.5`}
          >
            <option value="uno">{t('cfg.modeUno')}</option>
            <option value="premi_parla">{t('cfg.modePremi')}</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-chalk">
          <input
            type="checkbox"
            checked={draft.hideValues}
            onChange={(e) => setDraft({ ...draft, hideValues: e.target.checked })}
            className="h-4 w-4 accent-gold"
          />
          {t('cfg.hideValuesLong')}
        </label>
      </div>
      <p className="text-xs text-chalk-faint">
        {draft.auctionMode === 'uno' ? t('cfg.modeUnoHint') : t('cfg.modePremiHint')}
      </p>

      <details className="rounded-lg border chalk-line px-3 py-2" open={flexOn}>
        <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-widest text-chalk-dim [&::-webkit-details-marker]:hidden">
          {t('cfg.flexTitle')}
        </summary>
        <label className="mt-2 flex items-center gap-2 text-sm text-chalk">
          <input
            type="checkbox"
            checked={flexOn}
            onChange={(e) => setFlexOn(e.target.checked)}
            className="h-4 w-4 accent-gold"
          />
          {t('cfg.flexToggle')}
        </label>
        {flexOn && (
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
              {t('cfg.flexMinLabel')}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {ROLES.map((role) => (
                <input
                  key={role}
                  type="number"
                  min={0}
                  value={slotsMin[role]}
                  onChange={(e) =>
                    setSlotsMin((s) => ({
                      ...s,
                      [role]: Math.max(0, Math.floor(Number(e.target.value)) || 0),
                    }))
                  }
                  aria-label={t('cfg.flexMinAria', { role: t(`role.${role}`) })}
                  className={`${inputCls} tabular py-1.5 text-center`}
                />
              ))}
            </div>
            <label className="mt-3 block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
                {t('cfg.flexTotal')}
              </span>
              <input
                type="number"
                min={1}
                value={rosterSize}
                onChange={(e) =>
                  setRosterSize(Math.max(1, Math.floor(Number(e.target.value)) || 0))
                }
                className={`${inputCls} tabular w-28 py-1.5`}
              />
            </label>
            {flexError && <p className="mt-2 text-xs font-semibold text-danger">{flexError}</p>}
          </div>
        )}
      </details>

      <button
        type="submit"
        disabled={!dirty || flexError !== null}
        className="rounded-lg bg-gold px-4 py-2 font-display text-lg font-bold uppercase text-pitch-950 disabled:opacity-40"
      >
        {t('admin.configSave')}
      </button>
    </form>
  );
}
