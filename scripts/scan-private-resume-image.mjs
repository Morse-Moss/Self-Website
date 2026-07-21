import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PRIVATE_MARKER = ['SYNTHETIC_PRIVATE', 'RESUME_MARKER_7F42'].join('_');
const PRIVATE_DIRECTORY_NAMES = new Set(['private', 'private-resume', 'private_resume']);
const RESUME_SECRET_FILE_NAMES = new Set(['resume_encryption_key']);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanRoot = path.join(repoRoot, 'tmp', 'resume-image-scan');

function stableError(code) {
  return new Error(code);
}

async function run(command, args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (action) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(stableError('IMAGE_SCAN_COMMAND_TIMEOUT')));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', () => finish(() => reject(stableError('IMAGE_SCAN_COMMAND_FAILED'))));
    child.once('close', (code) => finish(() => resolve({ code, stdout, stderr })));
  });
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(entryPath));
    if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function classifyPath(root, file) {
  const relative = path.relative(root, file);
  const segments = relative.split(path.sep);
  const basename = segments.at(-1) ?? '';
  if (basename === '.env' || basename.startsWith('.env.')) throw stableError('IMAGE_ENV_FILE_FOUND');
  if (basename.endsWith('.morsepdf')) throw stableError('IMAGE_CIPHERTEXT_FOUND');
  if (RESUME_SECRET_FILE_NAMES.has(basename)) throw stableError('IMAGE_RESUME_SECRET_FILE_FOUND');
  if (segments.slice(0, -1).some((segment) => PRIVATE_DIRECTORY_NAMES.has(segment))) {
    throw stableError('IMAGE_PRIVATE_DIRECTORY_POPULATED');
  }
}

async function scanFile(file, secretCanaries) {
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(5);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead === 5 && header.toString('ascii') === '%PDF-') {
      throw stableError('IMAGE_PDF_BYTES_FOUND');
    }
  } finally {
    await handle.close();
  }

  const needles = [PRIVATE_MARKER, ...secretCanaries]
    .filter((value) => typeof value === 'string' && value.length >= 8)
    .map((value) => Buffer.from(value, 'utf8'));
  const marker = Buffer.from(PRIVATE_MARKER, 'utf8');
  const maximumNeedle = Math.max(1, ...needles.map((needle) => needle.length));
  let tail = Buffer.alloc(0);
  for await (const chunk of createReadStream(file)) {
    const data = tail.length ? Buffer.concat([tail, chunk]) : chunk;
    if (data.includes(marker)) throw stableError('IMAGE_PRIVATE_MARKER_FOUND');
    for (const needle of needles.slice(1)) {
      if (data.includes(needle)) throw stableError('IMAGE_SECRET_VALUE_FOUND');
    }
    tail = data.subarray(Math.max(0, data.length - maximumNeedle + 1));
  }
}

export async function scanExtractedRoot(root, { secretCanaries = [] } = {}) {
  const resolvedRoot = path.resolve(root);
  const files = await collectFiles(resolvedRoot);
  for (const file of files) {
    classifyPath(resolvedRoot, file);
    await scanFile(file, secretCanaries);
  }
  return { filesScanned: files.length };
}

function validateTarEntries(output) {
  for (const entry of output.split(/\r?\n/u).filter(Boolean)) {
    const normalized = entry.replaceAll('\\', '/');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw stableError('IMAGE_TAR_PATH_INVALID');
    }
  }
}

function parseSecretCanaries(env) {
  const raw = env.MORSE_IMAGE_SCAN_SECRET_CANARIES?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) throw new Error();
    return parsed;
  } catch {
    throw stableError('IMAGE_SCAN_CANARIES_INVALID');
  }
}

export async function scanImage(image, { env = process.env } = {}) {
  if (!image?.trim()) throw stableError('IMAGE_SCAN_IMAGE_REQUIRED');
  const runId = randomUUID();
  const containerName = `revolution-private-resume-scan-${runId}`;
  const workDir = path.join(scanRoot, runId);
  const archivePath = path.join(workDir, 'rootfs.tar');
  const extractedRoot = path.join(workDir, 'rootfs');
  let created = false;
  await mkdir(extractedRoot, { recursive: true });
  try {
    const create = await run('docker', ['create', '--name', containerName, image]);
    if (create.code !== 0) throw stableError('IMAGE_SCAN_CONTAINER_CREATE_FAILED');
    created = true;
    const exported = await run('docker', ['export', '--output', archivePath, containerName]);
    if (exported.code !== 0) throw stableError('IMAGE_SCAN_EXPORT_FAILED');
    const listed = await run('tar', ['-tf', archivePath]);
    if (listed.code !== 0) throw stableError('IMAGE_SCAN_ARCHIVE_LIST_FAILED');
    validateTarEntries(listed.stdout);
    const extracted = await run('tar', ['-xf', archivePath, '-C', extractedRoot]);
    if (extracted.code !== 0) throw stableError('IMAGE_SCAN_ARCHIVE_EXTRACT_FAILED');
    return await scanExtractedRoot(extractedRoot, {
      secretCanaries: parseSecretCanaries(env),
    });
  } finally {
    if (created) await run('docker', ['rm', '-f', containerName]).catch(() => undefined);
    await rm(workDir, { force: true, recursive: true });
  }
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  scanImage(process.argv[2], { env: process.env }).then((result) => {
    console.log(JSON.stringify({ ok: true, ...result }));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : 'IMAGE_SCAN_FAILED');
    process.exitCode = 1;
  });
}
