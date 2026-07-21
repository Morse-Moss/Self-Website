import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';

const compose = fs.readFileSync(path.resolve('compose.production.yaml'), 'utf8');
const caddy = fs.readFileSync(path.resolve('deploy/caddy/Caddyfile'), 'utf8');
const runtimeGrants = fs.readFileSync(path.resolve('deploy/postgres/grant-runtime.sql'), 'utf8');
const runtimeResumeVerification = fs.readFileSync(
  path.resolve('deploy/postgres/verify-resume-runtime.sql'),
  'utf8',
);
const resumeConfig = fs.readFileSync(path.resolve('lib/server/resume-config.ts'), 'utf8');
const resumeRoute = fs.readFileSync(path.resolve('app/api/admin/resume/route.ts'), 'utf8');

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface UpstreamRequest {
  method: string | undefined;
  url: string | undefined;
  contentLength: string | null;
  transferEncoding: string | null;
  bytes: number;
  completed: boolean;
  aborted: boolean;
}

function runCommand(command: string, args: string[], timeoutMs = 20_000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`${command} timed out after ${timeoutMs}ms`)));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (code) => finish(() => resolve({ code, stdout, stderr })));
  });
}

function request(port: number, {
  method = 'GET',
  requestPath,
  headers = {},
  body,
  chunkedBytes = 0,
}: {
  method?: string;
  requestPath: string;
  headers?: http.OutgoingHttpHeaders;
  body?: string | Buffer;
  chunkedBytes?: number;
}): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let source: Readable | undefined;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      source?.destroy();
      action();
    };
    const req = http.request({ host: '127.0.0.1', port, method, path: requestPath, headers }, (response) => {
      finish(() => resolve(response.statusCode ?? null));
      response.resume();
    });
    const timer = setTimeout(() => {
      req.destroy();
      finish(() => reject(new Error(`${method} ${requestPath} timed out`)));
    }, 10_000);
    req.once('error', () => finish(() => resolve(null)));
    if (chunkedBytes > 0) {
      async function* chunks() {
        let remaining = chunkedBytes;
        while (remaining > 0 && !settled) {
          const size = Math.min(64 * 1024, remaining);
          remaining -= size;
          yield Buffer.alloc(size, 1);
        }
      }
      source = Readable.from(chunks());
      source.pipe(req);
    } else {
      req.end(body);
    }
  });
}

async function reserveLoopbackPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

function serviceBlock(name: string): string {
  const start = compose.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `missing compose service ${name}`);
  const end = compose.slice(start + 3).search(/\n(?:  [a-z][a-z0-9-]*:|volumes:|secrets:|networks:)/u);
  return compose.slice(start, end === -1 ? compose.length : start + 3 + end);
}

