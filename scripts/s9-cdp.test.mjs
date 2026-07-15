import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const helperUrl = new URL('./lib/s9-cdp.mjs', import.meta.url);
const harnessUrl = new URL('./s9-visual-smoke.mjs', import.meta.url);

async function loadHelpers() {
  assert.ok(existsSync(helperUrl), 'scripts/lib/s9-cdp.mjs must exist');
  return import(helperUrl.href);
}

async function loadHarness() {
  assert.ok(existsSync(harnessUrl), 'scripts/s9-visual-smoke.mjs must exist');
  return import(harnessUrl.href);
}

function createFakeFs({ content, mtimeMs }) {
  const reads = [];
  return {
    reads,
    readFileSync(filePath, encoding) {
      reads.push({ filePath, encoding });
      if (content instanceof Error) throw content;
      return content;
    },
    statSync(filePath) {
      assert.equal(filePath, reads.at(-1)?.filePath);
      return { mtimeMs };
    },
  };
}

test('owned DevToolsActivePort yields only the exact profile browser endpoint', async () => {
  const { readOwnedDevToolsActivePort } = await loadHelpers();
  const profileDir = path.resolve('C:/Temp/revolution-s9-edge-owned');
  const fsApi = createFakeFs({
    content: '43117\n/devtools/browser/abc-123_DEF\n',
    mtimeMs: 2_000,
  });

  const endpoint = readOwnedDevToolsActivePort({
    fsApi,
    profileDir,
    startedAtMs: 1_000,
  });

  assert.deepEqual(endpoint, {
    browserPath: '/devtools/browser/abc-123_DEF',
    browserWebSocketUrl: 'ws://127.0.0.1:43117/devtools/browser/abc-123_DEF',
    cdpBase: 'http://127.0.0.1:43117',
    port: 43117,
  });
  assert.deepEqual(fsApi.reads, [{
    encoding: 'utf8',
    filePath: path.join(profileDir, 'DevToolsActivePort'),
  }]);
});

test('owned DevToolsActivePort rejects malformed and stale profile files', async () => {
  const { readOwnedDevToolsActivePort } = await loadHelpers();
  const profileDir = path.resolve('C:/Temp/revolution-s9-edge-owned');
  const invalidContents = [
    '',
    '0\n/devtools/browser/id\n',
    '65536\n/devtools/browser/id\n',
    '43117\n/json/version\n',
    '43117\n/devtools/browser/id/extra\n',
    '43117\n/devtools/browser/id?secret=value\n',
    '43117\n/devtools/browser/id\nextra\n',
  ];

  for (const content of invalidContents) {
    assert.throws(
      () => readOwnedDevToolsActivePort({
        fsApi: createFakeFs({ content, mtimeMs: 2_000 }),
        profileDir,
        startedAtMs: 1_000,
      }),
      (error) => error?.code === 'OWNED_ENDPOINT_INVALID',
    );
  }

  assert.throws(
    () => readOwnedDevToolsActivePort({
      fsApi: createFakeFs({
        content: '43117\n/devtools/browser/id\n',
        mtimeMs: 999,
      }),
      profileDir,
      startedAtMs: 1_000,
    }),
    (error) => error?.code === 'OWNED_ENDPOINT_STALE',
  );
});

test('owned endpoint polling is bounded and retries only a missing file', async () => {
  const { waitForOwnedDevToolsActivePort } = await loadHelpers();
  const profileDir = path.resolve('C:/Temp/revolution-s9-edge-owned');
  let reads = 0;
  let nowMs = 1_000;
  const waits = [];
  const fsApi = {
    readFileSync() {
      reads += 1;
      if (reads < 3) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      return '43117\n/devtools/browser/id\n';
    },
    statSync() {
      return { mtimeMs: 1_000 };
    },
  };

  const endpoint = await waitForOwnedDevToolsActivePort({
    fsApi,
    isProcessExited: () => false,
    now: () => nowMs,
    poll: async (milliseconds) => {
      waits.push(milliseconds);
      nowMs += milliseconds;
    },
    profileDir,
    startedAtMs: 1_000,
    timeoutMs: 500,
  });

  assert.equal(endpoint.browserWebSocketUrl, 'ws://127.0.0.1:43117/devtools/browser/id');
  assert.equal(reads, 3);
  assert.deepEqual(waits, [50, 50]);

  await assert.rejects(
    waitForOwnedDevToolsActivePort({
      fsApi: {
        readFileSync() {
          const error = new Error('missing');
          error.code = 'ENOENT';
          throw error;
        },
        statSync() {
          throw new Error('unreachable');
        },
      },
      isProcessExited: () => false,
      now: (() => {
        let value = 0;
        return () => (value += 50);
      })(),
      poll: async () => {},
      profileDir,
      startedAtMs: 0,
      timeoutMs: 100,
    }),
    (error) => error?.code === 'OWNED_ENDPOINT_TIMEOUT',
  );
});

