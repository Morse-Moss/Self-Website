import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseActivateRouteInput,
  parseCatalogQuery,
  parseConnectionCreateInput,
  parseConnectionUpdateInput,
  parseDeleteInput,
  parseEnvironmentTakeoverInput,
  parseEventQuery,
  parseModelInput,
  parseModelMutationInput,
  parsePasswordInput,
  ProviderConfigInputError,
} from '../lib/server/provider-config-input.ts';

test('connection input accepts the exact loopback Mock only in local release smoke mode', () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    MORSE_LOCAL_RELEASE_SMOKE: process.env.MORSE_LOCAL_RELEASE_SMOKE,
    MORSE_PROVIDER_MOCK_ORIGIN: process.env.MORSE_PROVIDER_MOCK_ORIGIN,
  };
  Object.assign(process.env, {
    NODE_ENV: 'test',
    MORSE_LOCAL_RELEASE_SMOKE: 'true',
    MORSE_PROVIDER_MOCK_ORIGIN: 'http://127.0.0.1:18092',
  });
  try {
    const parsed = parseConnectionCreateInput({
      apiKey: 'synthetic',
      baseUrl: 'http://127.0.0.1:18092/v1',
      firstModel: model,
      name: 'Loopback',
      password: 'password',
      userAgent: null,
    });
    assert.equal(parsed.baseUrl, 'http://127.0.0.1:18092/v1');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

const model = {
  displayName: 'Primary model',
  modelId: 'gpt-compatible',
  protocol: 'responses',
  reasoningEffort: 'high',
  maxOutputTokens: 4096,
  inputUsdPerMillion: '1.25',
  outputUsdPerMillion: null,
};
const normalizedModel = { ...model, contextWindowTokens: null };

function invalid(run: () => unknown): void {
  assert.throws(run, (error: unknown) => (
    error instanceof ProviderConfigInputError && error.code === 'AI_CONFIG_INVALID'
  ));
}

test('connection create and update inputs are strict and normalize safe values', () => {
  assert.deepEqual(parseConnectionCreateInput({
    name: ' Gateway ',
    baseUrl: 'https://gateway.example/v1/',
    userAgent: ' Morse/1.0 ',
    apiKey: 'secret',
    firstModel: model,
    password: 'admin-password',
  }), {
    name: 'Gateway',
    baseUrl: 'https://gateway.example/v1',
    userAgent: 'Morse/1.0',
    apiKey: 'secret',
    firstModel: normalizedModel,
    password: 'admin-password',
  });

  assert.deepEqual(parseConnectionUpdateInput({
    name: 'Gateway v2',
    baseUrl: 'https://other.example/v1',
    userAgent: null,
    apiKey: null,
    reuseKeyAcrossOrigin: true,
    password: 'admin-password',
  }), {
    name: 'Gateway v2',
    baseUrl: 'https://other.example/v1',
    userAgent: null,
    apiKey: null,
    reuseKeyAcrossOrigin: true,
    password: 'admin-password',
  });

  invalid(() => parseConnectionCreateInput({
    name: 'Gateway', baseUrl: 'https://gateway.example/v1?key=bad', apiKey: 'secret',
    firstModel: model, password: 'admin-password', headers: { authorization: 'bad' },
  }));
  invalid(() => parseConnectionUpdateInput({
    name: 'Gateway', baseUrl: 'https://gateway.example/v1', password: 'admin-password',
    method: 'POST', reuseKeyAcrossOrigin: false,
  }));
});

test('model input enforces protocol, reasoning, token, decimal, and unknown-field bounds', () => {
  assert.deepEqual(parseModelInput(model), normalizedModel);
  assert.deepEqual(parseModelInput({
    ...model,
    reasoningEffort: null,
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 100000,
  }), {
    ...model,
    contextWindowTokens: null,
    reasoningEffort: null,
    inputUsdPerMillion: '0',
    outputUsdPerMillion: '100000',
  });
  invalid(() => parseModelInput({ ...model, protocol: 'assistants' }));
  invalid(() => parseModelInput({ ...model, reasoningEffort: 'extreme' }));
  invalid(() => parseModelInput({ ...model, maxOutputTokens: 2_147_483_648 }));
  invalid(() => parseModelInput({ ...model, contextWindowTokens: 2_147_483_648 }));
  invalid(() => parseModelInput({ ...model, inputUsdPerMillion: -1 }));
  invalid(() => parseModelInput({ ...model, temperature: 0.7 }));
  assert.deepEqual(parseModelMutationInput({ ...model, password: 'admin-password' }), {
    model: normalizedModel,
    password: 'admin-password',
  });
  invalid(() => parseModelMutationInput(null));
  invalid(() => parseModelMutationInput({ ...model, password: 'admin-password', headers: {} }));
});

test('model capabilities accept unknown values and PostgreSQL positive integer bounds', () => {
  let nullableCapabilities: ReturnType<typeof parseModelInput> | null = null;
  assert.doesNotThrow(() => {
    nullableCapabilities = parseModelInput({
      ...model,
      contextWindowTokens: null,
      maxOutputTokens: null,
    });
  });
  assert.deepEqual(nullableCapabilities, {
    ...model,
    contextWindowTokens: null,
    maxOutputTokens: null,
  });
  assert.deepEqual(parseModelInput({
    ...model,
    contextWindowTokens: '',
    maxOutputTokens: '',
  }), {
    ...model,
    contextWindowTokens: null,
    maxOutputTokens: null,
  });
  assert.deepEqual(parseModelInput({
    ...model,
    contextWindowTokens: 2_147_483_647,
    maxOutputTokens: 2_147_483_647,
  }), {
    ...model,
    contextWindowTokens: 2_147_483_647,
    maxOutputTokens: 2_147_483_647,
  });

  const {
    maxOutputTokens: _maxOutputTokens,
    ...withoutCapabilities
  } = model;
  assert.deepEqual(parseModelInput(withoutCapabilities), {
    ...withoutCapabilities,
    contextWindowTokens: null,
    maxOutputTokens: null,
  });

  for (const capabilities of [
    { contextWindowTokens: 0, maxOutputTokens: null },
    { contextWindowTokens: 1.5, maxOutputTokens: null },
    { contextWindowTokens: Number.MAX_SAFE_INTEGER, maxOutputTokens: null },
    { contextWindowTokens: null, maxOutputTokens: 0 },
    { contextWindowTokens: null, maxOutputTokens: 1.5 },
    { contextWindowTokens: null, maxOutputTokens: Number.MAX_SAFE_INTEGER },
  ]) {
    invalid(() => parseModelInput({ ...model, ...capabilities }));
  }
});

test('environment takeover input is strict and uses null as the only URL inheritance sentinel', () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  const expectedConfigDigest = 'a'.repeat(64);
  assert.deepEqual(parseEnvironmentTakeoverInput({
    apiKey: null,
    baseUrl: null,
    expectedConfigDigest,
    firstModel: model,
    name: ' Editable primary ',
    password: 'admin-password',
    requestId,
    reuseKeyAcrossOrigin: false,
    userAgent: ' Morse/1.0 ',
  }), {
    apiKey: null,
    baseUrl: null,
    expectedConfigDigest,
    firstModel: normalizedModel,
    name: 'Editable primary',
    password: 'admin-password',
    requestId,
    reuseKeyAcrossOrigin: false,
    userAgent: 'Morse/1.0',
  });

  assert.deepEqual(parseEnvironmentTakeoverInput({
    apiKey: 'replacement-secret',
    baseUrl: 'https://replacement.example/v1/',
    expectedConfigDigest,
    firstModel: model,
    name: 'Replacement',
    password: 'admin-password',
    requestId,
    reuseKeyAcrossOrigin: true,
    userAgent: null,
  }), {
    apiKey: 'replacement-secret',
    baseUrl: 'https://replacement.example/v1',
    expectedConfigDigest,
    firstModel: normalizedModel,
    name: 'Replacement',
    password: 'admin-password',
    requestId,
    reuseKeyAcrossOrigin: true,
    userAgent: null,
  });

  for (const invalidInput of [
    { apiKey: '', baseUrl: null, requestId, expectedConfigDigest, reuseKeyAcrossOrigin: false },
    { baseUrl: '', requestId, expectedConfigDigest, reuseKeyAcrossOrigin: false },
    { baseUrl: 42, requestId, expectedConfigDigest, reuseKeyAcrossOrigin: false },
    { baseUrl: null, requestId: 'not-a-uuid', expectedConfigDigest, reuseKeyAcrossOrigin: false },
    { baseUrl: null, requestId, expectedConfigDigest: 'A'.repeat(64), reuseKeyAcrossOrigin: false },
    { baseUrl: null, requestId, expectedConfigDigest, reuseKeyAcrossOrigin: 'false' },
  ]) {
    invalid(() => parseEnvironmentTakeoverInput({
      apiKey: null,
      firstModel: model,
      name: 'Invalid takeover',
      password: 'admin-password',
      userAgent: null,
      ...invalidInput,
    }));
  }

  invalid(() => parseEnvironmentTakeoverInput({
    baseUrl: null,
    expectedConfigDigest,
    firstModel: model,
    name: 'Missing API Key sentinel',
    password: 'admin-password',
    requestId,
    reuseKeyAcrossOrigin: false,
    userAgent: null,
  }));

  invalid(() => parseEnvironmentTakeoverInput({
    apiKey: null,
    baseUrl: null,
    expectedConfigDigest,
    firstModel: model,
    name: 'Invalid takeover',
    password: 'admin-password',
    requestId,
    reuseKeyAcrossOrigin: false,
    userAgent: null,
    headers: { authorization: 'secret' },
  }));
});

