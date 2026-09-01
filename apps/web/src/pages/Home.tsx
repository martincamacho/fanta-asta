import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RoomConfig } from '@fanta/shared';
import { checkRoom, createRoom } from '../lib/api';
import { persist } from '../lib/persist';
import { AuthFlowError, useAuth } from '../authStore';
import { useT } from '../i18n';
import { AuctionConfigForm, inputCls, labelCls } from '../components/AuctionConfigForm';

export default function Home() {
  const status = useAuth((s) => s.status);
  const leagues = useAuth((s) => s.leagues);
  const { t } = useT();

  return (
    <main className="mx-auto flex max-w-5xl flex-col px-5 pb-16 pt-10 sm:pt-16">
      {/* Hero: la voz del banditore */}
      <header className="mb-10 sm:mb-14">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.35em] text-gold">
          {t('home.eyebrow')}
        </p>
        <h1 className="font-display text-[clamp(4rem,14vw,9rem)] font-bold uppercase leading-[0.85] tracking-tight text-chalk">
          Fanta
          <br />
          <span className="text-gold">Asta</span>
        </h1>
        <p className="mt-5 max-w-md text-chalk-dim">{t('home.tagline')}</p>
      </header>

      {status === 'authed' && (
        <Link
          to="/ligas"
          className="animate-rise mb-6 flex items-center justify-between rounded-2xl border-2 border-gold/40 bg-pitch-800/70 px-6 py-4 transition hover:bg-pitch-700/70"
        >
          <span className="font-display text-2xl font-bold uppercase text-chalk">
            {t('nav.myLeagues')}
            {leagues.length > 0 && <span className="tabular ml-2 text-gold">· {leagues.length}</span>}
          </span>
          <span className="text-sm font-semibold uppercase tracking-widest text-gold">
            {t('home.myLeaguesGo')}
          </span>
        </Link>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <JoinCard />
        <CreateCard />
      </div>
    </main>
  );
}

function JoinCard() {
  const navigate = useNavigate();
  const { t } = useT();
  const authStatus = useAuth((s) => s.status);
  const claim = useAuth((s) => s.claim);
  const login = useAuth((s) => s.login);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [anon, setAnon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Con sesión activa el ticket resuelve la identidad: alcanza con el código.
  const emailMode = authStatus !== 'authed' && !anon;

  const valid =
    code.trim().length === 6 &&
    (authStatus === 'authed' ||
      (emailMode
        ? email.includes('@') && name.trim().length > 0 && (!needsPassword || password.length >= 6)
        : name.trim().length > 0));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const clean = code.trim().toUpperCase();
    setBusy(true);
    setError(null);
    try {
      const room = await checkRoom(clean);
      if (!room.exists) {
        setError(t('home.join.errNotFound', { code: clean }));
        return;
      }
      if (emailMode) {
        try {
          if (needsPassword) await login(email.trim(), password);
          else await claim(email.trim(), name.trim());
        } catch (err) {
          if (err instanceof AuthFlowError && err.flags.needsPassword) {
            setNeedsPassword(true);
            return;
          }
          setError(err instanceof Error ? err.message : t('auth.fallbackError'));
          return;
        }
      } else if (authStatus !== 'authed') {
        persist.setName(clean, name.trim());
      }
      navigate(`/sala/${clean}`);
    } catch {
      setError(t('home.join.errServer'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="animate-rise flex flex-col rounded-2xl border chalk-line bg-pitch-800/80 p-6"
    >
      <h2 className="font-display text-3xl font-bold uppercase tracking-wide text-chalk">
        {t('home.join.title')}
      </h2>
      <p className="mb-5 mt-1 text-sm text-chalk-dim">{t('home.join.subtitle')}</p>
      <div className="mb-4">
        <label htmlFor="join-code" className={labelCls}>
          {t('home.join.codeLabel')}
        </label>
        <input
          id="join-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
          placeholder="ABC123"
          autoCapitalize="characters"
          autoComplete="off"
          className={`${inputCls} font-display text-3xl font-bold uppercase tracking-[0.4em]`}
          maxLength={6}
        />
      </div>
      {emailMode && (
        <div className="mb-4">
          <label htmlFor="join-email" className={labelCls}>
            {t('auth.email')}
          </label>
          <input
            id="join-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setNeedsPassword(false);
            }}
            placeholder={t('auth.emailPh')}
            className={inputCls}
          />
          <p className="mt-1 text-xs text-chalk-faint">{t('gate.emailIntro')}</p>
        </div>
      )}
      {authStatus !== 'authed' && (
        <div className="mb-4">
          <label htmlFor="join-name" className={labelCls}>
            {t('home.join.nameLabel')}
          </label>
          <input
            id="join-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('home.join.namePh')}
            maxLength={24}
            className={inputCls}
          />
        </div>
      )}
      {emailMode && needsPassword && (
        <div className="animate-rise mb-4">
          <p className="mb-1 text-sm font-semibold text-gold">{t('gate.protected')}</p>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('auth.password')}
            className={inputCls}
          />
        </div>
      )}
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={busy || !valid}
        className="mt-auto rounded-xl bg-gold px-6 py-4 font-display text-2xl font-bold uppercase tracking-wider text-pitch-950 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-pitch-700 disabled:text-chalk-faint"
      >
        {busy ? t('home.join.submitting') : t('home.join.submit')}
      </button>
      {authStatus !== 'authed' && (
        <div className="mt-3 text-center text-sm">
          {anon ? (
            <button
              type="button"
              onClick={() => setAnon(false)}
              className="font-semibold text-gold underline decoration-dotted"
            >
              {t('gate.useEmail')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setAnon(true);
                  setNeedsPassword(false);
                  setError(null);
                }}
                className="font-semibold text-chalk-dim underline decoration-dotted hover:text-chalk"
              >
                {t('gate.continueNoAccount')}
              </button>
              <p className="mt-1 text-xs text-chalk-faint">{t('gate.noAccountNote')}</p>
            </>
          )}
        </div>
      )}
    </form>
  );
}

function CreateCard() {
  const navigate = useNavigate();
  const { t } = useT();
  const [error, setError] = useState<string | null>(null);

  async function create(config: Partial<RoomConfig>) {
    setError(null);
    try {
      const { code, adminToken } = await createRoom(config);
      persist.setAdminToken(code, adminToken);
      navigate(`/admin/${code}`);
    } catch {
      setError(t('home.create.err'));
    }
  }

  return (
    <div className="animate-rise flex flex-col rounded-2xl border chalk-line bg-pitch-800/50 p-6 [animation-delay:80ms]">
      <h2 className="font-display text-3xl font-bold uppercase tracking-wide text-chalk">
        {t('home.create.title')}
      </h2>
      <p className="mb-5 mt-1 text-sm text-chalk-dim">{t('home.create.subtitle')}</p>
      <AuctionConfigForm
        submitLabel={t('home.create.submit')}
        busyLabel={t('home.create.submitting')}
        onSubmit={create}
        error={error}
      />
    </div>
  );
}