class FakeSocket {
  static instances = [];

  constructor() {
    this.readyState = 0;
    this.closeCalls = 0;
    this.listeners = new Map();
    this.sent = [];
    FakeSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type, detail = {}) {
    if (type === 'open') this.readyState = 1;
    if (type === 'close') this.readyState = 3;
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ type, ...detail });
    }
  }

  send(payload) {
    this.sent.push(payload);
  }

  close() {
    this.closeCalls += 1;
    this.readyState = 3;
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

test('CDP connect timeout disposes listeners and closes the unfinished socket', async () => {
  const { connectCdpTransport } = await loadHelpers();
  assert.equal(typeof connectCdpTransport, 'function');
  FakeSocket.instances = [];

  await assert.rejects(
    connectCdpTransport('ws://127.0.0.1:43117/devtools/browser/id', {
      WebSocketCtor: FakeSocket,
      connectTimeoutMs: 5,
    }),
    (error) => error?.code === 'CDP_CONNECT_TIMEOUT',
  );

  const socket = FakeSocket.instances[0];
  assert.equal(socket.closeCalls, 1);
  assert.equal(socket.listenerCount(), 0);
});

test('CDP connect error and early close use the same bounded disposal', async () => {
  const { connectCdpTransport } = await loadHelpers();
  assert.equal(typeof connectCdpTransport, 'function');

  for (const eventType of ['error', 'close']) {
    FakeSocket.instances = [];
    const connecting = connectCdpTransport('ws://127.0.0.1:43117/devtools/browser/id', {
      WebSocketCtor: FakeSocket,
      connectTimeoutMs: 100,
    });
    const socket = FakeSocket.instances[0];
    socket.emit(eventType, { code: 1006 });

    await assert.rejects(
      connecting,
      (error) => error?.code === (eventType === 'error'
        ? 'CDP_CONNECT_ERROR'
        : 'CDP_CONNECT_CLOSED'),
    );
    assert.equal(socket.closeCalls, 1);
    assert.equal(socket.listenerCount(), 0);
  }
});

test('CDP transport rejects pending calls and disposes idempotently', async () => {
  const { createCdpTransport } = await loadHelpers();
  assert.equal(typeof createCdpTransport, 'function');
  const socket = new FakeSocket();
  socket.readyState = 1;
  const transport = createCdpTransport(socket, { commandTimeoutMs: 100 });
  const pending = transport.send('Runtime.enable');

  socket.emit('close', { code: 1006 });

  await assert.rejects(pending, (error) => error?.code === 'CDP_TRANSPORT_CLOSED');
  assert.equal(transport.pendingCount, 0);
  assert.equal(socket.listenerCount(), 0);
  transport.dispose();
  transport.dispose();
  assert.equal(socket.closeCalls, 0);
});

test('CDP command timeout clears only its pending command', async () => {
  const { createCdpTransport } = await loadHelpers();
  assert.equal(typeof createCdpTransport, 'function');
  const socket = new FakeSocket();
  socket.readyState = 1;
  const transport = createCdpTransport(socket, { commandTimeoutMs: 5 });

  await assert.rejects(
    transport.send('Runtime.enable'),
    (error) => error?.code === 'CDP_COMMAND_TIMEOUT',
  );
  assert.equal(transport.pendingCount, 0);
  transport.dispose();
  transport.dispose();
  assert.equal(socket.closeCalls, 1);
  assert.equal(socket.listenerCount(), 0);
});

test('CDP transport delivers domain events only while it owns the socket', async () => {
  const { createCdpTransport } = await loadHelpers();
  const socket = new FakeSocket();
  socket.readyState = 1;
  const events = [];
  const transport = createCdpTransport(socket, {
    onEvent: (message) => events.push(message),
  });

  socket.emit('message', {
    data: JSON.stringify({ method: 'Runtime.consoleAPICalled', params: { type: 'error' } }),
  });
  transport.dispose();
  socket.emit('message', {
    data: JSON.stringify({ method: 'Runtime.exceptionThrown', params: {} }),
  });

  assert.deepEqual(events, [{
    method: 'Runtime.consoleAPICalled',
    params: { type: 'error' },
  }]);
});

test('cleanup coordinator shares one cleanup across normal and signal callers', async () => {
  const { createCleanupCoordinator } = await loadHelpers();
  assert.equal(typeof createCleanupCoordinator, 'function');
  let cleanupCalls = 0;
  let releaseCleanup;
  const coordinator = createCleanupCoordinator(() => {
    cleanupCalls += 1;
    return new Promise((resolve) => { releaseCleanup = resolve; });
  });

  const normalCleanup = coordinator.run('normal');
  const signalCleanup = coordinator.run('SIGINT');

  assert.strictEqual(normalCleanup, signalCleanup);
  assert.equal(cleanupCalls, 0);
  await Promise.resolve();
  assert.equal(cleanupCalls, 1);
  releaseCleanup();
  await Promise.all([normalCleanup, signalCleanup]);
  assert.equal(cleanupCalls, 1);
});

test('SIGINT and SIGTERM await the same cleanup and exit once', async () => {
  const {
    createCleanupCoordinator,
    installSignalCleanup,
  } = await loadHelpers();
  assert.equal(typeof installSignalCleanup, 'function');
  const processLike = new EventEmitter();
  let cleanupCalls = 0;
  let releaseCleanup;
  const exits = [];
  const coordinator = createCleanupCoordinator(() => {
    cleanupCalls += 1;
    return new Promise((resolve) => { releaseCleanup = resolve; });
  });
  installSignalCleanup({
    coordinator,
    exit: (code) => exits.push(code),
    processLike,
  });

  processLike.emit('SIGINT');
  processLike.emit('SIGTERM');
  await Promise.resolve();
  assert.equal(cleanupCalls, 1);
  assert.deepEqual(exits, []);
  releaseCleanup();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(exits, [130]);
  assert.equal(processLike.listenerCount('SIGINT'), 0);
  assert.equal(processLike.listenerCount('SIGTERM'), 0);
});

test('owned browser cleanup closes its endpoint, terminates only its process, and removes its profile', async () => {
  const { cleanupOwnedBrowser } = await loadHelpers();
  assert.equal(typeof cleanupOwnedBrowser, 'function');
  const calls = [];
  const browserProcess = { exitCode: null, pid: 4242 };
  let exitChecks = 0;

  await cleanupOwnedBrowser({
    browserProcess,
    browserWebSocketUrl: 'ws://127.0.0.1:43117/devtools/browser/owned',
    profileDir: 'C:/Temp/revolution-s9-edge-owned',
  }, {
    connectTransport: async (url) => ({
      dispose: () => calls.push(['dispose']),
      send: async (method) => calls.push(['send', method, url]),
    }),
    removeProfile: async (profileDir) => calls.push(['remove', profileDir]),
    terminateProcessTree: async (child) => calls.push(['terminate', child.pid]),
    waitForExit: async (child) => {
      calls.push(['wait', child.pid]);
      exitChecks += 1;
      return exitChecks > 1;
    },
  });

  assert.deepEqual(calls, [
    ['send', 'Browser.close', 'ws://127.0.0.1:43117/devtools/browser/owned'],
    ['dispose'],
    ['wait', 4242],
    ['terminate', 4242],
    ['wait', 4242],
    ['remove', 'C:/Temp/revolution-s9-edge-owned'],
  ]);
});

test('Windows process-tree fallback targets only the owned child PID', async () => {
  const { terminateOwnedProcessTree } = await loadHelpers();
  assert.equal(typeof terminateOwnedProcessTree, 'function');
  const calls = [];

  terminateOwnedProcessTree({ exitCode: null, pid: 4242 }, {
    platform: 'win32',
    spawnSyncFn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'taskkill');
  assert.deepEqual(calls[0].args, ['/PID', '4242', '/T', '/F']);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.stdio, 'ignore');
  assert.equal(calls[0].options.timeout, 2_000);

  assert.throws(
    () => terminateOwnedProcessTree({ exitCode: null, pid: 4242 }, {
      platform: 'win32',
      spawnSyncFn: () => ({ error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) }),
    }),
    (error) => error?.code === 'OWNED_PROCESS_TERMINATION_TIMEOUT',
  );
  assert.throws(
    () => terminateOwnedProcessTree({ exitCode: null, pid: 4242 }, {
      platform: 'win32',
      spawnSyncFn: () => ({ status: 1 }),
    }),
    (error) => error?.code === 'OWNED_PROCESS_TERMINATION_FAILED',
  );
});

