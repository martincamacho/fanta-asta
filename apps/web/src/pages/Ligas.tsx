import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../authStore';
import { createLeague } from '../lib/leagueApi';
import { inputCls, labelCls } from '../components/AuctionConfigForm';

export default function Ligas() {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const leagues = useAuth((s) => s.leagues);
  const refresh = useAuth((s) => s.refresh);
  const location = useLocation();

  useEffect(() => {
    if (status === 'authed') void refresh();
  }, [status, refresh]);

  if (status === 'loading') {
    return <main className="flex min-h-[60dvh] items-center justify-center text-chalk-dim">Un momento…</main>;
  }
  if (status === 'anonymous') {
    return <Navigate to={`/entrar?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  return (
    <main className="mx-auto max-w-4xl px-5 pb-16 pt-10">
      <h1 className="font-display text-6xl font-bold uppercase leading-none text-chalk">
        Mis ligas
      </h1>
      <p className="mt-2 text-sm text-chalk-dim">
        Una liga junta a tus amigos de siempre: invitás una vez y las astas quedan todas ahí.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-[2fr_1fr]">
        <section>
          {leagues.length === 0 ? (
            <div className="rounded-2xl border chalk-line bg-pitch-800/50 px-6 py-10 text-center">
              <p className="font-display text-2xl font-bold uppercase text-chalk-dim">
                Todavía no tenés ligas
              </p>
              <p className="mt-2 text-sm text-chalk-faint">
                Creá la primera y mandales el link de invitación a tus amigos.
              </p>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {leagues.map((l) => (
                <li key={l.id}>
                  <Link
                    to={`/liga/${l.id}`}
                    className="animate-rise block rounded-2xl border chalk-line bg-pitch-800/70 p-5 transition hover:border-gold/50 hover:bg-pitch-700/70"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-display text-2xl font-bold uppercase leading-tight text-chalk">
                        {l.name}
                      </span>
                      {user && l.adminUserId === user.id && (
                        <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold">
                          admin
                        </span>
                      )}
                    </div>
                    <p className="tabular mt-2 text-sm text-chalk-dim">
                      {l.memberCount} {l.memberCount === 1 ? 'miembro' : 'miembros'}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <CreateLeague />
      </div>
    </main>
  );
}

function CreateLeague() {
  const navigate = useNavigate();
  const refresh = useAuth((s) => s.refresh);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const league = await createLeague(name.trim());
      await refresh();
      navigate(`/liga/${league.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la liga.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="h-fit rounded-2xl border-2 border-gold/40 bg-pitch-800/50 p-5"
    >
      <h2 className="font-display text-2xl font-bold uppercase text-chalk">Crear liga</h2>
      <label htmlFor="league-name" className={`${labelCls} mt-4`}>
        Nombre de la liga
      </label>
      <input
        id="league-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ej: Liga del Barrio"
        maxLength={40}
        className={inputCls}
      />
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="mt-4 w-full rounded-xl bg-gold py-3 font-display text-xl font-bold uppercase tracking-wider text-pitch-950 disabled:cursor-not-allowed disabled:bg-pitch-700 disabled:text-chalk-faint"
      >
        {busy ? 'Creando…' : 'Crear liga'}
      </button>
    </form>
  );
}
