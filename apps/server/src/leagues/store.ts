import { randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { LeagueAuctionInfo, LeagueMemberInfo, LeagueSummary, User } from '@fanta/shared';
import { hashPassword, verifyPassword } from './passwords.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

export interface InviteRow {
  token: string;
  league_id: string;
  email: string;
  created_by: string;
  accepted_by: string | null;
  created_at: number;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  /** null = cuenta "passwordless" creada por claim (identidad liviana por email). */
  pass_hash: string | null;
}

interface LeagueRow {
  id: string;
  name: string;
  admin_user_id: string;
  member_count: number;
}

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name };
}

function toSummary(row: LeagueRow): LeagueSummary {
  return { id: row.id, name: row.name, adminUserId: row.admin_user_id, memberCount: row.member_count };
}

const LEAGUE_SELECT = `
  SELECT l.id, l.name, l.admin_user_id,
         (SELECT COUNT(*) FROM league_members m WHERE m.league_id = l.id) AS member_count
  FROM leagues l
`;

/** Usuarios, sesiones, ligas, invitaciones y tickets de sala — todo en el mismo SQLite. */
export class LeagueStore {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
  ) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        pass_hash TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leagues (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        admin_user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS league_members (
        league_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (league_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS invites (
        token TEXT PRIMARY KEY,
        league_id TEXT NOT NULL,
        email TEXT NOT NULL,
        created_by TEXT NOT NULL,
        accepted_by TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS league_auctions (
        room_code TEXT PRIMARY KEY,
        league_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS room_tickets (
        room_code TEXT NOT NULL,
        user_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        PRIMARY KEY (room_code, user_id)
      );
    `);
    this.migrateNullablePassHash();
  }

  /**
   * Migración: bases creadas antes del modo passwordless tienen users.pass_hash
   * NOT NULL — SQLite no permite quitar la restricción con ALTER, así que se
   * recrea la tabla conservando los datos (los hashes existentes quedan).
   */
  private migrateNullablePassHash(): void {
    const cols = this.db.pragma('table_info(users)') as Array<{ name: string; notnull: number }>;
    const passHash = cols.find((c) => c.name === 'pass_hash');
    if (!passHash || passHash.notnull === 0) return;
    this.db.exec(`
      BEGIN;
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        pass_hash TEXT,
        created_at INTEGER NOT NULL
      );
      INSERT INTO users_new (id, email, name, pass_hash, created_at)
        SELECT id, email, name, pass_hash, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT;
    `);
  }

  // ── Usuarios y sesiones ──────────────────────────────────────────────────

  /**
   * Registro clásico. Si el email ya existe CON contraseña → 'email_taken'.
   * Si existe SIN contraseña (cuenta creada por claim), la ADOPTA: actualiza
   * el nombre, setea la contraseña y la deja protegida.
   */
  createUser(email: string, name: string, password: string): User | 'email_taken' {
    const existing = this.userRowByEmail(email);
    if (existing) {
      if (existing.pass_hash !== null) return 'email_taken';
      this.db
        .prepare('UPDATE users SET name = ?, pass_hash = ? WHERE id = ?')
        .run(name, hashPassword(password), existing.id);
      return { id: existing.id, email: existing.email, name };
    }
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO users (id, email, name, pass_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, email, name, hashPassword(password), this.now());
    return { id, email, name };
  }

  /**
   * Identidad liviana por email: encuentra o crea el usuario SIN contraseña.
   * - email nuevo → crea (requiere name)
   * - email sin contraseña → reusa (actualiza name si vino)
   * - email protegido con contraseña → 'has_password' (la web pide login)
   */
  claimUser(email: string, name: string | undefined): User | 'has_password' | 'name_required' {
    const existing = this.userRowByEmail(email);
    if (existing) {
      if (existing.pass_hash !== null) return 'has_password';
      if (name) {
        this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, existing.id);
        return { id: existing.id, email: existing.email, name };
      }
      return toUser(existing);
    }
    if (!name) return 'name_required';
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO users (id, email, name, pass_hash, created_at) VALUES (?, ?, ?, NULL, ?)')
      .run(id, email, name, this.now());
    return { id, email, name };
  }

  /** Setea/cambia la contraseña (protege una cuenta passwordless). */
  setPassword(userId: string, password: string): boolean {
    const r = this.db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(password), userId);
    return r.changes > 0;
  }

  /**
   * Login clásico. 'passwordless' = la cuenta existe pero no tiene contraseña
   * (que la web sugiera entrar directo con el email vía claim).
   */
  verifyLogin(email: string, password: string): User | 'passwordless' | null {
    const row = this.userRowByEmail(email);
    if (!row) return null;
    if (row.pass_hash === null) return 'passwordless';
    if (!verifyPassword(password, row.pass_hash)) return null;
    return toUser(row);
  }

  private userRowByEmail(email: string): UserRow | undefined {
    return this.db.prepare('SELECT id, email, name, pass_hash FROM users WHERE email = ?').get(email) as
      | UserRow
      | undefined;
  }

  getUser(id: string): User | null {
    const row = this.db.prepare('SELECT id, email, name, pass_hash FROM users WHERE id = ?').get(id) as
      | UserRow
      | undefined;
    return row ? toUser(row) : null;
  }

  createSession(userId: string): string {
    const token = randomBytes(32).toString('hex');
    const now = this.now();
    this.db
      .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, userId, now, now + SESSION_TTL_MS);
    return token;
  }

  getUserBySession(token: string): User | null {
    const row = this.db
      .prepare(
        `SELECT u.id, u.email, u.name, u.pass_hash, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
      )
      .get(token) as (UserRow & { expires_at: number }) | undefined;
    if (!row) return null;
    if (row.expires_at <= this.now()) {
      this.deleteSession(token);
      return null;
    }
    return toUser(row);
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  // ── Ligas ────────────────────────────────────────────────────────────────

  createLeague(name: string, adminUserId: string): LeagueSummary {
    const id = randomUUID();
    const now = this.now();
    this.db
      .prepare('INSERT INTO leagues (id, name, admin_user_id, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name, adminUserId, now);
    this.addMember(id, adminUserId);
    return { id, name, adminUserId, memberCount: 1 };
  }

  getLeague(id: string): LeagueSummary | null {
    const row = this.db.prepare(`${LEAGUE_SELECT} WHERE l.id = ?`).get(id) as LeagueRow | undefined;
    return row ? toSummary(row) : null;
  }

  leaguesForUser(userId: string): LeagueSummary[] {
    const rows = this.db
      .prepare(
        `${LEAGUE_SELECT} JOIN league_members mm ON mm.league_id = l.id
         WHERE mm.user_id = ? ORDER BY l.created_at`,
      )
      .all(userId) as LeagueRow[];
    return rows.map(toSummary);
  }

  isMember(leagueId: string, userId: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?')
      .get(leagueId, userId);
  }

  addMember(leagueId: string, userId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO league_members (league_id, user_id, joined_at) VALUES (?, ?, ?)')
      .run(leagueId, userId, this.now());
  }

  getMembers(leagueId: string): LeagueMemberInfo[] {
    const rows = this.db
      .prepare(
        `SELECT u.id AS userId, u.name, u.email, m.joined_at AS joinedAt
         FROM league_members m JOIN users u ON u.id = m.user_id
         WHERE m.league_id = ? ORDER BY m.joined_at`,
      )
      .all(leagueId) as LeagueMemberInfo[];
    return rows;
  }

  // ── Invitaciones ─────────────────────────────────────────────────────────

  /** Devuelve la invitación pendiente para ese email en la liga, o crea una nueva. */
  createOrReuseInvite(leagueId: string, email: string, createdBy: string): InviteRow {
    const pending = this.db
      .prepare('SELECT * FROM invites WHERE league_id = ? AND email = ? COLLATE NOCASE AND accepted_by IS NULL')
      .get(leagueId, email) as InviteRow | undefined;
    if (pending) return pending;
    const row: InviteRow = {
      token: randomUUID(),
      league_id: leagueId,
      email,
      created_by: createdBy,
      accepted_by: null,
      created_at: this.now(),
    };
    this.db
      .prepare('INSERT INTO invites (token, league_id, email, created_by, accepted_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.token, row.league_id, row.email, row.created_by, row.accepted_by, row.created_at);
    return row;
  }

  getInvite(token: string): InviteRow | null {
    return (this.db.prepare('SELECT * FROM invites WHERE token = ?').get(token) as InviteRow | undefined) ?? null;
  }

  getInvitesForLeague(leagueId: string): InviteRow[] {
    return this.db
      .prepare('SELECT * FROM invites WHERE league_id = ? ORDER BY created_at')
      .all(leagueId) as InviteRow[];
  }

  markInviteAccepted(token: string, userId: string): void {
    this.db.prepare('UPDATE invites SET accepted_by = ? WHERE token = ? AND accepted_by IS NULL').run(userId, token);
  }

  // ── Astas de liga y tickets de sala ──────────────────────────────────────

  linkAuction(roomCode: string, leagueId: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO league_auctions (room_code, league_id, created_at) VALUES (?, ?, ?)')
      .run(roomCode, leagueId, this.now());
  }

  getAuctions(leagueId: string): LeagueAuctionInfo[] {
    return this.db
      .prepare('SELECT room_code AS roomCode, created_at AS createdAt FROM league_auctions WHERE league_id = ? ORDER BY created_at')
      .all(leagueId) as LeagueAuctionInfo[];
  }

  /** Liga a la que pertenece una sala, o null si es una sala "suelta" (flujo por código). */
  leagueForRoom(roomCode: string): LeagueSummary | null {
    const row = this.db
      .prepare(
        `${LEAGUE_SELECT} JOIN league_auctions a ON a.league_id = l.id WHERE a.room_code = ?`,
      )
      .get(roomCode) as LeagueRow | undefined;
    return row ? toSummary(row) : null;
  }

  /** participantId ESTABLE por (sala, usuario): se genera una vez y se persiste. */
  getOrCreateTicket(roomCode: string, userId: string): string {
    const row = this.db
      .prepare('SELECT participant_id FROM room_tickets WHERE room_code = ? AND user_id = ?')
      .get(roomCode, userId) as { participant_id: string } | undefined;
    if (row) return row.participant_id;
    const participantId = randomUUID();
    this.db
      .prepare('INSERT INTO room_tickets (room_code, user_id, participant_id) VALUES (?, ?, ?)')
      .run(roomCode, userId, participantId);
    return participantId;
  }
}