test('readiness failure after spawn cleans the owned process and profile through main wiring', async () => {
  const { main } = await loadHarness();
  const calls = [];
  const browserProcess = new EventEmitter();
  browserProcess.exitCode = null;
  browserProcess.pid = 4242;
  const processLike = new EventEmitter();
  processLike.exitCode = 0;
  processLike.exit = (code) => { processLike.exitCode = code; };
  const consoleLike = {
    error: (value) => calls.push(['stderr', value]),
    log: (value) => calls.push(['stdout', value]),
  };

  const summary = await main({
    argv: ['node', 'scripts/s9-visual-smoke.mjs', 'http://127.0.0.1:3010'],
    env: { S9_EDGE_PATH: 'C:/owned/msedge.exe' },
    processLike,
    dependencies: {
      consoleLike,
      edgeExists: () => true,
      makeProfile: () => 'C:/Temp/revolution-s9-edge-owned',
      spawnBrowser: () => {
        calls.push(['spawn']);
        return browserProcess;
      },
      waitForEndpoint: async () => {
        calls.push(['readiness']);
        const error = new Error('private endpoint details');
        error.code = 'OWNED_ENDPOINT_TIMEOUT';
        throw error;
      },
      cleanupBrowserOptions: {
        removeProfile: async (profileDir) => calls.push(['remove', profileDir]),
        terminateProcessTree: async (child) => {
          calls.push(['terminate', child.pid]);
          child.exitCode = 1;
        },
        waitForExit: async (child) => {
          calls.push(['wait', child.pid]);
          return child.exitCode !== null;
        },
      },
    },
  });

  assert.deepEqual(calls.slice(0, 5), [
    ['spawn'],
    ['readiness'],
    ['wait', 4242],
    ['terminate', 4242],
    ['wait', 4242],
  ]);
  assert.ok(calls.some((call) => (
    call[0] === 'remove' && call[1] === 'C:/Temp/revolution-s9-edge-owned'
  )));
  assert.deepEqual(summary.failures, ['harness:infrastructure:browser:endpoint-timeout']);
  assert.equal(processLike.exitCode, 1);
  assert.doesNotMatch(JSON.stringify({ calls, summary }), /private endpoint details/);
  assert.equal(processLike.listenerCount('SIGINT'), 0);
  assert.equal(processLike.listenerCount('SIGTERM'), 0);
});

