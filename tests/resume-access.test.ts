import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ResumeAccessError } from '../lib/server/resume-access.ts';

test('resume invitation failures expose one stable code without trusted-person notes', () => {
  const error = new ResumeAccessError('RESUME_INVITE_UNAVAILABLE');
  const publicShape = JSON.stringify({ code: error.code, message: error.message });

  assert.equal(error.name, 'ResumeAccessError');
  assert.equal(error.code, 'RESUME_INVITE_UNAVAILABLE');
  assert.equal(error.message, 'RESUME_INVITE_UNAVAILABLE');
  assert.doesNotMatch(publicShape, /Synthetic Trusted Person|trusted_person_note/iu);
});
