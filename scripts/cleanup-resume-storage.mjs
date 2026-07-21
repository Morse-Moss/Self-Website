import path from 'node:path';
import { readdir, rm, stat } from 'node:fs/promises';

const DEFAULT_MINIMUM_AGE_MS = 24 * 60 * 60_000;
const CIPHERTEXT_NAME = /^[0-9a-f-]+\.morsepdf$/u;

/**
 * @param {{pool: {query: (sql: string, values?: unknown[]) => Promise<any>}, storageDir: string, now?: Date|string, minimumAgeMs?: number}} input
 */
export async function cleanupResumeStorage({
  pool,
  storageDir,
  now = new Date(),
  minimumAgeMs = DEFAULT_MINIMUM_AGE_MS,
}) {
  if (!pool) throw new Error('RESUME_STORAGE_POOL_REQUIRED');
  if (!storageDir?.trim()) throw new Error('RESUME_STORAGE_DIR_REQUIRED');
  if (!Number.isFinite(minimumAgeMs) || minimumAgeMs < 0) throw new Error('RESUME_STORAGE_AGE_INVALID');
  const cleanupNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(cleanupNow.getTime())) throw new Error('RESUME_STORAGE_NOW_INVALID');
  const cutoff = cleanupNow.getTime() - minimumAgeMs;
  const rows = await pool.query('SELECT storage_name FROM resume_documents');
  const referenced = new Set(rows.rows.map((row) => String(row.storage_name)));
  const entries = await readdir(storageDir, { withFileTypes: true });
  let deletedFiles = 0;
  let retainedFiles = 0;
  let deletedTempFiles = 0;
  let retainedTempFiles = 0;

  for (const entry of entries) {
    if (!entry.isFile() || (!CIPHERTEXT_NAME.test(entry.name) && !entry.name.endsWith('.tmp'))) continue;
    const fullPath = path.join(storageDir, entry.name);
    let metadata;
    try {
      metadata = await stat(fullPath);
    } catch {
      continue;
    }
    if (entry.name.endsWith('.tmp')) {
      if (metadata.mtimeMs <= cutoff) {
        await rm(fullPath, { force: true });
        deletedTempFiles += 1;
      } else {
        retainedTempFiles += 1;
      }
      continue;
    }
    if (referenced.has(entry.name) || metadata.mtimeMs > cutoff) {
      retainedFiles += 1;
      continue;
    }
    await rm(fullPath, { force: true });
    deletedFiles += 1;
  }

  return { deletedFiles, retainedFiles, deletedTempFiles, retainedTempFiles };
}