test('private resume storage is mounted only into init, web, and worker', () => {
  for (const name of ['resume-storage-init', 'web', 'worker']) {
    assert.match(serviceBlock(name), /revolution_private_resume:\/opt\/revolution\/shared\/private\/resume/u);
  }
  for (const name of ['edge', 'embedding', 'ingest', 'migration', 'db']) {
    assert.doesNotMatch(serviceBlock(name), /revolution_private_resume/u);
  }
  assert.match(serviceBlock('resume-storage-init'), /user:\s*["']0:0["']/u);
  assert.match(serviceBlock('resume-storage-init'), /chown 1001:1001/u);
  assert.match(serviceBlock('resume-storage-init'), /chmod 0700/u);
  assert.match(compose, /revolution_private_resume:\s*$/mu);
});

test('resume encryption secret is distributed only to web', () => {
  assert.match(serviceBlock('web'), /secrets:\s*\n\s+- resume_encryption_key/u);
  assert.match(serviceBlock('web'), /MORSE_RESUME_ENCRYPTION_KEY_FILE:\s*\/run\/secrets\/resume_encryption_key/u);
  for (const name of ['resume-storage-init', 'worker', 'edge', 'embedding', 'ingest', 'migration']) {
    assert.doesNotMatch(serviceBlock(name), /resume_encryption_key|MORSE_RESUME_ENCRYPTION_KEY_FILE/u);
  }
  assert.match(compose, /resume_encryption_key:\s*\n\s+file:\s+\.\/deploy\/secrets\/resume_encryption_key/u);
});

test('deployment includes an executable runtime privilege gate for every private resume table', () => {
  assert.match(runtimeGrants, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO runtime/u);
  for (const table of ['resume_documents', 'resume_invites', 'resume_sessions', 'resume_access_events']) {
    assert.match(runtimeResumeVerification, new RegExp(`'${table}'`, 'u'));
  }
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    assert.match(runtimeResumeVerification, new RegExp(`'${privilege}'`, 'u'));
  }
  assert.match(runtimeResumeVerification, /has_table_privilege\(\s*'runtime'/u);
  assert.match(runtimeResumeVerification, /RAISE EXCEPTION/u);
});

test('edge isolates the resume upload allowance and skips private audit logs', () => {
  assert.match(caddy, /@resumeUpload\s*\{[\s\S]*method POST[\s\S]*path \/api\/admin\/resume[\s\S]*\}/u);
  assert.match(caddy, /handle @resumeUpload\s*\{[\s\S]*max_size 11MB/u);
  assert.match(caddy, /handle\s*\{[\s\S]*max_size 2MB/u);
  assert.match(caddy, /@privateResumeAuditExcluded\s*\{[\s\S]*\/api\/resume\/[\s\S]*\/api\/admin\/resume\/[\s\S]*\}/u);
  assert.match(caddy, /log_skip @privateResumeAuditExcluded/u);
});

test('application keeps the decimal ten-megabyte PDF cap', () => {
  assert.match(resumeConfig, /maxPdfBytes:\s*10\s*\*\s*1024\s*\*\s*1024/u);
  assert.match(resumeRoute, /maxPdfBytes:\s*config\.maxPdfBytes/u);
});

test('Caddy enforces body limits and excludes private resume access logs at runtime', { timeout: 40_000 }, async () => {
  const image = await runCommand('docker', ['image', 'inspect', 'caddy:2.10-alpine']);
  assert.equal(image.code, 0, 'caddy:2.10-alpine must be available locally for the deployment contract');

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'revolution-caddy-resume-'));
  const configPath = path.join(tempDir, 'Caddyfile');
  const containerName = `revolution-caddy-resume-${randomUUID()}`;
  const edgePort = await reserveLoopbackPort();
  const upstreamRequests: UpstreamRequest[] = [];
  const upstream = http.createServer((incoming, response) => {
    const received: UpstreamRequest = {
      method: incoming.method,
      url: incoming.url,
      contentLength: incoming.headers['content-length'] ?? null,
      transferEncoding: incoming.headers['transfer-encoding'] ?? null,
      bytes: 0,
      completed: false,
      aborted: false,
    };
    upstreamRequests.push(received);
    incoming.on('data', (chunk) => { received.bytes += chunk.length; });
    incoming.once('aborted', () => { received.aborted = true; });
    incoming.once('end', () => {
      received.completed = true;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '0.0.0.0', resolve));
  const address = upstream.address();
  assert.ok(address && typeof address !== 'string');
  let started = false;

  await writeFile(configPath, `{
  admin off
  auto_https off
}
:8080 {
  @resumeUpload {
    method POST
    path /api/admin/resume
  }
  @privateResumeAuditExcluded {
    path /api/resume /api/resume/* /api/admin/resume /api/admin/resume/*
  }
  log_skip @privateResumeAuditExcluded
  handle @resumeUpload {
    request_body {
      max_size 11MB
    }
    reverse_proxy host.docker.internal:${address.port}
  }
  handle {
    request_body {
      max_size 2MB
    }
    reverse_proxy host.docker.internal:${address.port}
  }
  log {
    output stdout
    format json
  }
}
`, 'utf8');

  try {
    const launch = await runCommand('docker', [
      'run', '-d', '--rm', '--name', containerName,
      '--add-host', 'host.docker.internal:host-gateway',
      '-p', `127.0.0.1:${edgePort}:8080`,
      '-v', `${configPath}:/etc/caddy/Caddyfile:ro`,
      'caddy:2.10-alpine', 'caddy', 'run',
      '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile',
    ]);
    assert.equal(launch.code, 0, launch.stderr);
    started = true;

    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await request(edgePort, { requestPath: '/api/health' }) === 200) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true);

    assert.equal(await request(edgePort, {
      method: 'POST', requestPath: '/api/admin/resume',
      headers: { 'Content-Length': '8' }, body: '12345678',
    }), 200);
    assert.equal(await request(edgePort, {
      method: 'POST', requestPath: '/api/admin/resume',
      headers: { 'Content-Length': '11000001' }, body: Buffer.alloc(11_000_001, 1),
    }), 413);
    assert.equal(await request(edgePort, {
      method: 'POST', requestPath: '/api/admin/resume',
      headers: { 'Transfer-Encoding': 'chunked' }, chunkedBytes: 11_000_001,
    }), 413);
    assert.equal(await request(edgePort, {
      method: 'POST', requestPath: '/api/not-resume',
      headers: { 'Content-Length': '2000001' }, body: Buffer.alloc(2_000_001, 1),
    }), 413);

    for (const requestPath of ['/api/resume', '/api/resume/file', '/api/admin/resume', '/api/admin/resume/invites']) {
      await request(edgePort, { requestPath });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));

    const declared = upstreamRequests.find((value) => value.contentLength === '11000001');
    const chunked = upstreamRequests.find((value) => value.transferEncoding === 'chunked');
    const defaultOversize = upstreamRequests.find((value) => value.url === '/api/not-resume');
    assert.deepEqual(
      [declared, chunked, defaultOversize].map((value) => ({
        bytes: value?.bytes,
        completed: value?.completed,
        aborted: value?.aborted,
      })),
      [
        { bytes: 11_000_000, completed: false, aborted: true },
        { bytes: 11_000_000, completed: false, aborted: true },
        { bytes: 2_000_000, completed: false, aborted: true },
      ],
    );

    const logs = await runCommand('docker', ['logs', containerName]);
    assert.equal(logs.code, 0, logs.stderr);
    const combinedLogs = `${logs.stdout}\n${logs.stderr}`;
    assert.match(combinedLogs, /"uri":"\/api\/health"/u);
    for (const privatePath of ['/api/resume', '/api/resume/file', '/api/admin/resume', '/api/admin/resume/invites']) {
      assert.doesNotMatch(combinedLogs, new RegExp(`"uri":"${privatePath.replaceAll('/', '\\/')}"`, 'u'));
    }
  } finally {
    if (started) await runCommand('docker', ['rm', '-f', containerName]);
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(tempDir, { force: true, recursive: true });
  }
});
