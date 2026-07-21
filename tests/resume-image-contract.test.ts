import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { scanExtractedRoot } from '../scripts/scan-private-resume-image.mjs';

async function withRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'revolution-image-contract-'));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test('image scanner permits server-side resume identifiers without private artifacts', async () => {
  await withRoot(async (root) => {
    await mkdir(path.join(root, 'app'), { recursive: true });
    await writeFile(
      path.join(root, 'app', 'server.js'),
      "const table = 'resume_documents'; const signature = '%PDF-';",
    );
    const result = await scanExtractedRoot(root, { secretCanaries: ['canary-not-present'] });
    assert.equal(result.filesScanned, 1);
  });
});

test('image scanner rejects PDF files, secret values, env files and populated private directories', async () => {
  const cases: Array<{ name: string; code: string; prepare(root: string): Promise<void> }> = [
    {
      name: 'pdf',
      code: 'IMAGE_PDF_BYTES_FOUND',
      async prepare(root) { await writeFile(path.join(root, 'leak.bin'), '%PDF-1.7\nsynthetic'); },
    },
    {
      name: 'marker',
      code: 'IMAGE_PRIVATE_MARKER_FOUND',
      async prepare(root) { await writeFile(path.join(root, 'leak.txt'), 'SYNTHETIC_PRIVATE_RESUME_MARKER_7F42'); },
    },
    {
      name: 'canary',
      code: 'IMAGE_SECRET_VALUE_FOUND',
      async prepare(root) { await writeFile(path.join(root, 'leak.txt'), 'synthetic-secret-canary'); },
    },
    {
      name: 'env',
      code: 'IMAGE_ENV_FILE_FOUND',
      async prepare(root) { await writeFile(path.join(root, '.env.production'), 'NO_REAL_SECRET=true'); },
    },
    {
      name: 'ciphertext',
      code: 'IMAGE_CIPHERTEXT_FOUND',
      async prepare(root) { await writeFile(path.join(root, '00000000-0000-0000-0000-000000000000.morsepdf'), 'cipher'); },
    },
    {
      name: 'private-dir',
      code: 'IMAGE_PRIVATE_DIRECTORY_POPULATED',
      async prepare(root) {
        await mkdir(path.join(root, 'private-resume'), { recursive: true });
        await writeFile(path.join(root, 'private-resume', 'data.bin'), 'cipher');
      },
    },
  ];

  for (const fixture of cases) {
    await withRoot(async (root) => {
      await fixture.prepare(root);
      await assert.rejects(
        scanExtractedRoot(root, { secretCanaries: ['synthetic-secret-canary'] }),
        (error: unknown) => error instanceof Error && error.message === fixture.code,
        fixture.name,
      );
    });
  }
});
