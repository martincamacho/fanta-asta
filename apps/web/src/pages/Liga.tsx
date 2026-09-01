import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { InviteInfo, LeagueDetail, RoomConfig } from '@fanta/shared';
import { useAuth } from '../authStore';
import { createLeagueAuction, getLeague, sendInvites } from '../lib/leagueApi';
import { persist } from '../lib/persist';
import { AuctionConfigForm, labelCls } from '../components/AuctionConfigForm';

export default function Liga() {
  const { id = '' } = useParams();
  const status = useAuth((s) => s.status);
  const location = useLocation();
  const [detail, setDetail] = useState<LeagueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await getLeague(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la liga.');
    }
  }, [id]);

  useEffect(() => {
    if (status === 'authed') void load();
  }, [status, load]);

  if (status === 'loading') {
    return <main className="flex min-h-[60dvh] items-center justify-center text-chalk-dim">Un momento…</main>;
  }
  if (status === 'anonymous') {
    return <Navigate to={`/entrar?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  if (error) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center px-5 pt-16 text-center">
        <p className="font-display text-4xl font-bold uppercase text-danger">No se pudo abrir</p>
        <p className="mt-3 text-sm text-chalk-dim">{error}</p>
        <Link to="/ligas" className="mt-6 text-sm font-semibold uppercase tracking-widest text-gold underline decoration-dotted">
          Volver a mis ligas
        </Link>
      </main>
    );
  }
  if (!detail) {
    return <main className="flex min-h-[60dvh] items-center justify-center text-chalk-dim">Cargando la liga…</main>;
  }
  return <LeagueBody detail={detail} reload={load} />;
}

function LeagueBody({ detail, reload }: { detail: LeagueDetail; reload: () => Promise<void> }) {
  const user = useAuth((s) => s.user);
  const isAdmin = user?.id === detail.adminUserId;

  return (
    <main className="mx-auto max-w-5xl px-5 pb-16 pt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Link to="/ligas" className="text-xs font-semibold uppercase tracking-[0.3em] text-chalk-dim hover:text-chalk">
            ← Mis ligas
          </Link>
          <h1 className="mt-1 font-display text-6xl font-bold uppercase leading-none text-chalk">
            {detail.name}
          </h1>
        </div>
        <p className="tabular text-sm text-chalk-dim">
          {detail.memberCount} {detail.memberCount === 1 ? 'miembro' : 'miembros'}
        </p>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Auctions detail={detail} isAdmin={isAdmin} />
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
  const auctions = [...detail.auctions].sort((a, b) => b.createdAt - a.createdAt);
  const [latest, ...rest] = auctions;

  function fecha(ts: number): string {
    return new Date(ts).toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <section className="rounded-2xl border chalk-line bg-pitch-800/50 p-5">
      <h2 className="font-display text-2xl font-bold uppercase text-chalk">Astas de la liga</h2>
      {!latest ? (
        <p className="mt-3 text-sm text-chalk-faint">
          Todavía no hubo ninguna asta.{isAdmin ? ' Lanzá la primera acá abajo.' : ''}
        </p>
      ) : (
        <>
          <div className="mt-4 rounded-xl border-2 border-gold/50 bg-pitch-900/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-gold">
                  Asta en curso
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
                  Entrar
                </Link>
                <Link
                  to={`/tablero/${latest.roomCode}`}
                  className="rounded-xl border chalk-line px-4 py-2.5 font-display text-xl font-semibold uppercase text-chalk-dim hover:text-chalk"
                >
                  Tablero
                </Link>
                {isAdmin && (
                  <Link
                    to={`/admin/${latest.roomCode}`}
                    className="rounded-xl border chalk-line px-4 py-2.5 font-display text-xl font-semibold uppercase text-chalk-dim hover:text-chalk"
                  >
                    Banditore
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
                    <Link to={`/sala/${a.roomCode}`} className="text-chalk-dim underline decoration-dotted hover:text-chalk">
                      sala
                    </Link>
                    <Link to={`/tablero/${a.roomCode}`} className="text-chalk-dim underline decoration-dotted hover:text-chalk">
                      tablero
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

function LaunchAuction({ detail }: { detail: LeagueDetail }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  async function launch(config: Partial<RoomConfig>) {
    setError(null);
    try {
      const { code, adminToken } = await createLeagueAuction(detail.id, config);
      persist.setAdminToken(code, adminToken);
      navigate(`/admin/${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo lanzar el asta.');
    }
  }

  return (
    <details className="rounded-2xl border-2 border-gold/40 bg-pitch-800/50 p-5">
      <summary className="cursor-pointer list-none font-display text-2xl font-bold uppercase text-gold [&::-webkit-details-marker]:hidden">
        Lanzar asta ▾
      </summary>
      <p className="mb-4 mt-1 text-xs text-chalk-dim">
        Crea una sala ligada a la liga: tus miembros entran con su cuenta, sin código ni nombre.
      </p>
      <AuctionConfigForm
        fixedLeagueName={detail.name}
        submitLabel="Lanzar asta"
        busyLabel="Lanzando…"
        onSubmit={launch}
        error={error}
      />
    </details>
  );
}

/* ————— miembros ————— */

function Members({ detail }: { detail: LeagueDetail }) {
  return (
    <section className="rounded-2xl border chalk-line bg-pitch-800/50 p-5">
      <h2 className="font-display text-2xl font-bold uppercase text-chalk">Miembros</h2>
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
                admin
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
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invites: InviteInfo[] = detail.invites ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const emails = [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => s.includes('@')))];
    if (emails.length === 0) {
      setError('Escribí al menos un email válido.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendInvites(detail.id, emails);
      setRaw('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron crear las invitaciones.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border chalk-line bg-pitch-800/50 p-5">
      <h2 className="font-display text-2xl font-bold uppercase text-chalk">Invitar amigos</h2>
      <form onSubmit={submit} className="mt-3">
        <label htmlFor="invite-emails" className={labelCls}>
          Emails (separados por coma o enter)
        </label>
        <textarea
          id="invite-emails"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={3}
          placeholder={'leo@ejemplo.com\nkun@ejemplo.com'}
          className="w-full rounded-lg border chalk-line bg-pitch-900 px-3 py-2.5 text-sm text-chalk placeholder:text-chalk-faint focus:border-gold/60"
        />
        {error && <p className="mt-1 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy || !raw.trim()}
          className="mt-2 rounded-lg bg-gold px-4 py-2 font-display text-lg font-bold uppercase text-pitch-950 disabled:cursor-not-allowed disabled:bg-pitch-700 disabled:text-chalk-faint"
        >
          {busy ? 'Invitando…' : 'Crear invitaciones'}
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
  const [copied, setCopied] = useState(false);
  const accepted = invite.acceptedByUserId !== null;
  const waText = encodeURIComponent(
    `¡Sumate a nuestra liga "${leagueName}" en Fanta Asta! ${invite.url}`,
  );

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
        {accepted ? 'aceptada' : 'pendiente'}
      </span>
      {!accepted && (
        <>
          <button
            type="button"
            onClick={copy}
            className="rounded border chalk-line px-2 py-1 text-xs font-semibold text-chalk-dim hover:text-chalk"
          >
            {copied ? 'Copiado ✓' : 'Copiar link'}
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