test('profile removal enforces the system-temp ownership boundary', async () => {
  const { removeOwnedProfile } = await loadHelpers();
  assert.equal(typeof removeOwnedProfile, 'function');
  const removed = [];
  const tempRoot = path.resolve('C:/Temp');
  const ownedProfile = path.join(tempRoot, 'revolution-s9-edge-owned');

  removeOwnedProfile(ownedProfile, {
    rmSyncFn: (profileDir, options) => removed.push({ options, profileDir }),
    tempRoot,
  });
  assert.deepEqual(removed, [{
    options: { force: true, maxRetries: 3, recursive: true, retryDelay: 100 },
    profileDir: ownedProfile,
  }]);

  assert.throws(
    () => removeOwnedProfile(path.resolve('C:/Users/Someone'), {
      rmSyncFn: () => assert.fail('must not delete outside the owned temp profile'),
      tempRoot,
    }),
    (error) => error?.code === 'OWNED_PROFILE_BOUNDARY',
  );
});

test('network monitor counts API loading failures without retaining URL queries', async () => {
  const { createNetworkMonitor } = await loadHelpers();
  assert.equal(typeof createNetworkMonitor, 'function');
  const monitor = createNetworkMonitor({ targetOrigin: 'http://127.0.0.1:3010' });
  monitor.beginNavigation('/works');
  monitor.handle('Network.requestWillBeSent', {
    loaderId: 'loader-api',
    request: { url: 'http://127.0.0.1:3010/api/access?session=secret' },
    requestId: 'request-api',
    type: 'Fetch',
  });
  monitor.handle('Network.loadingFailed', {
    errorText: 'net::ERR_FAILED',
    requestId: 'request-api',
    type: 'Fetch',
  });

  const snapshot = monitor.snapshot();
  assert.deepEqual(snapshot.failures, ['/works:network-Fetch-failed']);
  assert.doesNotMatch(JSON.stringify(snapshot), /session|secret|api\/access/);
});

