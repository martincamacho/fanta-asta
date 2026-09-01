import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../authStore';
import { acceptInvite, getInvite, type InvitePreview } from '../lib/leagueApi';
import { inputCls, labelCls } from '../components/AuctionConfigForm';

type InviteState = 'loading' | 'invalid' | InvitePreview;

export default function Invitacion() {
  const { token = '' } = useParams();
  const [invite, setInvite] = useState<InviteState>('loading');

  useEffect(() => {
    let alive = true;
    getInvite(token)
      .then((r) => {
        if (alive) setInvite(r ?? 'invalid');
      })
      .catch(() => {
        if (alive) setInvite('invalid');
      });
    return () => {
      alive = false;
    };
  }, [token]);

  if (invite === 'loading') {
    return <main className="flex min-h-[60dvh] items-center justify-center text-chalk-dim">Revisando la invitación…</main>;
  }
  if (invite === 'invalid') {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center px-5 pt-16 text-center">
        <p className="font-display text-5xl font-bold uppercase text-chalk-dim">Invitación vencida</p>
        <p className="mt-3 text-sm text-chalk-dim">
          Este link de invitación no existe o ya no es válido. Pedile al admin de la liga que te
          mande uno nuevo.
        </p>
        <Link to="/" className="mt-6 rounded-lg border chalk-line px-5 py-2.5 text-sm font-semibold uppercase tracking-widest text-chalk-dim hover:text-chalk">
          Volver al inicio
        </Link>
      </main>
    );
  }
  return <InviteBody token={token} invite={invite} />;
}

function InviteBody({ token, invite }: { token: string; invite: InvitePreview }) {
  const status = useAuth((s) => s.status);
  return (
    <main className="mx-auto flex max-w-md flex-col px-5 pb-16 pt-10 sm:pt-16">
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-gold">Invitación</p>
      <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-none text-chalk">
        Te invitaron a <span className="text-gold">{invite.leagueName}</span>
      </h1>
      {status === 'loading' ? (
        <p className="mt-8 text-chalk-dim">Un momento…</p>
      ) : status === 'authed' ? (
        <AcceptPanel token={token} alreadyMember={invite.alreadyMember} />
      ) : (
        <RegisterPanel token={token} presetEmail={invite.email} />
      )}
    </main>
  );
}

function AcceptPanel({ token, alreadyMember }: { token: string; alreadyMember: boolean }) {
  const navigate = useNavigate();
  const refresh = useAuth((s) => s.refresh);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const { leagueId } = await acceptInvite(token);
      await refresh();
      navigate(`/liga/${leagueId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aceptar la invitación.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8">
      {alreadyMember && (
        <p className="mb-3 text-sm text-chalk-dim">Parece que ya sos parte de esta liga.</p>
      )}
      {error && <p className="mb-3 text-sm font-semibold text-danger">{error}</p>}
      <button
        type="button"
        onClick={() => void accept()}
        disabled={busy}
        className="w-full rounded-xl bg-gold py-4 font-display text-2xl font-bold uppercase tracking-wider text-pitch-950 transition active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? 'Uniéndote…' : alreadyMember ? 'Ir a la liga' : 'Unirme a la liga'}
      </button>
      <Link to="/ligas" className="mt-4 block text-center text-sm text-chalk-dim underline decoration-dotted hover:text-chalk">
        Ver mis ligas
      </Link>
    </div>
  );
}

/** Sin sesión: registro con el email de la invitación prellenado (editable). */
function RegisterPanel({ token, presetEmail }: { token: string; presetEmail: string }) {
  const navigate = useNavigate();
  const register = useAuth((s) => s.register);
  const refresh = useAuth((s) => s.refresh);
  const [email, setEmail] = useState(presetEmail);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const valid = email.includes('@') && password.length >= 6 && name.trim().length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await register(email.trim(), name.trim(), password);
      const { leagueId } = await acceptInvite(token);
      await refresh();
      navigate(`/liga/${leagueId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la cuenta.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <p className="text-sm text-chalk-dim">Creá tu cuenta para unirte a la liga.</p>
      <div>
        <label htmlFor="inv-email" className={labelCls}>
          Email
        </label>
        <input
          id="inv-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />
      </div>
      <div>
        <label htmlFor="inv-name" className={labelCls}>
          Nombre de tu equipo
        </label>
        <input
          id="inv-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: La Scaloneta"
          maxLength={24}
          className={inputCls}
        />
      </div>
      <div>
        <label htmlFor="inv-password" className={labelCls}>
          Contraseña <span className="normal-case">(mínimo 6)</span>
        </label>
        <input
          id="inv-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !valid}
        className="w-full rounded-xl bg-gold py-4 font-display text-2xl font-bold uppercase tracking-wider text-pitch-950 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-pitch-700 disabled:text-chalk-faint"
      >
        {busy ? 'Creando cuenta…' : 'Crear cuenta y unirme'}
      </button>
      <p className="text-center text-sm text-chalk-dim">
        ¿Ya tenés cuenta?{' '}
        <Link
          to={`/entrar?next=${encodeURIComponent(`/invitacion/${token}`)}`}
          className="font-semibold text-gold underline decoration-dotted"
        >
          Entrá acá
        </Link>
      </p>
    </form>
  );
}
