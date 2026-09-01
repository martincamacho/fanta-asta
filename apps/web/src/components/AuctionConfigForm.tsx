import { useState, type FormEvent } from 'react';
import { DEFAULT_CONFIG, ROLES, ROLE_NAMES, type Role, type RoomConfig } from '@fanta/shared';

export const inputCls =
  'w-full rounded-lg border chalk-line bg-pitch-900 px-3 py-2.5 text-chalk placeholder:text-chalk-faint focus:border-gold/60';
export const labelCls = 'mb-1 block text-xs font-semibold uppercase tracking-widest text-chalk-dim';

/** Validación de cupos flexibles: min≤max por rol y sum(min) ≤ total ≤ sum(max). */
export function flexSlotsError(
  slots: Record<Role, number>,
  slotsMin: Record<Role, number>,
  rosterSize: number,
): string | null {
  for (const role of ROLES) {
    if (slotsMin[role] > slots[role]) {
      return `El mínimo de ${ROLE_NAMES[role].toLowerCase()}s (${slotsMin[role]}) supera el máximo (${slots[role]}).`;
    }
  }
  const sumMin = ROLES.reduce((n, r) => n + slotsMin[r], 0);
  const sumMax = ROLES.reduce((n, r) => n + slots[r], 0);
  if (rosterSize < sumMin) {
    return `El total de plantilla (${rosterSize}) no llega a la suma de mínimos (${sumMin}).`;
  }
  if (rosterSize > sumMax) {
    return `El total de plantilla (${rosterSize}) supera la suma de máximos (${sumMax}).`;
  }
  return null;
}

