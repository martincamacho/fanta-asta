import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthFlowError, useAuth } from '../authStore';
import { useT } from '../i18n';
import { inputCls, labelCls } from '../components/AuctionConfigForm';

/** Login y registro en una sola vista, con toggle. ?next= redirige al volver. */
export default function Entrar() {
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/ligas';
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const navigate = useNavigate();
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const claim = useAuth((s) => s.claim);
  const { t } = useT();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Login sobre cuenta sin contraseña: el server responde 401 {passwordless}. */
  const [passwordless, setPasswordless] = useState(false);
  const [busy, setBusy] = useState(false);

  const valid =
    email.includes('@') && password.length >= 6 && (mode === 'login' || name.trim().length > 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    setPasswordless(false);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), name.trim(), password);
      navigate(next);
    } catch (err) {
      if (err instanceof AuthFlowError && err.flags.passwordless) {
        setPasswordless(true);
      } else {
        setError(err instanceof Error ? err.message : t('auth.fallbackError'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function claimDirect() {
    setBusy(true);
    setError(null);
    try {
      await claim(email.trim());
      navigate(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.fallbackError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col px-5 pb-16 pt-10 sm:pt-16">
      <h1 className="font-display text-6xl font-bold uppercase leading-none text-chalk">
        {mode === 'login' ? t('auth.titleLogin') : t('auth.titleRegister')}
      </h1>
      <p className="mt-2 text-sm text-chalk-dim">{t('auth.intro')}</p>

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
            {m === 'login' ? t('auth.tabLogin') : t('auth.tabRegister')}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="auth-email" className={labelCls}>
            {t('auth.email')}
          </label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.emailPh')}
            className={inputCls}
          />
        </div>
        {mode === 'register' && (
          <div>
            <label htmlFor="auth-name" className={labelCls}>
              {t('auth.teamName')}
            </label>
            <input
              id="auth-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('home.join.namePh')}
              maxLength={24}
              className={inputCls}
            />
          </div>
        )}
        <div>
          <label htmlFor="auth-password" className={labelCls}>
            {t('auth.password')}{' '}
            {mode === 'register' && <span className="normal-case">{t('auth.passwordMin')}</span>}
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
        {passwordless && (
          <div className="animate-rise rounded-xl border-2 border-gold/50 bg-pitch-800/70 p-4">
            <p className="text-sm font-semibold text-gold">{t('auth.passwordlessInfo')}</p>
            <button
              type="button"
              onClick={() => void claimDirect()}
              disabled={busy}
              className="mt-3 w-full rounded-lg bg-gold py-2.5 font-display text-xl font-bold uppercase tracking-wider text-pitch-950 disabled:opacity-50"
            >
              {t('auth.claimBtn')}
            </button>
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !valid}
          className="w-full rounded-xl bg-gold py-4 font-display text-2xl font-bold uppercase tracking-wider text-pitch-950 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-pitch-700 disabled:text-chalk-faint"
        >
          {busy ? t('auth.busy') : mode === 'login' ? t('auth.submitLogin') : t('auth.submitRegister')}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-chalk-dim">
        {t('auth.onlyAuction')}{' '}
        <Link to="/" className="font-semibold text-gold underline decoration-dotted">
          {t('auth.enterWithCode')}
        </Link>
      </p>
    </main>
  );
}
