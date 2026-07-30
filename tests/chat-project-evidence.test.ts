import assert from 'node:assert/strict';
import { test } from 'node:test';

import { siteContent } from '../lib/site-content.ts';
import { approvedProjectSource } from '../lib/server/chat-project-evidence.ts';

test('approved project evidence preserves audited ownership facts', () => {
  const project = siteContent.projects.find((entry) => entry.slug === 'content-agent');
  assert.ok(project);
  assert.ok(project.ownership);

  const evidence = approvedProjectSource(project);

  assert.match(evidence.content, new RegExp(project.ownership));
});
