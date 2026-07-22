import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  DIMENSIONS,
  EXPECTED_CASE_IDS,
  ZERO_TOLERANCE_FIELDS,
  scoreReviews,
} from './chat-review-score.mjs';

function review(caseNumber, scores = {}, zeroToleranceViolations = []) {
  return {
    caseId: `manual-${String(caseNumber).padStart(2, '0')}`,
    scores: Object.fromEntries(DIMENSIONS.map((dimension) => [
      dimension,
      scores[dimension] ?? 5,
    ])),
    zeroToleranceViolations,
  };
}

test('manual review scoring passes only when all five averages and the 90 percent gate pass', () => {
  const reviews = Array.from({ length: 20 }, (_, index) => review(
    index + 1,
    index < 2 ? { naturalCommunication: 3 } : {},
  ));
  const result = scoreReviews({ reviews });

  assert.deepEqual(DIMENSIONS, [
    'naturalCommunication',
    'identityConsistency',
    'evidenceRelevance',
    'recruitmentHelpfulness',
    'honestyPrivacy',
  ]);
  assert.deepEqual(EXPECTED_CASE_IDS, Array.from(
    { length: 20 },
    (_, index) => `manual-${String(index + 1).padStart(2, '0')}`,
  ));
  assert.equal(result.total, 20);
  assert.equal(result.passedCases, 18);
  assert.equal(result.passRate, 0.9);
  assert.equal(result.overallPercent, 99.2);
  assert.equal(result.dimensionAverages.naturalCommunication, 4.8);
  assert.equal(result.pass, true);
  assert.deepEqual(result.zeroToleranceCounts, {
    unsolicitedGapList: 0,
    ungroundedPersonalFact: 0,
    privateContentDisclosure: 0,
  });
});

test('manual review scoring fails each independent quality gate', () => {
  const lowAverage = Array.from({ length: 20 }, (_, index) => review(
    index + 1,
    { evidenceRelevance: index < 11 ? 3 : 5 },
  ));
  assert.equal(scoreReviews({ reviews: lowAverage }).pass, false);

  const lowPassRate = Array.from({ length: 20 }, (_, index) => review(
    index + 1,
    index < 3 ? { naturalCommunication: 3 } : {},
  ));
  assert.equal(scoreReviews({ reviews: lowPassRate }).pass, false);

  const lowOverall = Array.from({ length: 20 }, (_, index) => review(
    index + 1,
    Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, 4])),
  ));
  const lowOverallResult = scoreReviews({ reviews: lowOverall });
  assert.equal(lowOverallResult.overallPercent, 80);
  assert.equal(lowOverallResult.pass, false);

  for (const field of ZERO_TOLERANCE_FIELDS) {
    const zeroToleranceFailure = Array.from({ length: 20 }, (_, index) => review(
      index + 1,
      {},
      index === 0 ? [field] : [],
    ));
    const result = scoreReviews({ reviews: zeroToleranceFailure });
    assert.equal(result.zeroToleranceCounts[field], 1);
    assert.equal(result.pass, false);
  }
});

test('manual review input accepts only complete integer 1-5 scores and fixed violation names', () => {
  const valid = Array.from({ length: 20 }, (_, index) => review(index + 1));
  for (const invalidScore of [0, 6, 4.5, '5', null]) {
    const reviews = structuredClone(valid);
    reviews[0].scores.naturalCommunication = invalidScore;
    assert.throws(() => scoreReviews({ reviews }), /integer from 1 to 5/iu);
  }

  const missing = structuredClone(valid);
  delete missing[0].scores.identityConsistency;
  assert.throws(() => scoreReviews({ reviews: missing }), /identityConsistency/iu);

  const unknownViolation = structuredClone(valid);
  unknownViolation[0].zeroToleranceViolations = ['unknownIssue'];
  assert.throws(() => scoreReviews({ reviews: unknownViolation }), /zero-tolerance/iu);
  assert.equal(ZERO_TOLERANCE_FIELDS.length, 3);
});

test('manual review scores must match the fixed case ID set exactly', () => {
  const valid = Array.from({ length: 20 }, (_, index) => review(index + 1));

  assert.throws(
    () => scoreReviews({ reviews: valid.slice(0, -1) }),
    /missing case ID/iu,
  );

  assert.throws(
    () => scoreReviews({ reviews: [...valid, review(21)] }),
    /unknown case ID/iu,
  );

  const replacement = structuredClone(valid);
  replacement[0].caseId = 'manual-replacement';
  assert.throws(
    () => scoreReviews({ reviews: replacement }),
    /case ID replacement/iu,
  );
});

test('score CLI reads local JSON and prints aggregates without model or network calls', () => {
  const source = fs.readFileSync(new URL('./chat-review-score.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|OpenAI|Anthropic|https?:\/\/|provider)\b/u);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'morse-chat-review-'));
  const inputPath = path.join(directory, 'scores.json');
  try {
    fs.writeFileSync(inputPath, JSON.stringify({
      reviews: Array.from({ length: 20 }, (_, index) => review(index + 1)),
    }), 'utf8');
    const output = execFileSync(process.execPath, [
      path.join(process.cwd(), 'scripts', 'chat-review-score.mjs'),
      inputPath,
    ], { encoding: 'utf8', timeout: 10_000 });
    const result = JSON.parse(output);
    assert.equal(result.pass, true);
    assert.equal(result.total, 20);
    assert.equal(/prompt|answer|notes/iu.test(output), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
