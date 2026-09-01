import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../authStore';

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
          <Link
            to="/ligas"
            className="text-sm font-semibold uppercase tracking-widest text-chalk-dim hover:text-chalk"
          >
            Mis ligas
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
                  void logout().then(() => navigate('/'));
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-danger hover:bg-danger/10"
              >
                Salir
              </button>
            </div>
          )}
        </div>
      ) : status === 'anonymous' ? (
        <Link
          to="/entrar"
          className="rounded-lg border chalk-line px-4 py-1.5 text-sm font-semibold uppercase tracking-widest text-chalk-dim hover:bg-pitch-700 hover:text-chalk"
        >
          Entrar
        </Link>
      ) : null}
    </nav>
  );
}
