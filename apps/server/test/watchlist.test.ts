import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WatchlistEntry } from '@fanta/shared';
import { createServer, type FantaServer } from '../src/server.js';

let server: FantaServer;
let code: string;
let ana: Record<string, string>;
let beto: Record<string, string>;

async function register(email: string, name: string): Promise<Record<string, string>> {
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, name, password: 'secreta1' },
  });
  const cookie = res.cookies.find((c) => c.name === 'fanta_session')!;
  return { fanta_session: cookie.value };
}

const get = () => server.app.inject({ method: 'GET', url: `/api/rooms/${code}/watchlist`, cookies: ana });
const put = (entries: unknown, cookies = ana) =>
  server.app.inject({ method: 'PUT', url: `/api/rooms/${code}/watchlist`, payload: { entries }, cookies });

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:' });
  await server.app.ready();
  ana = await register('ana@wl.test', 'Ana');
  beto = await register('beto@wl.test', 'Beto');
  const room = await server.app.inject({ method: 'POST', url: '/api/rooms', payload: {} });
  ({ code } = room.json() as { code: string });
});

afterAll(async () => {
  await server.app.close();
});

describe('watchlist privada pre-asta', () => {
  it('vacía por defecto; guardar, leer y reemplazar la lista completa', async () => {
    expect((await get()).json()).toEqual({ entries: [] });

    const entries: WatchlistEntry[] = [
      { playerId: 5841, maxPrice: 25 },
      { playerId: 2170, maxPrice: null },
    ];
    const saved = await put(entries);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ entries });
    expect((await get()).json()).toEqual({ entries });

    // PUT reemplaza la lista completa (no mergea)
    const replaced = await put([{ playerId: 133, maxPrice: 3 }]);
    expect(replaced.json()).toEqual({ entries: [{ playerId: 133, maxPrice: 3 }] });
    expect((await get()).json()).toEqual({ entries: [{ playerId: 133, maxPrice: 3 }] });
  });

  it('es privada: cada usuario ve solo la suya', async () => {
    const betoList = await server.app.inject({
      method: 'GET',
      url: `/api/rooms/${code}/watchlist`,
      cookies: beto,
    });
    expect(betoList.json()).toEqual({ entries: [] }); // no ve la de Ana

    await put([{ playerId: 999, maxPrice: 1 }], beto);
    expect((await get()).json()).toEqual({ entries: [{ playerId: 133, maxPrice: 3 }] }); // la de Ana intacta
  });

  it('validaciones 400: no-array, >100, playerId inválido, maxPrice inválido, duplicados', async () => {
    expect((await put('no-array')).statusCode).toBe(400);
    expect((await put(Array.from({ length: 101 }, (_, i) => ({ playerId: i, maxPrice: null })))).statusCode).toBe(400);
    expect((await put([{ playerId: 'x', maxPrice: null }])).statusCode).toBe(400);
    expect((await put([{ playerId: 1, maxPrice: 0 }])).statusCode).toBe(400);
    expect((await put([{ playerId: 1, maxPrice: 2.5 }])).statusCode).toBe(400);
    expect((await put([{ playerId: 1, maxPrice: null }, { playerId: 1, maxPrice: 5 }])).statusCode).toBe(400);
    // nada de eso pisó la lista guardada
    expect((await get()).json()).toEqual({ entries: [{ playerId: 133, maxPrice: 3 }] });
  });

  it('pizarra: slot y note se guardan y devuelven; validaciones y retrocompat', async () => {
    // PUT/GET con slot+note (note con trim; vacía → null; campos extra se stripean)
    const saved = await put([
      { playerId: 5841, maxPrice: 25, slot: 0, note: '  titolare  ', extra: 'fuera' },
      { playerId: 2170, maxPrice: null, slot: null, note: null },
      { playerId: 133, maxPrice: 3, note: '' },
    ]);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({
      entries: [
        { playerId: 5841, maxPrice: 25, slot: 0, note: 'titolare' },
        { playerId: 2170, maxPrice: null, slot: null, note: null },
        { playerId: 133, maxPrice: 3, note: null },
      ],
    });
    expect((await get()).json()).toEqual(saved.json());

    // validaciones
    expect((await put([{ playerId: 1, maxPrice: null, slot: -1 }])).statusCode).toBe(400);
    expect((await put([{ playerId: 1, maxPrice: null, slot: 50 }])).statusCode).toBe(400);
    expect((await put([{ playerId: 1, maxPrice: null, slot: 1.5 }])).statusCode).toBe(400);
    expect((await put([{ playerId: 1, maxPrice: null, note: 'x'.repeat(41) }])).statusCode).toBe(400);
    expect((await put([{ playerId: 1, maxPrice: null, note: 42 }])).statusCode).toBe(400);
    expect((await put([{ playerId: 49, maxPrice: null, slot: 49 }])).statusCode).toBe(200); // borde válido

    // retrocompat: una lista guardada ANTES de la pizarra (sin slot/note) sigue válida
    const me = await server.app.inject({ method: 'GET', url: '/api/auth/me', cookies: ana });
    const userId = (me.json() as { user: { id: string } }).user.id;
    server.store.setWatchlist(userId, code, [{ playerId: 7, maxPrice: 12 }]); // shape viejo, directo en la db
    expect((await get()).json()).toEqual({ entries: [{ playerId: 7, maxPrice: 12 }] });
  });

  it('401 sin sesión; 404 sala inexistente', async () => {
    const anon = await server.app.inject({ method: 'GET', url: `/api/rooms/${code}/watchlist` });
    expect(anon.statusCode).toBe(401);
    const anonPut = await server.app.inject({
      method: 'PUT',
      url: `/api/rooms/${code}/watchlist`,
      payload: { entries: [] },
    });
    expect(anonPut.statusCode).toBe(401);

    const missing = await server.app.inject({
      method: 'GET',
      url: '/api/rooms/ZZZZZZ/watchlist',
      cookies: ana,
    });
    expect(missing.statusCode).toBe(404);
  });
});
