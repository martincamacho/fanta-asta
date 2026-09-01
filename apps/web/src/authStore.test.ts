import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from './authStore';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const USER = { id: 'u1', email: 'martin@ejemplo.com', name: 'Los Pibes' };
const LEAGUES = [{ id: 'l1', name: 'Liga del Barrio', adminUserId: 'u1', memberCount: 4 }];

describe('authStore', () => {
  beforeEach(() => {
    useAuth.setState({ status: 'loading', user: null, leagues: [] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('init con /me 401 deja modo anónimo (las cuentas son opcionales)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'sin sesión' })));
    await useAuth.getState().init();
    const s = useAuth.getState();
    expect(s.status).toBe('anonymous');
    expect(s.user).toBeNull();
    expect(s.leagues).toEqual([]);
  });

  it('init con /me caído también deja modo anónimo (no rompe la app)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    await useAuth.getState().init();
    expect(useAuth.getState().status).toBe('anonymous');
  });

  it('login setea el usuario y trae las ligas de /me', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { user: USER })) // POST /login
      .mockResolvedValueOnce(jsonResponse(200, { user: USER, leagues: LEAGUES })); // GET /me
    vi.stubGlobal('fetch', fetchMock);

    await useAuth.getState().login('martin@ejemplo.com', 'secreto');
    const s = useAuth.getState();
    expect(s.status).toBe('authed');
    expect(s.user).toEqual(USER);
    expect(s.leagues).toEqual(LEAGUES);
    const firstCall = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(firstCall[0]).toBe('/api/auth/login');
    expect(firstCall[1].credentials).toBe('include');
  });

  it('login fallido lanza con el mensaje del server tal cual', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Contraseña incorrecta' })),
    );
    await expect(useAuth.getState().login('a@b.com', 'x')).rejects.toThrow(
      'Contraseña incorrecta',
    );
    expect(useAuth.getState().user).toBeNull();
  });

  it('logout limpia usuario y ligas', async () => {
    useAuth.setState({ status: 'authed', user: USER, leagues: LEAGUES });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await useAuth.getState().logout();
    const s = useAuth.getState();
    expect(s.status).toBe('anonymous');
    expect(s.user).toBeNull();
    expect(s.leagues).toEqual([]);
  });
});
