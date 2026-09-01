import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/** Abre (creando el directorio si hace falta) la base SQLite compartida del server. */
export function openDatabase(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return db;
}