test('network monitor ignores only the old Document explicitly replaced by harness navigation', async () => {
  const { createNetworkMonitor } = await loadHelpers();
  const monitor = createNetworkMonitor({ targetOrigin: 'http://127.0.0.1:3010' });
  monitor.beginNavigation('/');
  monitor.handle('Network.requestWillBeSent', {
    loaderId: 'loader-old',
    request: { url: 'http://127.0.0.1:3010/' },
    requestId: 'document-old',
    type: 'Document',
  });
  monitor.beginNavigation('/works');
  monitor.handle('Network.loadingFailed', {
    canceled: true,
    errorText: 'net::ERR_ABORTED',
    requestId: 'document-old',
    type: 'Document',
  });
  monitor.handle('Log.entryAdded', {
    entry: {
      level: 'error',
      networkRequestId: 'document-old',
      source: 'network',
      text: 'Failed to load resource: net::ERR_ABORTED',
    },
  });

  assert.deepEqual(monitor.snapshot().failures, []);

  monitor.handle('Network.loadingFailed', {
    errorText: 'net::ERR_ABORTED',
    requestId: 'document-unknown',
    type: 'Document',
  });
  assert.deepEqual(
    monitor.snapshot().failures,
    ['/works:network-Document-failed'],
  );

  const uncanceled = createNetworkMonitor({ targetOrigin: 'http://127.0.0.1:3010' });
  uncanceled.beginNavigation('/');
  uncanceled.handle('Network.requestWillBeSent', {
    loaderId: 'loader-old',
    request: { url: 'http://127.0.0.1:3010/' },
    requestId: 'document-old',
    type: 'Document',
  });
  uncanceled.beginNavigation('/works');
  uncanceled.handle('Network.loadingFailed', {
    canceled: false,
    errorText: 'net::ERR_ABORTED',
    requestId: 'document-old',
    type: 'Document',
  });
  assert.deepEqual(uncanceled.snapshot().failures, ['/:network-Document-failed']);
});

test('network monitor records external WebSocket origin without path or query', async () => {
  const { createNetworkMonitor } = await loadHelpers();
  const monitor = createNetworkMonitor({ targetOrigin: 'http://127.0.0.1:3010' });
  monitor.beginNavigation('/');
  monitor.handle('Network.webSocketCreated', {
    requestId: 'socket-external',
    url: 'wss://outside.example/private?prompt=secret',
  });

  const snapshot = monitor.snapshot();
  assert.deepEqual(snapshot.externalOrigins, ['wss://outside.example']);
  assert.doesNotMatch(JSON.stringify(snapshot), /private|prompt|secret/);
});

