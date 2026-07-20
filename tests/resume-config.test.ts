import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  ResumeConfigError,
  loadResumeConfig,
} from '../lib/server/resume-config.ts';

type Env = Record<string, string | undefined>;

const directKey = Buffer.alloc(32, 7).toString('base64');
const fingerprintSecret = 'resume-fingerprint-secret-32-bytes';

function enabledEnv(overrides: Env = {}): Env {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://resume:test@127.0.0.1/revolution',
    MORSE_PUBLIC_ORIGIN: 'https://resume.example',
    MORSE_RESUME_ENABLED: 'true',
    MORSE_RESUME_COOKIE: 'private_resume',
    MORSE_RESUME_STORAGE_DIR: path.join(os.tmpdir(), 'revolution-resume-storage'),
    MORSE_RESUME_ENCRYPTION_KEY: directKey,
    MORSE_RESUME_KEY_VERSION: '2',
    MORSE_RESUME_FINGERPRINT_SECRET: fingerprintSecret,
    MORSE_RESUME_TRUSTED_PROXY_HOPS: '0',
    ...overrides,
  };
}

function assertResumeError(
  run: () => unknown,
  code: string,
  forbiddenValues: string[] = [],
): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ResumeConfigError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    for (const value of forbiddenValues) {
      assert.doesNotMatch(String(error), new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    }
    return true;
  });
}

async function withTempDirectory(
  run: (directory: string) => Promise<void>,
): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'revolution-resume-config-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
  return directory;
}

test('resume config is disabled by default and ignores enabled-only settings', () => {
  assert.deepEqual(loadResumeConfig({
    DATABASE_URL: '',
    MORSE_PUBLIC_ORIGIN: 'not-an-origin',
    MORSE_RESUME_STORAGE_DIR: 'relative',
    MORSE_RESUME_ENCRYPTION_KEY: 'not-base64',
    MORSE_RESUME_ENCRYPTION_KEY_FILE: 'missing.key',
    MORSE_RESUME_KEY_VERSION: '0',
    MORSE_RESUME_FINGERPRINT_SECRET: 'short',
    MORSE_RESUME_TRUSTED_PROXY_HOPS: '6',
  }), {
    enabled: false,
    cookieName: 'morse_resume_access',
  });

  assert.deepEqual(loadResumeConfig({
    MORSE_RESUME_ENABLED: 'false',
    MORSE_RESUME_COOKIE: 'custom_resume_cookie',
  }), {
    enabled: false,
    cookieName: 'custom_resume_cookie',
  });
});

test('resume config rejects every explicit non-boolean enable value', () => {
  for (const value of ['', ' ', 'TRUE', '1', 'yes']) {
    assertResumeError(
      () => loadResumeConfig({ MORSE_RESUME_ENABLED: value }),
      'RESUME_ENABLED_INVALID',
      value.trim() ? [value] : [],
    );
  }
});

test('enabled local resume config loads a direct 32-byte canonical Base64 key', () => {
  const config = loadResumeConfig(enabledEnv());
  assert.equal(config.enabled, true);
  if (!config.enabled) assert.fail('expected enabled resume config');

  assert.equal(config.databaseUrl, 'postgresql://resume:test@127.0.0.1/revolution');
  assert.equal(config.publicOrigin, 'https://resume.example');
  assert.equal(config.cookieName, 'private_resume');
  assert.equal(config.inviteDays, 7);
  assert.equal(config.sessionHours, 72);
  assert.equal(config.auditRetentionDays, 30);
  assert.equal(config.maxPdfBytes, 10 * 1024 * 1024);
  assert.equal(config.storageDir, path.join(os.tmpdir(), 'revolution-resume-storage'));
  assert.deepEqual(config.encryptionKey, Buffer.alloc(32, 7));
  assert.equal(config.keyVersion, 2);
  assert.equal(config.fingerprintSecret, fingerprintSecret);
  assert.equal(config.trustedProxyHops, 0);
});

test('enabled local and production resume config load a trimmed key file', async () => {
  const directory = await withTempDirectory(async (temporaryDirectory) => {
    const keyFile = path.join(temporaryDirectory, 'resume.key');
    await writeFile(keyFile, `\n${directKey}\r\n`, 'utf8');

    for (const nodeEnv of ['development', 'test', 'production']) {
      const config = loadResumeConfig(enabledEnv({
        NODE_ENV: nodeEnv,
        MORSE_RESUME_ENCRYPTION_KEY: undefined,
        MORSE_RESUME_ENCRYPTION_KEY_FILE: keyFile,
      }));
      assert.equal(config.enabled, true);
      if (!config.enabled) assert.fail('expected enabled resume config');
      assert.deepEqual(config.encryptionKey, Buffer.alloc(32, 7));
    }
  });

  assert.equal(existsSync(directory), false);
});