test('activation input accepts one to six typed unique targets and rejects ambiguous shapes', () => {
  const databaseModelId = '11111111-1111-4111-8111-111111111111';
  const databaseModelVersionId = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(parseActivateRouteInput({
    expectedActiveRevision: 7,
    password: 'admin-password',
    targets: [
      { source: 'database', modelId: databaseModelId, modelVersionId: databaseModelVersionId },
      { source: 'environment', environmentTargetKey: 'fallback-1' },
    ],
  }), {
    expectedActiveRevision: 7,
    password: 'admin-password',
    targets: [
      { source: 'database', modelId: databaseModelId, modelVersionId: databaseModelVersionId },
      { source: 'environment', environmentTargetKey: 'fallback-1' },
    ],
  });

  invalid(() => parseActivateRouteInput({
    expectedActiveRevision: 0,
    password: 'admin-password',
    targets: [],
  }));
  invalid(() => parseActivateRouteInput({
    expectedActiveRevision: 1,
    password: 'admin-password',
    targets: [
      { source: 'environment', environmentTargetKey: 'primary' },
      { source: 'environment', environmentTargetKey: 'primary' },
    ],
  }));
  invalid(() => parseActivateRouteInput({
    expectedActiveRevision: 1,
    password: 'admin-password',
    targets: [{ source: 'database', modelId: databaseModelId, environmentTargetKey: 'primary' }],
  }));
  invalid(() => parseActivateRouteInput({
    expectedActiveRevision: 1,
    password: 'admin-password',
    targets: [{ source: 'database', modelId: databaseModelId }],
  }));
  assert.deepEqual(parseActivateRouteInput({
    expectedActiveRevision: 7,
    password: 'admin-password',
    rollbackToPrevious: true,
  }), {
    expectedActiveRevision: 7,
    password: 'admin-password',
    rollbackToPrevious: true,
    targets: [],
  });
  invalid(() => parseActivateRouteInput({
    expectedActiveRevision: 7,
    password: 'admin-password',
    rollbackToPrevious: true,
    targets: [{ source: 'environment', environmentTargetKey: 'primary' }],
  }));
});

test('operation, deletion, and pagination inputs are explicit and bounded', () => {
  assert.deepEqual(parsePasswordInput({ password: 'admin-password' }), { password: 'admin-password' });
  assert.deepEqual(parseDeleteInput({
    password: 'admin-password',
    confirmationName: 'Gateway',
  }), { password: 'admin-password', confirmationName: 'Gateway' });
  assert.deepEqual(parseCatalogQuery(new URLSearchParams('page=2&limit=25&includeDeleted=true')), {
    page: 2, limit: 25, includeDeleted: true,
  });
  assert.deepEqual(parseEventQuery(new URLSearchParams('page=3&limit=50')), {
    page: 3, limit: 50,
  });
  invalid(() => parsePasswordInput({ password: 'admin-password', prompt: 'bill me' }));
  invalid(() => parseDeleteInput({ password: 'admin-password', confirmationName: '' }));
  invalid(() => parseCatalogQuery(new URLSearchParams('page=0&limit=101')));
  invalid(() => parseEventQuery(new URLSearchParams('page=1&limit=20&includeSecret=true')));
});
