import { useState, type FormEvent } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../authStore';
import { useT } from '../i18n';
import { LangSwitcher } from './LangSwitcher';

/** Nav liviano para las páginas "de sitio" (home, ligas, entrar).
 *  Las vistas de asta (buzzer, tablero, banditore) llevan su propio header. */
export function SiteLayout() {
  return (
    <div className="site-bg theme-light min-h-dvh">
      <AppNav />
      <Outlet />
    </div>
  );
}

function AppNav() {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const { t } = useT();

  return (
    <nav className="theme-dark flex items-center justify-between bg-navy px-5 py-3 shadow-md sm:px-8">
      <Link
        to="/"
        className="font-display text-2xl font-bold uppercase leading-none tracking-wide text-white"
      >
        Fanta <span className="text-secondary">Asta</span>
      </Link>
      {status === 'authed' && user ? (
        <div className="relative flex items-center gap-4">
          <LangSwitcher />
          <Link
            to="/ligas"
            className="text-sm font-semibold uppercase tracking-widest text-chalk-dim hover:text-chalk"
          >
            {t('nav.myLeagues')}
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            className="flex items-center gap-2 rounded-lg border chalk-line px-3 py-1.5 text-sm text-chalk hover:bg-pitch-700"
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gold font-display text-xs font-bold text-pitch-950">
              {user.name.charAt(0).toUpperCase()}
            </span>
            <span className="max-w-[10rem] truncate">{user.name}</span>
            <span className="text-chalk-faint">▾</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-40 mt-2 w-44 rounded-xl border chalk-line bg-pitch-800 p-1 shadow-xl">
              <p className="truncate px-3 py-2 text-xs text-chalk-faint">{user.email}</p>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setPwdOpen(true);
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-chalk hover:bg-pitch-700"
              >
                {t('menu.setPassword')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void logout().then(() => navigate('/'));
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-danger hover:bg-danger/10"
              >
                {t('nav.signOut')}
              </button>
            </div>
          )}
          {pwdOpen && <PasswordModal onClose={() => setPwdOpen(false)} />}
        </div>
      ) : status === 'anonymous' ? (
        <span className="flex items-center gap-3">
          <LangSwitcher />
          <Link
            to="/entrar"
            className="rounded-lg border chalk-line px-4 py-1.5 text-sm font-semibold uppercase tracking-widest text-chalk-dim hover:bg-pitch-700 hover:text-chalk"
          >
            {t('nav.signIn')}
          </Link>
        </span>
      ) : null}
    </nav>
  );
}

/** Modal "protegé tu cuenta": setea/cambia la contraseña (POST /api/auth/set-password). */
function PasswordModal({ onClose }: { onClose: () => void }) {
  const setPassword = useAuth((s) => s.setPassword);
  const { t } = useT();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (value.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      await setPassword(value);
      setSaved(true);
      setTimeout(onClose, 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pwd.err'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(230_28%_8%/0.7)] px-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('pwd.title')}
        className="w-full max-w-sm rounded-2xl border chalk-line bg-pitch-800 p-6 shadow-xl"
      >
        <h2 className="font-display text-3xl font-bold uppercase text-chalk">{t('pwd.title')}</h2>
        <p className="mt-1 text-sm text-chalk-dim">{t('pwd.text')}</p>
        {saved ? (
          <p role="status" className="animate-rise mt-5 text-center font-display text-2xl font-bold uppercase text-success">
            {t('pwd.saved')}
          </p>
        ) : (
          <>
            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-widest text-chalk-dim">
                {t('pwd.new')}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full rounded-lg border chalk-line bg-pitch-900 px-3 py-2.5 text-chalk"
              />
            </label>
            {error && (
              <p role="alert" className="mt-2 text-sm font-semibold text-danger">
                {error}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                disabled={busy || value.length < 6}
                className="flex-1 rounded-lg bg-gold py-2.5 font-display text-xl font-bold uppercase text-pitch-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('pwd.save')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border chalk-line px-4 text-sm font-semibold text-chalk-dim hover:text-chalk"
              >
                {t('admin.cancelBtn')}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