test('resume key sources fail closed without exposing key values or file paths', async () => {
  const directory = await withTempDirectory(async (temporaryDirectory) => {
    const malformedFile = path.join(temporaryDirectory, 'malformed.key');
    const shortFile = path.join(temporaryDirectory, 'short.key');
    const missingFile = path.join(temporaryDirectory, 'missing.key');
    await writeFile(malformedFile, 'not-canonical-base64', 'utf8');
    await writeFile(shortFile, Buffer.alloc(31, 3).toString('base64'), 'utf8');

    const cases: Array<{ env: Env; forbidden: string[] }> = [
      {
        env: enabledEnv({
          MORSE_RESUME_ENCRYPTION_KEY_FILE: malformedFile,
        }),
        forbidden: [directKey, malformedFile],
      },
      {
        env: enabledEnv({
          NODE_ENV: 'production',
        }),
        forbidden: [directKey],
      },
      ...[undefined, 'staging', 'preview'].map((nodeEnv) => ({
        env: enabledEnv({ NODE_ENV: nodeEnv }),
        forbidden: [directKey],
      })),
      {
        env: enabledEnv({
          MORSE_RESUME_ENCRYPTION_KEY: undefined,
          MORSE_RESUME_ENCRYPTION_KEY_FILE: undefined,
        }),
        forbidden: [],
      },
      {
        env: enabledEnv({
          MORSE_RESUME_ENCRYPTION_KEY: undefined,
          MORSE_RESUME_ENCRYPTION_KEY_FILE: missingFile,
        }),
        forbidden: [missingFile],
      },
      {
        env: enabledEnv({
          MORSE_RESUME_ENCRYPTION_KEY: undefined,
          MORSE_RESUME_ENCRYPTION_KEY_FILE: temporaryDirectory,
        }),
        forbidden: [temporaryDirectory],
      },
      {
        env: enabledEnv({
          MORSE_RESUME_ENCRYPTION_KEY: undefined,
          MORSE_RESUME_ENCRYPTION_KEY_FILE: malformedFile,
        }),
        forbidden: [malformedFile],
      },
      {
        env: enabledEnv({
          MORSE_RESUME_ENCRYPTION_KEY: undefined,
          MORSE_RESUME_ENCRYPTION_KEY_FILE: shortFile,
        }),
        forbidden: [shortFile],
      },
      {
        env: enabledEnv({
          MORSE_RESUME_ENCRYPTION_KEY: directKey.replace(/=$/u, ''),
        }),
        forbidden: [directKey.replace(/=$/u, '')],
      },
      {
        env: enabledEnv({
          MORSE_RESUME_ENCRYPTION_KEY: Buffer.alloc(31, 4).toString('base64'),
        }),
        forbidden: [Buffer.alloc(31, 4).toString('base64')],
      },
    ];

    for (const { env, forbidden } of cases) {
      assertResumeError(
        () => loadResumeConfig(env),
        'RESUME_ENCRYPTION_KEY_INVALID',
        forbidden,
      );
    }
  });

  assert.equal(existsSync(directory), false);
});

test('enabled resume config enforces exact origins and required absolute storage', () => {
  for (const publicOrigin of [
    '',
    'https://resume.example/',
    'https://resume.example:443',
    'https://user:password@resume.example',
    'https://resume.example/private',
    'https://resume.example?mode=private',
    'https://resume.example#private',
  ]) {
    assertResumeError(
      () => loadResumeConfig(enabledEnv({ MORSE_PUBLIC_ORIGIN: publicOrigin })),
      'RESUME_PUBLIC_ORIGIN_INVALID',
      publicOrigin ? [publicOrigin] : [],
    );
  }

  for (const publicOrigin of [
    'https://resume.example',
    'http://resume.example',
    'http://127.0.0.1:3010',
    'http://localhost:3010',
    'http://[::1]:3010',
  ]) {
    const config = loadResumeConfig(enabledEnv({ MORSE_PUBLIC_ORIGIN: publicOrigin }));
    assert.equal(config.enabled, true);
    if (!config.enabled) assert.fail('expected enabled resume config');
    assert.equal(config.publicOrigin, publicOrigin);
  }

  assertResumeError(
    () => loadResumeConfig(enabledEnv({ DATABASE_URL: '' })),
    'RESUME_DATABASE_URL_INVALID',
  );
  for (const storageDir of ['', '.', path.join('relative', 'resume')]) {
    assertResumeError(
      () => loadResumeConfig(enabledEnv({ MORSE_RESUME_STORAGE_DIR: storageDir })),
      'RESUME_STORAGE_DIR_INVALID',
      storageDir ? [storageDir] : [],
    );
  }
});

test('enabled resume config bounds version, fingerprint, and trusted proxy hops', () => {
  for (const keyVersion of ['0', '-1', '1.5', '9007199254740992', 'not-a-number']) {
    assertResumeError(
      () => loadResumeConfig(enabledEnv({ MORSE_RESUME_KEY_VERSION: keyVersion })),
      'RESUME_KEY_VERSION_INVALID',
      [keyVersion],
    );
  }

  for (const fingerprint of ['', 'x'.repeat(31)]) {
    assertResumeError(
      () => loadResumeConfig(enabledEnv({ MORSE_RESUME_FINGERPRINT_SECRET: fingerprint })),
      'RESUME_FINGERPRINT_SECRET_INVALID',
      fingerprint ? [fingerprint] : [],
    );
  }

  for (const trustedProxyHops of ['-1', '6', '1.5', '9007199254740992']) {
    assertResumeError(
      () => loadResumeConfig(enabledEnv({
        MORSE_RESUME_TRUSTED_PROXY_HOPS: trustedProxyHops,
      })),
      'RESUME_TRUSTED_PROXY_HOPS_INVALID',
      [trustedProxyHops],
    );
  }

  for (const trustedProxyHops of ['0', '5']) {
    const config = loadResumeConfig(enabledEnv({
      MORSE_RESUME_TRUSTED_PROXY_HOPS: trustedProxyHops,
    }));
    assert.equal(config.enabled, true);
    if (!config.enabled) assert.fail('expected enabled resume config');
    assert.equal(config.trustedProxyHops, Number(trustedProxyHops));
  }

  const defaulted = loadResumeConfig(enabledEnv({
    MORSE_RESUME_TRUSTED_PROXY_HOPS: undefined,
  }));
  assert.equal(defaulted.enabled, true);
  if (!defaulted.enabled) assert.fail('expected enabled resume config');
  assert.equal(defaulted.trustedProxyHops, 0);
});
