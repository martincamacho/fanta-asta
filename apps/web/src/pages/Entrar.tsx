import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../authStore';
import { inputCls, labelCls } from '../components/AuctionConfigForm';

/** Login y registro en una sola vista, con toggle. ?next= redirige al volver. */
export default function Entrar() {
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/ligas';
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const navigate = useNavigate();
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const valid =
    email.includes('@') && password.length >= 6 && (mode === 'login' || name.trim().length > 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), name.trim(), password);
      navigate(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo entrar. Probá de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col px-5 pb-16 pt-10 sm:pt-16">
      <h1 className="font-display text-6xl font-bold uppercase leading-none text-chalk">
        {mode === 'login' ? 'Entrar' : 'Crear cuenta'}
      </h1>
      <p className="mt-2 text-sm text-chalk-dim">
        Con tu cuenta armás ligas con amigos e invitás por link. Para jugar con un código de sala no
        hace falta cuenta.
      </p>

      {/* toggle login / registro */}
      <div className="mt-6 grid grid-cols-2 rounded-xl border chalk-line p-1">
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            aria-pressed={mode === m}
            className={`rounded-lg py-2 font-display text-lg font-bold uppercase tracking-wider transition ${
              mode === m ? 'bg-gold text-pitch-950' : 'text-chalk-dim hover:text-chalk'
            }`}
          >
            {m === 'login' ? 'Ya tengo cuenta' : 'Registrarme'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="auth-email" className={labelCls}>
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vos@ejemplo.com"
            className={inputCls}
          />
        </div>
        {mode === 'register' && (
          <div>
            <label htmlFor="auth-name" className={labelCls}>
              Nombre de tu equipo
            </label>
            <input
              id="auth-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: La Scaloneta"
              maxLength={24}
              className={inputCls}
            />
          </div>
        )}
        <div>
          <label htmlFor="auth-password" className={labelCls}>
            Contraseña {mode === 'register' && <span className="normal-case">(mínimo 6)</span>}
          </label>
          <input
            id="auth-password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
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
          {busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-chalk-dim">
        ¿Solo venís a una asta?{' '}
        <Link to="/" className="font-semibold text-gold underline decoration-dotted">
          Entrá con el código de sala
        </Link>
      </p>
    </main>
  );
}
