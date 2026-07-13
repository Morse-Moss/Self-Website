import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Client } = pg;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(repoRoot, 'db', 'migrations', '001_morse_rag.sql');
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required.');
}

const client = new Client({ connectionString });

try {
  await client.connect();
  await client.query(await fs.readFile(migrationPath, 'utf8'));
  console.log('M3-RAG database migration applied.');
} finally {
  await client.end();
}
