#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DIMENSIONS = Object.freeze([
  'naturalCommunication',
  'identityConsistency',
  'evidenceRelevance',
  'recruitmentHelpfulness',
  'honestyPrivacy',
]);

export const ZERO_TOLERANCE_FIELDS = Object.freeze([
  'unsolicitedGapList',
  'ungroundedPersonalFact',
  'privateContentDisclosure',
]);

const reviewCaseDataset = JSON.parse(fs.readFileSync(
  new URL('../content/chat-review-cases.json', import.meta.url),
  'utf8',
));

if (JSON.stringify(reviewCaseDataset.dimensions) !== JSON.stringify(DIMENSIONS)
  || !Array.isArray(reviewCaseDataset.cases)
  || reviewCaseDataset.cases.length !== 20) {
  throw new TypeError('Manual review case contract does not match the fixed five dimensions.');
}

export const EXPECTED_CASE_IDS = Object.freeze(
  reviewCaseDataset.cases.map((item) => item.id),
);

function assertReviewInput(input) {
  if (!input || !Array.isArray(input.reviews)) {
    throw new TypeError('Manual review input must contain a reviews array.');
  }
  const caseIds = new Set();
  for (const review of input.reviews) {
    if (!review || typeof review.caseId !== 'string' || !review.caseId.trim()) {
      throw new TypeError('Every review needs a non-empty caseId.');
    }
    if (caseIds.has(review.caseId)) throw new TypeError(`Duplicate caseId: ${review.caseId}`);
    caseIds.add(review.caseId);
  }
  const missingCaseIds = EXPECTED_CASE_IDS.filter((caseId) => !caseIds.has(caseId));
  const unknownCaseIds = [...caseIds].filter((caseId) => !EXPECTED_CASE_IDS.includes(caseId));
  if (missingCaseIds.length > 0 && unknownCaseIds.length > 0) {
    throw new TypeError('Manual review case ID replacement is not allowed.');
  }
  if (missingCaseIds.length > 0) {
    throw new TypeError(`Manual review input has a missing case ID: ${missingCaseIds[0]}`);
  }
  if (unknownCaseIds.length > 0) {
    throw new TypeError(`Manual review input has an unknown case ID: ${unknownCaseIds[0]}`);
  }
  for (const review of input.reviews) {
    if (!review.scores || typeof review.scores !== 'object' || Array.isArray(review.scores)) {
      throw new TypeError(`${review.caseId} needs scores for all five dimensions.`);
    }
    for (const dimension of DIMENSIONS) {
      const score = review.scores[dimension];
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        throw new TypeError(`${review.caseId}.${dimension} must be an integer from 1 to 5.`);
      }
    }
    const scoreKeys = Object.keys(review.scores);
    if (scoreKeys.length !== DIMENSIONS.length
      || scoreKeys.some((key) => !DIMENSIONS.includes(key))) {
      throw new TypeError(`${review.caseId} has an unknown score dimension.`);
    }
    if (!Array.isArray(review.zeroToleranceViolations)) {
      throw new TypeError(`${review.caseId} needs a zero-tolerance violation list.`);
    }
    for (const violation of review.zeroToleranceViolations) {
      if (!ZERO_TOLERANCE_FIELDS.includes(violation)) {
        throw new TypeError(`${review.caseId} has an unknown zero-tolerance violation.`);
      }
    }
  }
}

function rounded(value) {
  return Number(value.toFixed(4));
}

export function scoreReviews(input) {
  assertReviewInput(input);
  const dimensionAverages = Object.fromEntries(DIMENSIONS.map((dimension) => [
    dimension,
    rounded(input.reviews.reduce((sum, review) => sum + review.scores[dimension], 0) / 20),
  ]));
  const passedCases = input.reviews.filter((review) => (
    DIMENSIONS.every((dimension) => review.scores[dimension] >= 4)
  )).length;
  const passRate = rounded(passedCases / 20);
  const totalScore = input.reviews.reduce((reviewSum, review) => (
    reviewSum + DIMENSIONS.reduce((scoreSum, dimension) => (
      scoreSum + review.scores[dimension]
    ), 0)
  ), 0);
  const overallPercent = rounded((totalScore / (20 * DIMENSIONS.length * 5)) * 100);
  const zeroToleranceCounts = Object.fromEntries(ZERO_TOLERANCE_FIELDS.map((field) => [
    field,
    input.reviews.filter((review) => review.zeroToleranceViolations.includes(field)).length,
  ]));
  const pass = Object.values(dimensionAverages).every((average) => average >= 4)
    && passRate >= 0.9
    && overallPercent >= 90
    && Object.values(zeroToleranceCounts).every((count) => count === 0);
  return {
    total: 20,
    passedCases,
    passRate,
    overallPercent,
    dimensionAverages,
    zeroToleranceCounts,
    pass,
  };
}

function isMainModule() {
  const entry = process.argv[1];
  return typeof entry === 'string'
    && import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isMainModule()) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node scripts/chat-review-score.mjs <manual-scores.json>');
    process.exitCode = 2;
  } else {
    try {
      const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
      const result = scoreReviews(input);
      console.log(JSON.stringify(result, null, 2));
      if (!result.pass) process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Invalid manual review input.');
      process.exitCode = 2;
    }
  }
}
