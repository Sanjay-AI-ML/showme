import 'dotenv/config';
import { backup, DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = resolve(process.env.DATA_DIR ?? 'data', 'showme.sqlite');
const destination = process.argv[2] ? resolve(process.argv[2]) : '';
if (!destination) throw new Error('Usage: npm run backup -- <destination.sqlite>');
if (destination === source) throw new Error('Backup destination must differ from the live database.');
if (!existsSync(source)) throw new Error(`Database does not exist: ${source}`);
if (existsSync(destination)) throw new Error(`Backup already exists: ${destination}`);
mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(source);
try {
  await backup(db, destination);
  chmodSync(destination, 0o600);
  const copy = new DatabaseSync(destination, { readOnly: true });
  try {
    const result = copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (result.integrity_check !== 'ok') throw new Error('Backup failed integrity check.');
  } finally { copy.close(); }
  console.log(`Verified SQLite backup: ${destination}`);
} finally { db.close(); }
