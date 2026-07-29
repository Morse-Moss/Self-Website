import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatEvidenceCatalogV2 } from '../lib/contracts/chat-evidence-catalog.ts';
import {
  compileChatEvidenceCatalog,
  matchCatalogCapabilities,
} from '../lib/server/chat-evidence-catalog.ts';
import { chatEvidenceCatalog, siteContent } from '../lib/site-content.ts';

test('catalog v2 resolves every project, capability and evidence reference', () => {
  const catalog = compileChatEvidenceCatalog(siteContent, chatEvidenceCatalog);

  assert.equal(catalog.version, 2);
  assert.deepEqual(
    catalog.projects.map((entry) => entry.slug),
    siteContent.projects.map((project) => project.slug),
  );
  assert.deepEqual(
    [...catalog.capabilities.keys()].sort(),
    chatEvidenceCatalog.capabilities.map((entry) => entry.id).sort(),
  );
  assert.deepEqual(catalog.unresolvedReferences, []);
});

test('Vibe Coding maps to audited AI programming evidence', () => {
  const catalog = compileChatEvidenceCatalog(siteContent, chatEvidenceCatalog);
  const matches = matchCatalogCapabilities('Vibe Coding', catalog);

  assert.deepEqual(matches.map((item) => item.id), ['ai-programming-collaboration']);
  assert.equal(matches[0]?.evidenceClass, 'direct');
  assert.ok(matches[0]?.direct.some((ref) => ref.resumeFactId === 'ai-application-role'));
});

test('Cursor remains unavailable and is not promoted by project text', () => {
  const catalog = compileChatEvidenceCatalog(siteContent, chatEvidenceCatalog);
  const [cursor] = matchCatalogCapabilities('Cursor', catalog);

  assert.equal(cursor?.evidenceClass, 'unavailable');
  assert.deepEqual(cursor?.direct, []);
  assert.deepEqual(cursor?.transferable, []);
  assert.ok(cursor?.unavailableBoundary);
});

test('normalization conflicts and unknown references fail closed', () => {
  const conflictingFixture: ChatEvidenceCatalogV2 = {
    ...chatEvidenceCatalog,
    capabilities: chatEvidenceCatalog.capabilities.map((entry, index) => (
      index === 1 ? { ...entry, aliases: [...entry.aliases, 'Ｋ８Ｓ'] } : entry
    )),
  };
  const unknownReferenceFixture: ChatEvidenceCatalogV2 = {
    ...chatEvidenceCatalog,
    capabilities: chatEvidenceCatalog.capabilities.map((entry, index) => (
      index === 0
        ? {
            ...entry,
            evidenceRefs: [
              ...entry.evidenceRefs,
              { kind: 'resume_fact', resumeFactId: 'missing-fact', level: 'direct' },
            ],
          }
        : entry
    )),
  };

  assert.throws(
    () => compileChatEvidenceCatalog(siteContent, conflictingFixture),
    /CHAT_EVIDENCE_CATALOG_INVALID/u,
  );
  assert.throws(
    () => compileChatEvidenceCatalog(siteContent, unknownReferenceFixture),
    /CHAT_EVIDENCE_CATALOG_INVALID/u,
  );
});
