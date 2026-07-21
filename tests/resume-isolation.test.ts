import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server.js';
import path from 'node:path';
import { test } from 'node:test';

import { buildSystemInstructions, normalizeChatRequest } from '../lib/server/chat-core.ts';
import { extractPublicKnowledge } from '../lib/server/public-knowledge.ts';

const marker = 'SYNTHETIC_PRIVATE_RESUME_MARKER_7F42';
const syntheticPdf = Buffer.from(`%PDF-1.7\n${marker}\n%%EOF`, 'utf8');

async function collectFiles(directory: string): Promise<string[]> {
  if (!fs.existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(entryPath));
    if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

test('public knowledge ignores synthetic private resume fields and bytes', () => {
  const content = JSON.parse(fs.readFileSync(path.resolve('content/site-content.json'), 'utf8'));
  const withPrivateResume = {
    ...content,
    privateResume: {
      trustedPersonNote: marker,
      pdf: syntheticPdf,
      storagePath: '/opt/revolution/shared/private/resume/private.morsepdf',
    },
  };
  const documents = extractPublicKnowledge(withPrivateResume);
  const serialized = JSON.stringify(documents);

  assert.doesNotMatch(serialized, new RegExp(marker, 'u'));
  assert.doesNotMatch(serialized, /%PDF-|resume_documents|private[\\/]resume|trustedPersonNote/i);
});

test('chat authentication and provider inputs are independent of the resume cookie', () => {
  const chatToken = 'synthetic-chat-token';
  const resumeToken = 'synthetic-resume-token';
  const requests = {
    chatOnly: new NextRequest('http://localhost/api/chat', {
      headers: { cookie: `morse_access=${chatToken}` },
    }),
    resumeOnly: new NextRequest('http://localhost/api/chat', {
      headers: { cookie: `morse_resume_access=${resumeToken}` },
    }),
    both: new NextRequest('http://localhost/api/chat', {
      headers: { cookie: `morse_access=${chatToken}; morse_resume_access=${resumeToken}` },
    }),
  };

  const normalized = normalizeChatRequest({ message: 'Explain the public portfolio.' });
  const providerRequest = {
    messages: [{ role: 'user', content: normalized.message }],
    instructions: buildSystemInstructions(normalized.mode, normalized.audienceIntent, []),
  };
  const capture = (request: NextRequest) => (
    request.cookies.get('morse_access')?.value === chatToken
      ? structuredClone(providerRequest)
      : null
  );
  const chatOnly = capture(requests.chatOnly);
  const resumeOnly = capture(requests.resumeOnly);
  const both = capture(requests.both);
  assert.equal(resumeOnly, null);
  assert.deepEqual(both, chatOnly);
  assert.doesNotMatch(JSON.stringify(both), /morse_resume_access|resume_documents|private[\\/]resume|trustedPersonNote/i);

  const chatRoute = fs.readFileSync(path.resolve('app/api/chat/route.ts'), 'utf8');
  assert.match(chatRoute, /request\.cookies\.get\(config\.cookieName\)/u);
  assert.match(chatRoute, /if \(!session\) return jsonError\('ACCESS_REQUIRED', 401\)/u);
  assert.doesNotMatch(chatRoute, /morse_resume_access|resume-(?:access|storage|config|admin|http)|resume_documents/u);
});

test('public and browser build artifacts contain no synthetic private resume bytes or identifiers', async () => {
  const files = [
    ...await collectFiles(path.resolve('public')),
    ...await collectFiles(path.resolve('content')),
    ...await collectFiles(path.resolve('.next/static')),
  ];
  for (const file of files) {
    const bytes = await readFile(file);
    const serialized = bytes.toString('utf8');
    assert.notEqual(bytes.subarray(0, 5).toString('ascii'), '%PDF-', file);
    assert.doesNotMatch(serialized, new RegExp(marker, 'u'), file);
    assert.doesNotMatch(serialized, /morse_resume_access|resume_documents/u, file);
  }

  for (const file of await collectFiles(path.resolve('.next/server'))) {
    const bytes = await readFile(file);
    assert.notEqual(bytes.subarray(0, 5).toString('ascii'), '%PDF-', file);
    assert.doesNotMatch(bytes.toString('utf8'), new RegExp(marker, 'u'), file);
  }

  for (const name of ['index.html', 'index.rsc', 'works.html', 'works.rsc']) {
    const file = path.resolve('.next/server/app', name);
    if (!fs.existsSync(file)) continue;
    const serialized = await readFile(file, 'utf8');
    assert.doesNotMatch(
      serialized,
      /SYNTHETIC_PRIVATE_RESUME_MARKER_7F42|%PDF-|morse_resume_access|resume_documents|private[\\/]resume|trustedPersonNote/i,
      file,
    );
  }
});

test('Docker build context excludes every local private resume artifact form', () => {
  const dockerignore = fs.readFileSync(path.resolve('.dockerignore'), 'utf8');
  assert.match(dockerignore, /^private$/mu);
  assert.match(dockerignore, /^private-resume$/mu);
  assert.match(dockerignore, /^\*\.morsepdf$/mu);
});
