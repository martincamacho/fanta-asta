import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RoomConfig } from '@fanta/shared';
import { checkRoom, createRoom } from '../lib/api';
import { persist } from '../lib/persist';
import { useAuth } from '../authStore';
import { AuctionConfigForm, inputCls, labelCls } from '../components/AuctionConfigForm';

export default function Home() {
  const status = useAuth((s) => s.status);
  const leagues = useAuth((s) => s.leagues);

  return (
    <main className="mx-auto flex max-w-5xl flex-col px-5 pb-16 pt-10 sm:pt-16">
      {/* Hero: la voz del banditore */}
      <header className="mb-10 sm:mb-14">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.35em] text-gold">
          Subasta en vivo · sin pulsadores
        </p>
        <h1 className="font-display text-[clamp(4rem,14vw,9rem)] font-bold uppercase leading-[0.85] tracking-tight text-chalk">
          Fanta
          <br />
          <span className="text-gold">Asta</span>
        </h1>
        <p className="mt-5 max-w-md text-chalk-dim">
          El banditore llama, tu celular es el pulsador y el tablero se proyecta en la TV. Quién
          apretó primero lo decide el servidor — cero peleas.
        </p>
      </header>

      {status === 'authed' && (
        <Link
          to="/ligas"
          className="animate-rise mb-6 flex items-center justify-between rounded-2xl border-2 border-gold/40 bg-pitch-800/70 px-6 py-4 transition hover:bg-pitch-700/70"
        >
          <span className="font-display text-2xl font-bold uppercase text-chalk">
            Mis ligas
            {leagues.length > 0 && (
              <span className="tabular ml-2 text-gold">· {leagues.length}</span>
            )}
          </span>
          <span className="text-sm font-semibold uppercase tracking-widest text-gold">
            Entrar →
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
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean.length !== 6 || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const room = await checkRoom(clean);
      if (!room.exists) {
        setError(`La sala ${clean} no existe. Revisá el código.`);
        return;
      }
      persist.setName(clean, name.trim());
      navigate(`/sala/${clean}`);
    } catch {
      setError('No pudimos verificar la sala. ¿Está corriendo el servidor?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="animate-rise flex flex-col rounded-2xl border chalk-line bg-pitch-800/80 p-6"
    >
      <h2 className="font-display text-3xl font-bold uppercase tracking-wide text-chalk">Unirse</h2>
      <p className="mb-5 mt-1 text-sm text-chalk-dim">Entrá con el código que pasó el banditore.</p>
      <div className="mb-4">
        <label htmlFor="join-code" className={labelCls}>
          Código de sala
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
      <div className="mb-5">
        <label htmlFor="join-name" className={labelCls}>
          Nombre de tu equipo
        </label>
        <input
          id="join-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: La Scaloneta"
          maxLength={24}
          className={inputCls}
        />
      </div>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={busy || code.trim().length !== 6 || !name.trim()}
        className="mt-auto rounded-xl bg-gold px-6 py-4 font-display text-2xl font-bold uppercase tracking-wider text-pitch-950 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-pitch-700 disabled:text-chalk-faint"
      >
        {busy ? 'Entrando…' : 'Entrar a la sala'}
      </button>
    </form>
  );
}

function CreateCard() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  async function create(config: Partial<RoomConfig>) {
    setError(null);
    try {
      const { code, adminToken } = await createRoom(config);
      persist.setAdminToken(code, adminToken);
      navigate(`/admin/${code}`);
    } catch {
      setError('No se pudo crear la sala. ¿Está corriendo el servidor?');
    }
  }

  return (
    <div className="animate-rise flex flex-col rounded-2xl border chalk-line bg-pitch-800/50 p-6 [animation-delay:80ms]">
      <h2 className="font-display text-3xl font-bold uppercase tracking-wide text-chalk">
        Crear asta
      </h2>
      <p className="mb-5 mt-1 text-sm text-chalk-dim">Vos sos el banditore: configurá la liga.</p>
      <AuctionConfigForm
        submitLabel="Crear la sala"
        busyLabel="Creando…"
        onSubmit={create}
        error={error}
      />
    </div>
  );
}
