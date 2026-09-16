// migrate.js — SQL migration runner (Step 4)
//
// Reads every *.sql file from the migrations/ directory in numeric order.
// Each file runs exactly once; applied migrations are tracked in the
// `schema_migrations` table. Safe to call on every server start.
//
// Usage:  import { runMigrations } from './migrate.js';
//         await runMigrations(pool);

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

export async function runMigrations(pool) {
  // Bootstrap the tracking table — must exist before we query it.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         SERIAL PRIMARY KEY,
      filename   TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort(); // lexicographic = numeric because we use 0001_, 0002_, …

  const { rows: applied } = await pool.query('SELECT filename FROM schema_migrations');
  const appliedSet = new Set(applied.map(r => r.filename));

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`  [migrate] applying ${file} …`);
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      console.log(`  [migrate] ✓ ${file}`);
    } catch (err) {
      await pool.query('ROLLBACK');
      console.error(`  [migrate] ✗ ${file}: ${err.message}`);
      throw err;
    }
  }
}
