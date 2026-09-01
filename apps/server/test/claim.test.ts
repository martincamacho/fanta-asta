import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { User } from '@fanta/shared';
import { LeagueStore } from '../src/leagues/store.js';
import { hashPassword } from '../src/leagues/passwords.js';
import { createServer, type FantaServer } from '../src/server.js';

let server: FantaServer;

function cookieOf(res: { cookies: Array<{ name: string; value: string }> }): Record<string, string> {
  const c = res.cookies.find((x) => x.name === 'fanta_session');
  if (!c) throw new Error('sin cookie de sesión');
  return { fanta_session: c.value };
}

async function claim(email: string, name?: string) {
  return server.app.inject({ method: 'POST', url: '/api/auth/claim', payload: { email, name } });
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:' });
  await server.app.ready();
});

afterAll(async () => {
  await server.app.close();
});

describe('identidad unificada por email (claim, passwordless-lite)', () => {
  it('claim crea el usuario sin contraseña, abre sesión, reusa y renombra', async () => {
    const created = await claim('lite@test.com', 'Squadra Lite');
    expect(created.statusCode).toBe(200);
    const { user } = created.json() as { user: User };
    expect(user).toMatchObject({ email: 'lite@test.com', name: 'Squadra Lite' });

    const me = await server.app.inject({ method: 'GET', url: '/api/auth/me', cookies: cookieOf(created) });
    expect(me.statusCode).toBe(200);

    // reusa ("otro dispositivo"): mismo usuario, sesión nueva
    const reused = await claim('LITE@test.com'); // sin name y case-insensitive
    expect(reused.statusCode).toBe(200);
    expect((reused.json() as { user: User }).user.id).toBe(user.id);
    expect((reused.json() as { user: User }).user.name).toBe('Squadra Lite');

    // renombra si viene name
    const renamed = await claim('lite@test.com', 'Nuova Squadra');
    expect((renamed.json() as { user: User }).user).toMatchObject({ id: user.id, name: 'Nuova Squadra' });

    // validaciones como register
    expect((await claim('no-es-email', 'X')).statusCode).toBe(400);
    expect((await claim('nuevo@test.com')).statusCode).toBe(400); // email nuevo requiere name
  });

  it('claim de un email protegido con contraseña → 409 needsPassword', async () => {
    await server.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'protegido@test.com', name: 'Protegido', password: 'secreta1' },
    });
    const res = await claim('protegido@test.com', 'Intruso');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ needsPassword: true });
    expect((res.json() as { error: string }).error).toBeTruthy();
  });

  it('set-password protege la cuenta: claim posterior 409, login funciona', async () => {
    const c = await claim('paso@test.com', 'Paso');
    const cookies = cookieOf(c);
    const userId = (c.json() as { user: User }).user.id;

    const short = await server.app.inject({
      method: 'POST',
      url: '/api/auth/set-password',
      payload: { password: '123' },
      cookies,
    });
    expect(short.statusCode).toBe(400);
    const anon = await server.app.inject({
      method: 'POST',
      url: '/api/auth/set-password',
      payload: { password: '123456' },
    });
    expect(anon.statusCode).toBe(401);

    const ok = await server.app.inject({
      method: 'POST',
      url: '/api/auth/set-password',
      payload: { password: 'nueva-clave' },
      cookies,
    });
    expect(ok.statusCode).toBe(204);

    expect((await claim('paso@test.com')).statusCode).toBe(409); // ahora está protegida
    const login = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'paso@test.com', password: 'nueva-clave' },
    });
    expect(login.statusCode).toBe(200);
    expect((login.json() as { user: User }).user.id).toBe(userId);
  });

  it('login sobre cuenta passwordless → 401 distinguible {passwordless: true}', async () => {
    await claim('senzapass@test.com', 'Senza');
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'senzapass@test.com', password: 'loquesea' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ passwordless: true });

    // password mala en cuenta protegida: 401 genérico SIN el flag
    const generic = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'protegido@test.com', password: 'mala' },
    });
    expect(generic.statusCode).toBe(401);
    expect((generic.json() as { passwordless?: boolean }).passwordless).toBeUndefined();
  });

  it('register sobre email passwordless ADOPTA la cuenta (mismo id) y la protege', async () => {
    const c = await claim('adoptame@test.com', 'Original');
    const originalId = (c.json() as { user: User }).user.id;

    const reg = await server.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'adoptame@test.com', name: 'Adoptada', password: 'secreta1' },
    });
    expect(reg.statusCode).toBe(200); // no 409: adopción
    expect((reg.json() as { user: User }).user).toMatchObject({ id: originalId, name: 'Adoptada' });

    expect((await claim('adoptame@test.com')).statusCode).toBe(409); // quedó protegida
    const login = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'adoptame@test.com', password: 'secreta1' },
    });
    expect((login.json() as { user: User }).user.id).toBe(originalId);
  });

  it('flujo QR completo: claim → ticket en sala suelta → mismo participantId desde otro dispositivo', async () => {
    const room = await server.app.inject({ method: 'POST', url: '/api/rooms', payload: {} });
    const { code } = room.json() as { code: string };

    const device1 = await claim('movil@test.com', 'Squadra Movil');
    const t1 = await server.app.inject({
      method: 'GET',
      url: `/api/rooms/${code}/ticket`,
      cookies: cookieOf(device1),
    });
    expect(t1.statusCode).toBe(200);
    const ticket1 = t1.json() as { participantId: string; name: string };
    expect(ticket1.name).toBe('Squadra Movil');

    // "otro dispositivo": nuevo claim = otra cookie, mismo email
    const device2 = await claim('movil@test.com');
    const t2 = await server.app.inject({
      method: 'GET',
      url: `/api/rooms/${code}/ticket`,
      cookies: cookieOf(device2),
    });
    expect((t2.json() as { participantId: string }).participantId).toBe(ticket1.participantId);
  });
});

describe('migración users.pass_hash → nullable', () => {
  it('recrea la tabla vieja (NOT NULL) conservando usuarios y hashes', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fanta-users-mig-'));
    const dbPath = path.join(dir, 'fanta.sqlite');

    // Esquema pre-passwordless con un usuario legado
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        pass_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    raw
      .prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)')
      .run('legacy-1', 'legacy@test.com', 'Legacy', hashPassword('vieja-clave'), 0);
    raw.close();

    const db = new Database(dbPath);
    const store = new LeagueStore(db);

    // el usuario legado conserva su hash y sigue protegido
    const login = store.verifyLogin('legacy@test.com', 'vieja-clave');
    expect(login).toMatchObject({ id: 'legacy-1', name: 'Legacy' });
    expect(store.claimUser('legacy@test.com', 'X')).toBe('has_password');

    // y ahora la columna acepta NULL: claim crea passwordless
    const lite = store.claimUser('nuevo@test.com', 'Nuevo');
    expect(lite).toMatchObject({ email: 'nuevo@test.com' });
    expect(store.verifyLogin('nuevo@test.com', 'da igual')).toBe('passwordless');
    db.close();
  });
});
