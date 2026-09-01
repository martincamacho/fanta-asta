import { create } from 'zustand';
import type { LeagueSummary, User } from '@fanta/shared';

export type AuthStatus = 'loading' | 'anonymous' | 'authed';

/** Extrae el mensaje de error del server (en español) tal cual llega. */
export async function serverError(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      if (typeof b.error === 'string') return b.error;
      if (typeof b.message === 'string') return b.message;
    }
  } catch {
    /* cuerpo no-JSON */
  }
  return `Error ${res.status}`;
}

/** Error de auth con flags del server: 409 {needsPassword} en claim, 401 {passwordless} en login. */
export class AuthFlowError extends Error {
  constructor(
    message: string,
    readonly flags: { needsPassword?: boolean; passwordless?: boolean } = {},
  ) {
    super(message);
    this.name = 'AuthFlowError';
  }
}

async function authFail(res: Response): Promise<never> {
  let message = `Error ${res.status}`;
  const flags: { needsPassword?: boolean; passwordless?: boolean } = {};
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      if (typeof b.error === 'string') message = b.error;
      if (b.needsPassword === true) flags.needsPassword = true;
      if (b.passwordless === true) flags.passwordless = true;
    }
  } catch {
    /* cuerpo no-JSON */
  }
  throw new AuthFlowError(message, flags);
}

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  leagues: LeagueSummary[];
  /** GET /api/auth/me al boot; 401 = anónimo. Las cuentas son una capa opcional. */
  init: () => Promise<void>;
  /** Re-consulta /me (tras crear liga, aceptar invitación, etc.). */
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  /** Passwordless-lite: encuentra o crea la cuenta por email sin contraseña y abre sesión.
   *  Lanza AuthFlowError {needsPassword} si el email está protegido con contraseña. */
  claim: (email: string, name?: string) => Promise<void>;
  /** Protege la cuenta logueada (setea/cambia contraseña, ≥6). */
  setPassword: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

async function fetchMe(): Promise<{ user: User; leagues: LeagueSummary[] } | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(await serverError(res));
  return (await res.json()) as { user: User; leagues: LeagueSummary[] };
}

export const useAuth = create<AuthState>()((set, get) => ({
  status: 'loading',
  user: null,
  leagues: [],

  init: async () => {
    try {
      const me = await fetchMe();
      if (me) set({ status: 'authed', user: me.user, leagues: me.leagues });
      else set({ status: 'anonymous', user: null, leagues: [] });
    } catch {
      // Server caído o sin soporte de cuentas: la app sigue en modo anónimo.
      set({ status: 'anonymous', user: null, leagues: [] });
    }
  },

  refresh: async () => {
    try {
      const me = await fetchMe();
      if (me) set({ status: 'authed', user: me.user, leagues: me.leagues });
      else set({ status: 'anonymous', user: null, leagues: [] });
    } catch {
      /* mantiene el estado actual ante un error transitorio */
    }
  },

  login: async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) await authFail(res);
    const { user } = (await res.json()) as { user: User };
    set({ status: 'authed', user });
    await get().refresh();
  },

  register: async (email, name, password) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, password }),
    });
    if (!res.ok) throw new Error(await serverError(res));
    const { user } = (await res.json()) as { user: User };
    set({ status: 'authed', user });
    await get().refresh();
  },

  claim: async (email, name) => {
    const res = await fetch('/api/auth/claim', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(name ? { email, name } : { email }),
    });
    if (!res.ok) await authFail(res);
    const { user } = (await res.json()) as { user: User };
    set({ status: 'authed', user });
    await get().refresh();
  },

  setPassword: async (password) => {
    const res = await fetch('/api/auth/set-password', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new Error(await serverError(res));
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* aunque falle la red, localmente cerramos sesión */
    }
    set({ status: 'anonymous', user: null, leagues: [] });
  },
}));
