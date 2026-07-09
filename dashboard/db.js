import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH || '/data/hse.db';
const SCHEMA_PATH = process.env.SCHEMA_PATH || join(__dirname, 'sql', 'schema.sql');
const SEED_PATH = process.env.SEED_PATH || join(__dirname, 'sql', 'seed.sql');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

// Seed de demo: solo si se pide explícitamente y la base está vacía.
if (process.env.SEED_DEMO === 'true') {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM observaciones').get();
  if (n === 0) {
    db.exec(readFileSync(SEED_PATH, 'utf8'));
    console.log('[db] Base vacía: datos de demostración cargados.');
  }
}

export const folio = (id) => `OBS-${String(id).padStart(4, '0')}`;