test('network monitor records untracked Other failures and tracked resources', async () => {
  const { createNetworkMonitor } = await loadHelpers();
  const monitor = createNetworkMonitor({ targetOrigin: 'http://127.0.0.1:3010' });
  monitor.beginNavigation('/works');
  monitor.handle('Network.loadingFailed', {
    errorText: 'net::ERR_NAME_NOT_RESOLVED',
    requestId: 'unknown-internal',
  });
  assert.deepEqual(monitor.snapshot().failures, ['/works:network-Other-failed']);

  monitor.handle('Network.requestWillBeSent', {
    loaderId: 'loader-other',
    request: { url: 'http://127.0.0.1:3010/resource' },
    requestId: 'tracked-other',
    type: 'Other',
  });
  monitor.handle('Network.loadingFailed', {
    errorText: 'net::ERR_FAILED',
    requestId: 'tracked-other',
  });
  assert.deepEqual(monitor.snapshot().failures, ['/works:network-Other-failed']);
});

test('network monitor preserves uncorrelated Log failures and deduplicates correlated requests', async () => {
  const { createNetworkMonitor } = await loadHelpers();
  const monitor = createNetworkMonitor({ targetOrigin: 'http://127.0.0.1:3010' });
  monitor.beginNavigation('/works');
  monitor.handle('Network.requestWillBeSent', {
    loaderId: 'loader-script',
    request: { url: 'http://127.0.0.1:3010/app.js?session=secret' },
    requestId: 'request-script',
    type: 'Script',
  });
  monitor.handle('Network.loadingFailed', {
    errorText: 'net::ERR_NAME_NOT_RESOLVED',
    requestId: 'request-script',
    type: 'Script',
  });
  monitor.handle('Log.entryAdded', {
    entry: {
      level: 'error',
      networkRequestId: 'request-script',
      source: 'network',
      text: 'private response body',
      url: 'http://127.0.0.1:3010/app.js?session=secret',
    },
  });
  monitor.handle('Log.entryAdded', {
    entry: {
      level: 'error',
      source: 'network',
      text: 'Failed to load resource: net::ERR_NAME_NOT_RESOLVED private',
      url: 'https://private.example/secret',
    },
  });

  const snapshot = monitor.snapshot();
  assert.deepEqual(snapshot.failures, [
    '/works:network-Script-failed',
    '/works:network-Log-failed',
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /private|secret|response|app\.js/);
});

test('running animation count includes finite and infinite animations', async () => {
  const { countRunningAnimations } = await loadHelpers();
  assert.equal(typeof countRunningAnimations, 'function');
  assert.equal(countRunningAnimations([
    { effect: { getTiming: () => ({ iterations: 1 }) }, playState: 'running' },
    { effect: { getTiming: () => ({ iterations: Infinity }) }, playState: 'running' },
    { effect: { getTiming: () => ({ iterations: 1 }) }, playState: 'finished' },
  ]), 2);
});

test('public CDP failure mapping exposes only explicit safe codes', async () => {
  const { publicS9CdpFailureCode } = await loadHelpers();
  assert.equal(publicS9CdpFailureCode({ code: 'OWNED_ENDPOINT_TIMEOUT' }), 'browser:endpoint-timeout');
  assert.equal(publicS9CdpFailureCode({ code: 'CDP_COMMAND_TIMEOUT' }), 'cdp:command-timeout');
  assert.equal(publicS9CdpFailureCode({ code: 'PRIVATE_PATH_C_ERROR' }), null);
  assert.equal(publicS9CdpFailureCode(new Error('C:/private/path')), null);
});

test('network monitor ignores only the active navigation favicon abort', async () => {
  const { createNetworkMonitor } = await loadHelpers();
  const monitor = createNetworkMonitor({ targetOrigin: 'http://127.0.0.1:3010' });

  monitor.beginNavigation('/');
  monitor.handle('Network.requestWillBeSent', {
    loaderId: 'loader-old',
    request: { url: 'http://127.0.0.1:3010/' },
    requestId: 'document-old',
    type: 'Document',
  });
  monitor.handle('Network.requestWillBeSent', {
    loaderId: 'loader-old',
    request: { url: 'http://127.0.0.1:3010/icon.svg' },
    requestId: 'icon-old',
    type: 'Other',
  });
  monitor.beginNavigation('/works');
  monitor.handle('Network.loadingFailed', {
    canceled: true,
    errorText: 'net::ERR_ABORTED',
    requestId: 'icon-old',
    type: 'Other',
  });
  assert.deepEqual(monitor.snapshot().failures, []);

  monitor.handle('Network.requestWillBeSent', {
    loaderId: 'loader-old',
    request: { url: 'http://127.0.0.1:3010/icon.svg?version=private' },
    requestId: 'icon-query',
    type: 'Other',
  });
  monitor.handle('Network.loadingFailed', {
    canceled: true,
    errorText: 'net::ERR_ABORTED',
    requestId: 'icon-query',
    type: 'Other',
  });
  assert.deepEqual(monitor.snapshot().failures, ['/works:network-Other-failed']);
  assert.doesNotMatch(JSON.stringify(monitor.snapshot()), /version|private|icon/);
});

test('network monitor reports document statuses and safe HTTP failures', async () => {
  const { createNetworkMonitor } = await loadHelpers();
  const monitor = createNetworkMonitor({ targetOrigin: 'http://127.0.0.1:3010' });
  monitor.beginNavigation('/works');
  monitor.handle('Network.requestWillBeSent', {
    loaderId: 'loader-document',
    redirectResponse: {
      status: 307,
      url: 'http://127.0.0.1:3010/works/private?session=secret',
    },
    request: { url: 'http://127.0.0.1:3010/works' },
    requestId: 'request-document',
    type: 'Document',
  });
  monitor.handle('Network.responseReceived', {
    requestId: 'request-document',
    response: {
      status: 200,
      url: 'http://127.0.0.1:3010/works?prompt=secret',
    },
    type: 'Document',
  });
  monitor.handle('Network.responseReceived', {
    requestId: 'request-api',
    response: {
      status: 503,
      url: 'http://127.0.0.1:3010/api/private?session=secret',
    },
    type: 'XHR',
  });
  monitor.handle('Network.requestWillBeSent', {
    loaderId: 'loader-external',
    request: { url: 'https://outside.example/private?prompt=secret' },
    requestId: 'request-external',
    type: 'Image',
  });

  assert.deepEqual(monitor.endNavigation(), [307, 200]);
  const snapshot = monitor.snapshot();
  assert.deepEqual(snapshot.httpFailures, [{ route: '/works', status: 503, type: 'XHR' }]);
  assert.deepEqual(snapshot.externalOrigins, ['https://outside.example']);
  assert.doesNotMatch(JSON.stringify(snapshot), /private|prompt|secret|api\//);
});

test('primary desktop click verifies the hit target and dispatches a real mouse sequence', async () => {
  const { dispatchPrimaryClick } = await loadHelpers();
  const calls = [];
  const client = {
    async evaluate(expression) {
      calls.push({ expression, method: 'evaluate' });
      return { x: 120, y: 80 };
    },
    async send(method, params) {
      calls.push({ method, params });
    },
  };

  await dispatchPrimaryClick(client, {
    pointerMode: 'mouse',
    selector: '[data-project-slug="deep-research"] button',
  });

  const locator = calls[0].expression;
  assert.match(locator, /scrollIntoView/);
  assert.match(locator, /getBoundingClientRect/);
  assert.match(locator, /elementFromPoint/);
  assert.deepEqual(calls.slice(1), [
    {
      method: 'Input.dispatchMouseEvent',
      params: { button: 'none', buttons: 0, type: 'mouseMoved', x: 120, y: 80 },
    },
    {
      method: 'Input.dispatchMouseEvent',
      params: { button: 'left', buttons: 1, clickCount: 1, type: 'mousePressed', x: 120, y: 80 },
    },
    {
      method: 'Input.dispatchMouseEvent',
      params: { button: 'left', buttons: 0, clickCount: 1, type: 'mouseReleased', x: 120, y: 80 },
    },
  ]);
});

test('primary mobile click dispatches a real touch sequence and rejects an unowned hit point', async () => {
  const { dispatchPrimaryClick } = await loadHelpers();
  const sends = [];
  const client = {
    async evaluate() {
      return { x: 48, y: 96 };
    },
    async send(method, params) {
      sends.push({ method, params });
    },
  };

  await dispatchPrimaryClick(client, {
    pointerMode: 'touch',
    selector: '#home-title + button',
  });
  assert.deepEqual(sends, [
    {
      method: 'Input.dispatchTouchEvent',
      params: {
        touchPoints: [{ force: 1, id: 1, radiusX: 1, radiusY: 1, x: 48, y: 96 }],
        type: 'touchStart',
      },
    },
    {
      method: 'Input.dispatchTouchEvent',
      params: { touchPoints: [], type: 'touchEnd' },
    },
  ]);

  await assert.rejects(
    dispatchPrimaryClick({
      evaluate: async () => null,
      send: async () => assert.fail('must not dispatch input without a verified hit target'),
    }, {
      pointerMode: 'touch',
      selector: 'button',
    }),
    (error) => error?.code === 'POINTER_TARGET_UNAVAILABLE',
  );
});

test('quiet-frame assertion is bounded and rejects the first post-intent activity', async () => {
  const { assertConsecutiveAnimationFramesQuiet } = await loadHelpers();
  let frameCount = 0;
  await assertConsecutiveAnimationFramesQuiet({
    expectedValue: 2,
    maxFrames: 5,
    quietFrames: 3,
    requestFrame: async () => { frameCount += 1; },
    sample: async () => 2,
  });
  assert.equal(frameCount, 3);

  const samples = [2, 3, 3, 3];
  let sampleIndex = 0;
  await assert.rejects(
    assertConsecutiveAnimationFramesQuiet({
      expectedValue: 2,
      maxFrames: 8,
      quietFrames: 4,
      requestFrame: async () => {},
      sample: async () => samples[sampleIndex++],
    }),
    (error) => error?.code === 'ANIMATION_FRAME_ACTIVITY',
  );
  assert.equal(sampleIndex, 2);
});

test('summary builder emits only the exact public schema at every level', async () => {
  const { createS9Summary } = await loadHelpers();
  const summary = createS9Summary({
    canvasPixelVariance: {
      desktop: {
        frameDifference: 0.25,
        prompt: 'private prompt',
        sampleHeight: 90,
        sampleWidth: 160,
        variance: 12.5,
      },
      secret: { variance: 999 },
    },
    consoleErrors: 0,
    expandedSlugs: {
      desktop: ['deep-research'],
      session: ['private session'],
    },
    externalRuntimeRequests: [],
    failures: [],
    horizontalOverflow: [{
      path: 'C:/private/path',
      pixels: 0,
      route: '/works',
      viewport: 'desktop',
    }],
    pageErrors: 0,
    path: 'C:/private/path',
    prompt: 'private prompt',
    routeStatuses: [{
      route: '/',
      secret: 'private secret',
      statuses: [200],
      viewport: 'desktop',
    }],
    screenshots: ['docs/verify/s9/home.png'],
    secret: 'private secret',
    session: 'private session',
  });

  assert.deepEqual(summary, {
    failures: [],
    screenshots: ['docs/verify/s9/home.png'],
    routeStatuses: [{ route: '/', statuses: [200], viewport: 'desktop' }],
    canvasPixelVariance: {
      desktop: {
        frameDifference: 0.25,
        sampleHeight: 90,
        sampleWidth: 160,
        variance: 12.5,
      },
    },
    expandedSlugs: { desktop: ['deep-research'] },
    horizontalOverflow: [{ pixels: 0, route: '/works', viewport: 'desktop' }],
    consoleErrors: 0,
    pageErrors: 0,
    externalRuntimeRequests: [],
  });
  assert.deepEqual(Object.keys(summary), [
    'failures',
    'screenshots',
    'routeStatuses',
    'canvasPixelVariance',
    'expandedSlugs',
    'horizontalOverflow',
    'consoleErrors',
    'pageErrors',
    'externalRuntimeRequests',
  ]);
  assert.doesNotMatch(JSON.stringify(summary), /secret|private|session|prompt|C:\//);
});
