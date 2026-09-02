import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ROLES, type InviteInfo, type LeagueDetail, type RoomConfig } from '@fanta/shared';
import { useAuth } from '../authStore';
import { useT } from '../i18n';
import {
  createLeagueAuction,
  getLeague,
  getRoomRosters,
  sendInvites,
  type RoomRosters,
  type RosterParticipant,
} from '../lib/leagueApi';
import { normalize } from '../lib/format';
import { persist } from '../lib/persist';
import { AuctionConfigForm, labelCls } from '../components/AuctionConfigForm';
import { RoleBadge, ROLE_STYLES } from '../components/RoleBadge';

export default function Liga() {
  const { id = '' } = useParams();
  const status = useAuth((s) => s.status);
  const location = useLocation();
  const { t } = useT();
  const [detail, setDetail] = useState<LeagueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await getLeague(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('league.openErr'));
    }
  }, [id, t]);

  useEffect(() => {
    if (status === 'authed') void load();
  }, [status, load]);

  if (status === 'loading') {
    return (
      <main className="flex min-h-[60dvh] items-center justify-center text-chalk-dim">
        {t('leagues.loading')}
      </main>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to={`/entrar?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  if (error) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center px-5 pt-16 text-center">
        <p className="font-display text-4xl font-bold uppercase text-danger">{t('league.openErr')}</p>
        <p className="mt-3 text-sm text-chalk-dim">{error}</p>
        <Link
          to="/ligas"
          className="mt-6 text-sm font-semibold uppercase tracking-widest text-gold underline decoration-dotted"
        >
          {t('league.backToLeagues')}
        </Link>
      </main>
    );
  }
  if (!detail) {
    return (
      <main className="flex min-h-[60dvh] items-center justify-center text-chalk-dim">
        {t('league.loading')}
      </main>
    );
  }
  return <LeagueBody detail={detail} reload={load} />;
}

function LeagueBody({ detail, reload }: { detail: LeagueDetail; reload: () => Promise<void> }) {
  const user = useAuth((s) => s.user);
  const { t } = useT();
  const isAdmin = user?.id === detail.adminUserId;

  return (
    <main className="mx-auto max-w-5xl px-5 pb-16 pt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Link
            to="/ligas"
            className="text-xs font-semibold uppercase tracking-[0.3em] text-chalk-dim hover:text-chalk"
          >
            {t('league.back')}
          </Link>
          <h1 className="mt-1 font-display text-6xl font-bold uppercase leading-none text-chalk">
            {detail.name}
          </h1>
        </div>
        <p className="tabular text-sm text-chalk-dim">
          {detail.memberCount}{' '}
          {detail.memberCount === 1 ? t('leagues.member') : t('leagues.members')}
        </p>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Auctions detail={detail} isAdmin={isAdmin} />
          <RostersSection detail={detail} />
          {isAdmin && <LaunchAuction detail={detail} />}
        </div>
        <div className="space-y-6">
          <Members detail={detail} />
          {isAdmin && <Invites detail={detail} reload={reload} />}
        </div>
      </div>
    </main>
  );
}

/* ————— astas de la liga ————— */

function Auctions({ detail, isAdmin }: { detail: LeagueDetail; isAdmin: boolean }) {
  const { t, locale } = useT();
  const auctions = [...detail.auctions].sort((a, b) => b.createdAt - a.createdAt);
  const [latest, ...rest] = auctions;

  function fecha(ts: number): string {
    return new Date(ts).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <section className="rounded-2xl border chalk-line bg-pitch-800/50 p-5">
      <h2 className="font-display text-2xl font-bold uppercase text-chalk">
        {t('league.auctions')}
      </h2>
      {!latest ? (
        <p className="mt-3 text-sm text-chalk-faint">
          {t('league.noAuctions')}
          {isAdmin ? t('league.noAuctionsAdmin') : ''}
        </p>
      ) : (
        <>
          <div className="mt-4 rounded-xl border-2 border-gold/50 bg-pitch-900/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-gold">
                  {t('league.liveAuction')}
                </p>
                <p className="font-display text-4xl font-bold uppercase tracking-[0.2em] text-chalk">
                  {latest.roomCode}
                </p>
                <p className="text-xs text-chalk-dim">{fecha(latest.createdAt)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/sala/${latest.roomCode}`}
                  className="rounded-xl bg-gold px-5 py-2.5 font-display text-xl font-bold uppercase text-pitch-950"
                >
                  {t('league.enter')}
                </Link>
                <Link
                  to={`/tablero/${latest.roomCode}`}
                  className="rounded-xl border chalk-line px-4 py-2.5 font-display text-xl font-semibold uppercase text-chalk-dim hover:text-chalk"
                >
                  {t('league.board')}
                </Link>
                {isAdmin && (
                  <Link
                    to={`/admin/${latest.roomCode}`}
                    className="rounded-xl border chalk-line px-4 py-2.5 font-display text-xl font-semibold uppercase text-chalk-dim hover:text-chalk"
                  >
                    {t('league.banditore')}
                  </Link>
                )}
              </div>
            </div>
          </div>
          {rest.length > 0 && (
            <ul className="mt-3 divide-y divide-chalk/5">
              {rest.map((a) => (
                <li key={a.roomCode} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-display text-lg font-bold uppercase tracking-widest text-chalk-dim">
                    {a.roomCode}
                  </span>
                  <span className="text-xs text-chalk-faint">{fecha(a.createdAt)}</span>
                  <span className="flex gap-3">
                    <Link
                      to={`/sala/${a.roomCode}`}
                      className="text-chalk-dim underline decoration-dotted hover:text-chalk"
                    >
                      {t('league.roomLink')}
                    </Link>
                    <Link
                      to={`/tablero/${a.roomCode}`}
                      className="text-chalk-dim underline decoration-dotted hover:text-chalk"
                    >
                      {t('league.boardLink')}
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/* ————— rosas del asta (GET /api/rooms/:code/rosters) ————— */

function RostersSection({ detail }: { detail: LeagueDetail }) {
  const { t, locale } = useT();
  const auctions = [...detail.auctions].sort((a, b) => b.createdAt - a.createdAt);
  const [latest, ...rest] = auctions;
  if (!latest) return null;

  function fecha(ts: number): string {
    return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  }

  return (
    <section className="rounded-2xl border chalk-line bg-pitch-800/50 p-5">
      <h2 className="font-display text-2xl font-bold uppercase text-chalk">
        {t('league.rosters')}
      </h2>
      <p className="mt-1 text-xs uppercase tracking-widest text-chalk-dim">
        {latest.roomCode} · {fecha(latest.createdAt)}
      </p>
      <div className="mt-3">
        <AuctionRosters code={latest.roomCode} />
      </div>
      {rest.map((a) => (
        <HistoryRosters
          key={a.roomCode}
          roomCode={a.roomCode}
          label={`${a.roomCode} · ${fecha(a.createdAt)}`}
        />
      ))}
    </section>
  );
}

/** Asta del historial: plegada; las rosas se piden recién al abrirla. */
function HistoryRosters({ roomCode, label }: { roomCode: string; label: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="mt-3 rounded-xl border chalk-line bg-pitch-900/40 px-4 py-3"
      onToggle={(e) => {
        if (e.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="cursor-pointer list-none text-sm font-semibold uppercase tracking-widest text-chalk-dim hover:text-chalk [&::-webkit-details-marker]:hidden">
        {label} ▾
      </summary>
      <div className="mt-3">{opened && <AuctionRosters code={roomCode} />}</div>
    </details>
  );
}

function AuctionRosters({ code }: { code: string }) {
  const { t, locale } = useT();
  const user = useAuth((s) => s.user);
  const [data, setData] = useState<RoomRosters | 'loading' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    setData('loading');
    void getRoomRosters(code).then((r) => {
      if (alive) setData(r ?? 'error');
    });
    return () => {
      alive = false;
    };
  }, [code]);

  if (data === 'loading') {
    return <p className="text-sm text-chalk-faint">{t('league.rostersLoading')}</p>;
  }
  if (data === 'error') {
    return <p className="text-sm text-chalk-faint">{t('league.rostersUnavailable')}</p>;
  }

  const myName = user ? normalize(user.name) : null;
  const sorted = [...data.participants].sort(
    (a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name),
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-chalk-faint">
        {data.finishedAt !== null
          ? new Date(data.finishedAt).toLocaleDateString(locale, {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : t('league.inProgress')}
      </p>
      {sorted.map((p) => (
        <RosterCard
          key={p.id}
          participant={p}
          config={data.config}
          mine={myName !== null && normalize(p.name) === myName}
        />
      ))}
    </div>
  );
}

function RosterCard({
  participant: p,
  config,
  mine,
}: {
  participant: RosterParticipant;
  config: RoomConfig;
  mine: boolean;
}) {
  const { t } = useT();
  return (
    <details
      open={mine}
      className={`rounded-xl border bg-pitch-900/60 ${mine ? 'border-2 border-gold/70' : 'chalk-line'}`}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${p.connected ? 'bg-role-d' : 'bg-chalk-faint'}`}
        />
        <span className="min-w-0 flex-1 truncate font-display text-lg font-semibold text-chalk">
          {p.name}
          {mine && (
            <span className="ml-2 rounded bg-gold/15 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-gold">
              {t('league.youBadge')}
            </span>
          )}
        </span>
        <span className="flex shrink-0 gap-1.5 text-[11px]">
          {ROLES.map((role) => (
            <span
              key={role}
              className={`tabular ${
                p.slotsFilled[role] >= config.slots[role]
                  ? ROLE_STYLES[role].text
                  : 'text-chalk-faint'
              }`}
            >
              {role}
              {p.slotsFilled[role]}/{config.slots[role]}
            </span>
          ))}
        </span>
        <span className="tabular shrink-0 text-sm text-chalk-dim">
          <span className={`font-display text-xl font-bold ${p.remaining < 0 ? 'text-danger' : 'text-gold'}`}>
            {p.remaining}
          </span>{' '}
          {t('league.remainingLabel')} · {p.spent} {t('league.spentLabel')}
        </span>
      </summary>
      <div className="space-y-3 border-t chalk-line px-4 py-3">
        {p.roster.length === 0 ? (
          <p className="text-xs text-chalk-faint">{t('admin.emptyRoster')}</p>
        ) : (
          ROLES.map((role) => {
            const entries = p.roster.filter((e) => e.player.role === role);
            if (entries.length === 0) return null;
            return (
              <div key={role}>
                <p className={`mb-1 text-[11px] font-semibold uppercase tracking-widest ${ROLE_STYLES[role].text}`}>
                  {t(`role.${role}`)}
                </p>
                <ul className="space-y-1">
                  {entries.map((e) => (
                    <li key={e.player.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <RoleBadge role={role} size="sm" />
                        <span className="truncate text-chalk">{e.player.name}</span>
                        <span className="truncate text-xs text-chalk-faint">{e.player.team}</span>
                      </span>
                      <span className="tabular font-display text-base font-bold text-gold">
                        {e.price}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </details>
  );
}

function LaunchAuction({ detail }: { detail: LeagueDetail }) {
  const navigate = useNavigate();
  const { t } = useT();
  const [error, setError] = useState<string | null>(null);

  async function launch(config: Partial<RoomConfig>) {
    setError(null);
    try {
      const { code, adminToken } = await createLeagueAuction(detail.id, config);
      persist.setAdminToken(code, adminToken);
      navigate(`/admin/${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('league.launchErr'));
    }
  }

  return (
    <details className="rounded-2xl border-2 border-gold/40 bg-pitch-800/50 p-5">
      <summary className="cursor-pointer list-none font-display text-2xl font-bold uppercase text-gold [&::-webkit-details-marker]:hidden">
        {t('league.launchTitle')}
      </summary>
      <p className="mb-4 mt-1 text-xs text-chalk-dim">{t('league.launchSubtitle')}</p>
      <AuctionConfigForm
        fixedLeagueName={detail.name}
        submitLabel={t('league.launch')}
        busyLabel={t('league.launching')}
        onSubmit={launch}
        error={error}
      />
    </details>
  );
}

/* ————— miembros ————— */

function Members({ detail }: { detail: LeagueDetail }) {
  const { t } = useT();
  return (
    <section className="rounded-2xl border chalk-line bg-pitch-800/50 p-5">
      <h2 className="font-display text-2xl font-bold uppercase text-chalk">
        {t('league.membersTitle')}
      </h2>
      <ul className="mt-3 space-y-2">
        {detail.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pitch-700 font-display text-sm font-bold text-chalk">
              {m.name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-chalk">{m.name}</span>
              <span className="block truncate text-xs text-chalk-faint">{m.email}</span>
            </span>
            {m.userId === detail.adminUserId && (
              <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold">
                {t('leagues.adminBadge')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ————— invitaciones (solo admin) ————— */

function Invites({ detail, reload }: { detail: LeagueDetail; reload: () => Promise<void> }) {
  const { t } = useT();
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invites: InviteInfo[] = detail.invites ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const emails = [
      ...new Set(raw.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => s.includes('@'))),
    ];
    if (emails.length === 0) {
      setError(t('league.invitesErrEmpty'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendInvites(detail.id, emails);
      setRaw('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('league.invitesErr'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border chalk-line bg-pitch-800/50 p-5">
      <h2 className="font-display text-2xl font-bold uppercase text-chalk">
        {t('league.invitesTitle')}
      </h2>
      <form onSubmit={submit} className="mt-3">
        <label htmlFor="invite-emails" className={labelCls}>
          {t('league.invitesLabel')}
        </label>
        <textarea
          id="invite-emails"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={3}
          placeholder={'leo@example.com\nkun@example.com'}
          className="w-full rounded-lg border chalk-line bg-pitch-900 px-3 py-2.5 text-sm text-chalk placeholder:text-chalk-faint focus:border-gold/60"
        />
        {error && <p className="mt-1 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy || !raw.trim()}
          className="mt-2 rounded-lg bg-gold px-4 py-2 font-display text-lg font-bold uppercase text-pitch-950 disabled:cursor-not-allowed disabled:bg-pitch-700 disabled:text-chalk-faint"
        >
          {busy ? t('league.inviting') : t('league.invitesSubmit')}
        </button>
      </form>

      {invites.length > 0 && (
        <ul className="mt-4 space-y-2 border-t chalk-line pt-3">
          {invites.map((inv) => (
            <InviteRow key={inv.token} invite={inv} leagueName={detail.name} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InviteRow({ invite, leagueName }: { invite: InviteInfo; leagueName: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const accepted = invite.acceptedByUserId !== null;
  const waText = encodeURIComponent(t('league.waMessage', { league: leagueName, url: invite.url }));

  function copy() {
    navigator.clipboard
      ?.writeText(invite.url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate text-chalk">{invite.email}</span>
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
          accepted ? 'bg-role-d/15 text-role-d' : 'bg-pitch-700 text-chalk-dim'
        }`}
      >
        {accepted ? t('league.accepted') : t('league.pending')}
      </span>
      {!accepted && (
        <>
          <button
            type="button"
            onClick={copy}
            className="rounded border chalk-line px-2 py-1 text-xs font-semibold text-chalk-dim hover:text-chalk"
          >
            {copied ? t('league.copied') : t('league.copyLink')}
          </button>
          <a
            href={`https://wa.me/?text=${waText}`}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-role-d/50 px-2 py-1 text-xs font-semibold text-role-d hover:bg-role-d/10"
          >
            WhatsApp
          </a>
        </>
      )}
    </li>
  );
}
