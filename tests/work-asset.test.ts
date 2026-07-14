import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const publicRoot = path.resolve('public');
const assetDirectory = path.join(publicRoot, 'works', 'auto-operations');
const approvedFilename = 'login-workbench-2026-07-13.png';
const sourceFilename =
  'auto-operations-railway-login-desktop-1440-2026-07-13.png';

async function listFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );

  return files.flat();
}

test('does not publish the internal-project login workbench asset', async () => {
  const assetPath = path.join(assetDirectory, approvedFilename);

  await assert.rejects(readFile(assetPath), { code: 'ENOENT' });

  const publicFiles = await listFiles(publicRoot);
  assert.equal(
    publicFiles.some((file) => path.basename(file) === sourceFilename),
    false,
  );
});