/** Config de asta (créditos, cupos, timer) — compartida por Home y el detalle de liga. */
export function AuctionConfigForm({
  showLeagueName = true,
  fixedLeagueName,
  submitLabel,
  busyLabel,
  onSubmit,
  error,
}: {
  showLeagueName?: boolean;
  /** Si viene, se usa como leagueName sin mostrar el campo (astas de liga). */
  fixedLeagueName?: string;
  submitLabel: string;
  busyLabel: string;
  onSubmit: (config: Partial<RoomConfig>) => Promise<void>;
  error?: string | null;
}) {
  const [leagueName, setLeagueName] = useState('');
  const [budget, setBudget] = useState(DEFAULT_CONFIG.budget);
  const [slots, setSlots] = useState<Record<Role, number>>({ ...DEFAULT_CONFIG.slots });
  const [bidTimer, setBidTimer] = useState(DEFAULT_CONFIG.bidTimerSeconds);
  const [baseBidMode, setBaseBidMode] = useState<RoomConfig['baseBidMode']>(
    DEFAULT_CONFIG.baseBidMode,
  );
  const [hideValues, setHideValues] = useState(DEFAULT_CONFIG.hideValues);
  const [callMode, setCallMode] = useState<RoomConfig['callMode']>(DEFAULT_CONFIG.callMode);
  const [auctionMode, setAuctionMode] = useState<RoomConfig['auctionMode']>(
    DEFAULT_CONFIG.auctionMode,
  );
  const [flexOn, setFlexOn] = useState(false);
  const [slotsMin, setSlotsMin] = useState<Record<Role, number>>({ ...DEFAULT_CONFIG.slots });
  const [rosterSize, setRosterSize] = useState(
    ROLES.reduce((n, r) => n + DEFAULT_CONFIG.slots[r], 0),
  );
  const [busy, setBusy] = useState(false);

  const flexError = flexOn ? flexSlotsError(slots, slotsMin, rosterSize) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (flexError) return;
    setBusy(true);
    try {
      await onSubmit({
        leagueName: fixedLeagueName ?? (leagueName.trim() || DEFAULT_CONFIG.leagueName),
        budget,
        slots,
        bidTimerSeconds: bidTimer,
        baseBidMode,
        hideValues,
        callMode,
        auctionMode,
        ...(flexOn ? { slotsMin, rosterSize } : {}),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col">
      {showLeagueName && !fixedLeagueName && (
        <div className="mb-4">
          <label htmlFor="cfg-league" className={labelCls}>
            Nombre de la liga
          </label>
          <input
            id="cfg-league"
            value={leagueName}
            onChange={(e) => setLeagueName(e.target.value)}
            placeholder={DEFAULT_CONFIG.leagueName}
            maxLength={40}
            className={inputCls}
          />
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="cfg-budget" className={labelCls}>
            Créditos
          </label>
          <input
            id="cfg-budget"
            type="number"
            min={1}
            value={budget}
            onChange={(e) => setBudget(Math.max(1, Number(e.target.value) || 0))}
            className={`${inputCls} tabular`}
          />
        </div>
        <div>
          <label htmlFor="cfg-timer" className={labelCls}>
            Timer de puja (s)
          </label>
          <input
            id="cfg-timer"
            type="number"
            min={2}
            value={bidTimer}
            onChange={(e) => setBidTimer(Math.max(2, Number(e.target.value) || 0))}
            className={`${inputCls} tabular`}
          />
        </div>
      </div>
      <fieldset className="mb-5">
        <legend className={labelCls}>Cupos por rol</legend>
        <div className="grid grid-cols-4 gap-2">
          {ROLES.map((role) => (
            <div key={role}>
              <label
                htmlFor={`cfg-slots-${role}`}
                className="mb-1 block text-center font-display text-lg font-bold text-chalk-dim"
                title={ROLE_NAMES[role]}
              >
                {role}
              </label>
              <input
                id={`cfg-slots-${role}`}
                type="number"
                min={0}
                value={slots[role]}
                onChange={(e) =>
                  setSlots((s) => ({ ...s, [role]: Math.max(0, Number(e.target.value) || 0) }))
                }
                className={`${inputCls} tabular text-center`}
              />
            </div>
          ))}
        </div>
      </fieldset>
      <div className="mb-5 flex flex-wrap items-end gap-x-5 gap-y-3">
        <div>
          <label htmlFor="cfg-base" className={labelCls}>
            Base de puja
          </label>
          <select
            id="cfg-base"
            value={baseBidMode}
            onChange={(e) => setBaseBidMode(e.target.value as RoomConfig['baseBidMode'])}
            className={inputCls}
          >
            <option value="fixed">Desde 1 crédito</option>
            <option value="quotazione">Desde la quotazione</option>
          </select>
        </div>
        <div>
          <label htmlFor="cfg-callmode" className={labelCls}>
            ¿Quién llama?
          </label>
          <select
            id="cfg-callmode"
            value={callMode}
            onChange={(e) => setCallMode(e.target.value as RoomConfig['callMode'])}
            className={inputCls}
          >
            <option value="admin">El banditore</option>
            <option value="turns">Ronda de turnos</option>
          </select>
        </div>
        <div>
          <label htmlFor="cfg-auctionmode" className={labelCls}>
            Modo de oferta
          </label>
          <select
            id="cfg-auctionmode"
            value={auctionMode}
            onChange={(e) => setAuctionMode(e.target.value as RoomConfig['auctionMode'])}
            className={inputCls}
          >
            <option value="uno">+Uno (digital)</option>
            <option value="premi_parla">Premi&amp;Parla (se canta de viva voz)</option>
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2.5 text-sm text-chalk">
          <input
            type="checkbox"
            checked={hideValues}
            onChange={(e) => setHideValues(e.target.checked)}
            className="h-4 w-4 accent-gold"
          />
          Ocultar quotazioni
        </label>
      </div>
      <p className="-mt-3 mb-4 text-xs text-chalk-faint">
        {auctionMode === 'uno'
          ? 'Cada pulsación lleva su monto: todo se resuelve en el celular.'
          : 'El botón solo reserva la palabra; la oferta se canta de viva voz y el banditore fija el monto.'}
      </p>

      <details className="mb-5 rounded-lg border chalk-line px-3 py-2" open={flexOn}>
        <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-widest text-chalk-dim [&::-webkit-details-marker]:hidden">
          Cupos flexibles (avanzado) ▾
        </summary>
        <label className="mt-2 flex items-center gap-2 text-sm text-chalk">
          <input
            type="checkbox"
            checked={flexOn}
            onChange={(e) => setFlexOn(e.target.checked)}
            className="h-4 w-4 accent-gold"
          />
          Usar mínimos y máximos por rol (estilo oficial)
        </label>
        {flexOn && (
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-chalk-dim">
              Mínimo por rol (el máximo es el cupo de arriba)
            </p>
            <div className="grid grid-cols-4 gap-2">
              {ROLES.map((role) => (
                <input
                  key={role}
                  type="number"
                  min={0}
                  value={slotsMin[role]}
                  onChange={(e) =>
                    setSlotsMin((s) => ({
                      ...s,
                      [role]: Math.max(0, Math.floor(Number(e.target.value)) || 0),
                    }))
                  }
                  aria-label={`Mínimo de ${ROLE_NAMES[role]}`}
                  className={`${inputCls} tabular py-1.5 text-center`}
                />
              ))}
            </div>
            <label className="mt-3 block">
              <span className={labelCls}>Total de plantilla</span>
              <input
                type="number"
                min={1}
                value={rosterSize}
                onChange={(e) =>
                  setRosterSize(Math.max(1, Math.floor(Number(e.target.value)) || 0))
                }
                className={`${inputCls} tabular w-28 py-1.5`}
              />
            </label>
            {flexError && <p className="mt-2 text-xs font-semibold text-danger">{flexError}</p>}
          </div>
        )}
      </details>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={busy || flexError !== null}
        className="mt-auto rounded-xl border-2 border-gold/70 px-6 py-4 font-display text-2xl font-bold uppercase tracking-wider text-gold transition hover:bg-gold/10 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? busyLabel : submitLabel}
      </button>
    </form>
  );
}
