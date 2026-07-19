import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const publicRoot = path.resolve('public');
const assetDirectory = path.join(publicRoot, 'works', 'auto-operations');
const approvedFilename = 'login-workbench-2026-07-13.png';
const sourceFilename =
  'auto-operations-railway-login-desktop-1440-2026-07-13.png';
const digitalMorseAssetDirectory = path.join(publicRoot, 'works', 'digital-morse');
const digitalMorseFilename = 'digital-morse-main-local-2026-07-19.png';
const deepResearchAssetDirectory = path.join(publicRoot, 'works', 'deep-research');
const deepResearchFilename = 'operator-workbench-example.png';
const aiLeadgenAssetDirectory = path.join(publicRoot, 'works', 'ai-leadgen');
const aiLeadgenFilename = 'graphite-dashboard-real-2026-07-19.png';

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

test('publishes one approved Digital Morse interface screenshot', async () => {
  const files = await listFiles(digitalMorseAssetDirectory);

  assert.deepEqual(files.map((file) => path.basename(file)), [digitalMorseFilename]);
  const image = await readFile(path.join(digitalMorseAssetDirectory, digitalMorseFilename));
  assert.ok(image.length > 10_000);
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('publishes one approved deep-research Operator Workbench screenshot', async () => {
  const files = await listFiles(deepResearchAssetDirectory);

  assert.deepEqual(files.map((file) => path.basename(file)), [deepResearchFilename]);
  const image = await readFile(path.join(deepResearchAssetDirectory, deepResearchFilename));
  assert.ok(image.length > 100_000);
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('publishes the confirmed AI leadgen Graphite dashboard without pixel changes', async () => {
  const files = await listFiles(aiLeadgenAssetDirectory);

  assert.deepEqual(files.map((file) => path.basename(file)), [aiLeadgenFilename]);
  const image = await readFile(path.join(aiLeadgenAssetDirectory, aiLeadgenFilename));
  assert.ok(image.length > 300_000);
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(
    createHash('sha256').update(image).digest('hex').toUpperCase(),
    '026404371270ECAB10313A9F505677740A7621910DDCF33DDA180D6F5C3310D7',
  );
});
