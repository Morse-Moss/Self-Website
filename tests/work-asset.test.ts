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
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );

  return files.flat();
}

test('publishes only the approved sanitized login workbench crop', async () => {
  const assetPath = path.join(assetDirectory, approvedFilename);
  const png = await readFile(assetPath);

  assert.deepEqual(
    png.subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 510);
  assert.equal(png.readUInt32BE(20), 580);

  const publishedNames = await readdir(assetDirectory);
  assert.deepEqual(publishedNames, [approvedFilename]);

  const forbiddenFilenameParts = [
    'raw',
    'railway',
    'desktop-1440',
    '拓效',
    'tavix',
  ];
  for (const part of forbiddenFilenameParts) {
    assert.equal(approvedFilename.toLowerCase().includes(part.toLowerCase()), false);
  }

  const publicFiles = await listFiles(publicRoot);
  assert.equal(
    publicFiles.some((file) => path.basename(file) === sourceFilename),
    false,
  );
});
