import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import os from 'node:os';
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

function createPublicSummary(failures = []) {
  return {
    failures,
    screenshots: [],
    routeStatuses: [],
    canvasPixelVariance: {},
    expandedSlugs: {},
    horizontalOverflow: [],
    consoleErrors: 0,
    pageErrors: 0,
    externalRuntimeRequests: [],
  };
}

function createFakeWorker({
  autoMessage = true,
  summary = createPublicSummary(),
} = {}) {
  const worker = new EventEmitter();
  worker.pid = 4242;
  worker.exitCode = null;
  worker.closed = false;
  worker.connected = true;
  worker.disconnectCalls = 0;
  worker.unrefCalls = 0;
  worker.disconnect = () => {
    worker.disconnectCalls += 1;
    worker.disconnectIpc();
  };
  worker.unref = () => { worker.unrefCalls += 1; };
  worker.sendSummary = (message = summary) => {
    if (!worker.connected || worker.closed) return;
    worker.emit('message', message);
  };
  worker.disconnectIpc = () => {
    if (!worker.connected || worker.closed) return;
    worker.connected = false;
    worker.emit('disconnect');
  };
  worker.finish = ({
    code = 0,
    signal = null,
  } = {}) => {
    if (worker.closed) return;
    worker.exitCode = code;
    worker.emit('exit', code, signal);
    setImmediate(() => {
      worker.closed = true;
      worker.connected = false;
      worker.emit('close', code, signal);
    });
  };
  worker.failSpawn = () => worker.emit('error', new Error('private spawn failure'));
  if (autoMessage) setImmediate(() => worker.sendSummary());
  return worker;
}

async function terminateFakeWorker(worker) {
  worker.finish({ code: 1, signal: 'SIGTERM' });
}

function createSupervisorProcess() {
  const processLike = new EventEmitter();
  processLike.exitCode = 0;
  processLike.exits = [];
  processLike.exit = (code) => {
    processLike.exitCode = code;
    processLike.exits.push(code);
  };
  return processLike;
}

function createSupervisorConsole() {
  const stdout = [];
  const stderr = [];
  return {
    consoleLike: {
      error: (value) => stderr.push(value),
      log: (value) => stdout.push(value),
    },
    stderr,
    stdout,
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

test('owned endpoint polling is bounded and retries only transient startup file states', async () => {
  const { waitForOwnedDevToolsActivePort } = await loadHelpers();
  const profileDir = path.resolve('C:/Temp/revolution-s9-edge-owned');
  let reads = 0;
  let nowMs = 1_000;
  const waits = [];
  const transientCodes = ['ENOENT', 'EBUSY', 'EACCES', 'EPERM'];
  const fsApi = {
    readFileSync() {
      reads += 1;
      if (reads <= transientCodes.length) {
        const error = new Error('transient startup state');
        error.code = transientCodes[reads - 1];
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
  assert.equal(reads, 5);
  assert.deepEqual(waits, [50, 50, 50, 50]);

  await assert.rejects(
    waitForOwnedDevToolsActivePort({
      fsApi: {
        readFileSync() {
          const error = new Error('busy');
          error.code = 'EBUSY';
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

  await assert.rejects(
    waitForOwnedDevToolsActivePort({
      fsApi: {
        readFileSync() {
          throw Object.assign(new Error('io failure'), { code: 'EIO' });
        },
        statSync() {
          throw new Error('unreachable');
        },
      },
      isProcessExited: () => false,
      poll: async () => assert.fail('permanent endpoint errors must not be retried'),
      profileDir,
      startedAtMs: 0,
      timeoutMs: 100,
    }),
    (error) => error?.code === 'EIO',
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

test('non-Windows browser cleanup closes its endpoint before the owned-process fallback', async () => {
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
    platform: 'linux',
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

test('Windows browser cleanup terminates the owned tree before waiting or removing its profile', async () => {
  const { cleanupOwnedBrowser } = await loadHelpers();
  const calls = [];
  const browserProcess = { exitCode: null, pid: 4242 };
  let descendantHoldsProfileLock = true;

  await cleanupOwnedBrowser({
    browserProcess,
    browserWebSocketUrl: 'ws://127.0.0.1:43117/devtools/browser/owned',
    profileDir: 'C:/Temp/revolution-s9-edge-owned',
  }, {
    connectTransport: async () => ({
      dispose: () => calls.push(['dispose']),
      send: async () => {
        calls.push(['send', 'Browser.close']);
        browserProcess.exitCode = 0;
      },
    }),
    platform: 'win32',
    removeProfile: async (profileDir) => {
      calls.push(['remove', profileDir]);
      assert.equal(
        descendantHoldsProfileLock,
        false,
        'profile removal must wait until the owned Windows tree is terminated',
      );
    },
    terminateProcessTree: async (child) => {
      calls.push(['terminate', child.pid]);
      descendantHoldsProfileLock = false;
      child.exitCode = 1;
    },
    waitForExit: async (child) => {
      calls.push(['wait', child.pid]);
      return child.exitCode !== null;
    },
  });

  assert.deepEqual(calls, [
    ['terminate', 4242],
    ['wait', 4242],
    ['remove', 'C:/Temp/revolution-s9-edge-owned'],
  ]);
});

test('supervised Windows cleanup trusts successful tree termination without waiting for child exit', async () => {
  const { cleanupOwnedBrowser } = await loadHelpers();
  const calls = [];

  await cleanupOwnedBrowser({
    browserProcess: { exitCode: null, pid: 4242 },
    profileDir: 'C:/Temp/revolution-s9-edge-supervised',
  }, {
    platform: 'win32',
    removeProfileAfterExit: false,
    terminateProcessTree: async (child) => calls.push(['terminate', child.pid]),
    waitForExit: async () => {
      calls.push(['wait']);
      return false;
    },
  });

  assert.deepEqual(calls, [['terminate', 4242]]);
});

test('supervised Windows cleanup still fails when tree termination itself fails', async () => {
  const { cleanupOwnedBrowser } = await loadHelpers();
  const terminationError = new Error('taskkill failed');
  const calls = [];

  await assert.rejects(
    cleanupOwnedBrowser({
      browserProcess: { exitCode: null, pid: 4242 },
      profileDir: 'C:/Temp/revolution-s9-edge-supervised',
    }, {
      platform: 'win32',
      removeProfileAfterExit: false,
      terminateProcessTree: async () => { throw terminationError; },
      waitForExit: async () => {
        calls.push(['wait']);
        return true;
      },
    }),
    (error) => error === terminationError,
  );

  assert.deepEqual(calls, []);
});

test('standalone Windows cleanup still fails when its child does not exit', async () => {
  const { cleanupOwnedBrowser } = await loadHelpers();
  let removals = 0;

  await assert.rejects(
    cleanupOwnedBrowser({
      browserProcess: { exitCode: null, pid: 4242 },
      profileDir: 'C:/Temp/revolution-s9-edge-standalone',
    }, {
      platform: 'win32',
      removeProfile: async () => { removals += 1; },
      terminateProcessTree: async () => {},
      waitForExit: async () => false,
    }),
    (error) => error?.code === 'OWNED_PROCESS_CLEANUP_FAILED',
  );

  assert.equal(removals, 0);
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

test('Windows profile-process cleanup rejects unowned profiles before spawning PowerShell', async () => {
  const { terminateOwnedProfileProcesses } = await loadHelpers();
  assert.equal(typeof terminateOwnedProfileProcesses, 'function');
  assert.throws(
    () => terminateOwnedProfileProcesses('C:/Users/Someone/revolution-s9-edge-outside', {
      platform: 'win32',
      spawnSyncFn: () => assert.fail('must not enumerate processes for an unowned profile'),
      tempRoot: path.resolve('C:/Temp'),
    }),
    (error) => error?.code === 'OWNED_PROFILE_BOUNDARY',
  );
});

test('profile-process cleanup selects leaves before parents and falls back for a cycle', async () => {
  const { selectLeafProfileProcessIds } = await loadHelpers();
  assert.equal(typeof selectLeafProfileProcessIds, 'function');

  let remaining = [
    { ParentProcessId: 0, ProcessId: 100 },
    { ParentProcessId: 100, ProcessId: 200 },
    { ParentProcessId: 200, ProcessId: 300 },
    { ParentProcessId: 200, ProcessId: 301 },
  ];
  const batches = [];
  while (remaining.length > 0) {
    const leaves = selectLeafProfileProcessIds(remaining);
    batches.push(leaves);
    const stopped = new Set(leaves);
    remaining = remaining.filter(({ ProcessId }) => !stopped.has(ProcessId));
  }
  assert.deepEqual(batches, [[300, 301], [200], [100]]);

  assert.deepEqual(selectLeafProfileProcessIds([
    { ParentProcessId: 20, ProcessId: 10 },
    { ParentProcessId: 10, ProcessId: 20 },
  ]), [10, 20]);
});

test('profile-process cleanup confirms zero before deadline and times out before another stop', async () => {
  const { decideProfileProcessCleanupAction } = await loadHelpers();
  assert.equal(typeof decideProfileProcessCleanupAction, 'function');
  assert.equal(decideProfileProcessCleanupAction({ deadlineReached: true, matchCount: 0 }), 'success');
  assert.equal(decideProfileProcessCleanupAction({ deadlineReached: true, matchCount: 1 }), 'timeout');
  assert.equal(decideProfileProcessCleanupAction({ deadlineReached: false, matchCount: 1 }), 'stop');
});

test('Windows profile-process cleanup uses bounded encoded CIM matching with only required system env', async () => {
  const { terminateOwnedProfileProcesses } = await loadHelpers();
  const profileDir = path.resolve('C:/Temp/revolution-s9-edge-owned');
  const systemRoot = path.resolve('C:/S9Windows');
  const calls = [];

  terminateOwnedProfileProcesses(profileDir, {
    platform: 'win32',
    processEnv: {
      API_TOKEN: 'must-not-be-inherited',
      PATH: 'must-not-be-inherited',
      WINDIR: systemRoot,
    },
    spawnSyncFn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
    systemRoot,
    tempRoot: path.resolve('C:/Temp'),
  });

  assert.equal(calls.length, 1);
  const [{ command, args, options }] = calls;
  assert.equal(command, path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  assert.deepEqual(args.slice(0, -1), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
  ]);
  const encoded = args.at(-1);
  assert.match(encoded, /^[A-Za-z0-9+/]+=*$/);
  const script = Buffer.from(encoded, 'base64').toString('utf16le');
  for (const marker of [
    '$env:S9_OWNED_PROFILE',
    'Get-CimInstance Win32_Process',
    '$parentPids',
    '$leaves',
    '$targets = if ($leaves.Count -gt 0) { $leaves } else { $matches }',
    '[StringComparison]::OrdinalIgnoreCase',
    '$_\.ProcessId -ne $PID',
    'Stop-Process -Force',
    'Start-Sleep -Milliseconds 100',
  ]) {
    assert.ok(script.includes(marker), `missing profile cleanup marker: ${marker}`);
  }
  assert.match(
    script,
    /while \(\$true\)[\s\S]*Get-CimInstance Win32_Process[\s\S]*Start-Sleep -Milliseconds 100[\s\S]*\}/,
    'each leaf batch must be followed by a fresh CIM query on the next loop iteration',
  );
  const zeroCheckIndex = script.indexOf('if ($matches.Count -eq 0) { exit 0 }');
  const deadlineCheckIndex = script.indexOf('if ([DateTime]::UtcNow -ge $deadline) { exit 124 }');
  const stopIndex = script.indexOf('Stop-Process -Force');
  assert.ok(
    zeroCheckIndex < deadlineCheckIndex && deadlineCheckIndex < stopIndex,
    'zero confirmation must precede the deadline, which must precede any new stop',
  );
  assert.doesNotMatch(script, /revolution-s9-edge-owned/i);
  assert.doesNotMatch(args.join(' '), /revolution-s9-edge-owned/i);
  assert.deepEqual(options.env, {
    S9_OWNED_PROFILE: profileDir,
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
  });
  assert.equal(options.shell, false);
  assert.equal(options.stdio, 'ignore');
  assert.equal(options.timeout, 17_000);
  assert.equal(options.windowsHide, true);
});

test('Windows profile-process cleanup exposes only fixed timeout and failure codes', async () => {
  const { terminateOwnedProfileProcesses } = await loadHelpers();
  const profileDir = path.resolve('C:/Temp/revolution-s9-edge-owned');
  const options = { platform: 'win32', tempRoot: path.resolve('C:/Temp') };

  assert.throws(
    () => terminateOwnedProfileProcesses(profileDir, {
      ...options,
      spawnSyncFn: () => ({
        error: Object.assign(new Error('private timeout details'), { code: 'ETIMEDOUT' }),
      }),
    }),
    (error) => error?.code === 'OWNED_PROFILE_PROCESS_CLEANUP_TIMEOUT',
  );
  assert.throws(
    () => terminateOwnedProfileProcesses(profileDir, {
      ...options,
      spawnSyncFn: () => ({ status: 31 }),
    }),
    (error) => error?.code === 'OWNED_PROFILE_PROCESS_CLEANUP_FAILED',
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
        platform: 'win32',
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
    ['terminate', 4242],
    ['wait', 4242],
    ['remove', 'C:/Temp/revolution-s9-edge-owned'],
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

test('supervised worker main closes page transports but leaves browser process and profile cleanup to supervisor', async () => {
  const { main } = await loadHarness();
  const calls = [];
  const browserProcess = new EventEmitter();
  browserProcess.exitCode = null;
  browserProcess.pid = 4242;
  const processLike = new EventEmitter();
  processLike.exitCode = 0;
  processLike.exit = (code) => { processLike.exitCode = code; };

  const summary = await main({
    argv: ['node', 'scripts/s9-visual-smoke.mjs', 'http://127.0.0.1:3010'],
    env: { S9_EDGE_PATH: 'C:/owned/msedge.exe' },
    processLike,
    supervisedProfileDir: 'C:/Temp/revolution-s9-edge-supervised',
    dependencies: {
      consoleLike: { error: () => {}, log: () => {} },
      edgeExists: () => true,
      spawnBrowser: () => {
        calls.push('spawn');
        return browserProcess;
      },
      waitForEndpoint: async () => {
        calls.push('readiness');
        const error = new Error('private endpoint details');
        error.code = 'OWNED_ENDPOINT_TIMEOUT';
        throw error;
      },
      cleanupBrowserOptions: {
        platform: 'win32',
        removeProfile: async () => calls.push('remove'),
        terminateProcessTree: async () => calls.push('terminate'),
        waitForExit: async () => {
          calls.push('wait');
          return true;
        },
      },
    },
  });

  assert.deepEqual(calls, ['spawn', 'readiness']);
  assert.deepEqual(summary.failures, ['harness:infrastructure:browser:endpoint-timeout']);
});

test('worker sends the strict summary over IPC and waits for the send callback', async () => {
  const { sendS9WorkerSummary } = await loadHarness();
  assert.equal(typeof sendS9WorkerSummary, 'function');
  const summary = createPublicSummary();
  const calls = [];
  let finishSend;
  const sending = sendS9WorkerSummary({
    connected: true,
    send(message, callback) {
      calls.push(message);
      finishSend = callback;
    },
  }, summary).then(() => calls.push('resolved'));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [summary]);
  finishSend(null);
  await sending;
  assert.deepEqual(calls, [summary, 'resolved']);
});

test('worker flushes a valid functional-failure summary before disconnecting and exiting transport zero', async () => {
  const { runS9Worker } = await loadHarness();
  const calls = [];
  const processLike = new EventEmitter();
  processLike.connected = true;
  processLike.exitCode = 0;
  processLike.channel = { ref: () => calls.push('ref') };
  processLike.disconnect = () => {
    calls.push('disconnect');
    processLike.connected = false;
  };
  processLike.exit = (code) => calls.push(['exit', code]);
  processLike.send = (message, callback) => {
    calls.push(['send', message]);
    calls.push('send-callback');
    callback(null);
  };

  const summary = await runS9Worker({
    argv: [
      'node',
      'scripts/s9-visual-smoke.mjs',
      '--s9-worker',
      'http://127.0.0.1:3010',
      path.join(os.tmpdir(), 'revolution-s9-edge-worker-success'),
    ],
    dependencies: { edgeExists: () => false },
    env: { S9_EDGE_PATH: 'C:/owned/msedge.exe' },
    processLike,
  });

  assert.deepEqual(summary.failures, ['harness:infrastructure:browser:edge-missing']);
  assert.deepEqual(calls.slice(-3), ['send-callback', 'disconnect', ['exit', 0]]);
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === 'exit').length, 1);
});

test('worker disconnects and exits transport one once when IPC summary flush fails', async () => {
  const { runS9Worker } = await loadHarness();
  const calls = [];
  const processLike = new EventEmitter();
  processLike.connected = true;
  processLike.exitCode = 0;
  processLike.channel = { ref() {} };
  processLike.disconnect = () => {
    calls.push('disconnect');
    processLike.connected = false;
  };
  processLike.exit = (code) => calls.push(['exit', code]);
  processLike.send = (_message, callback) => {
    calls.push('send-callback-error');
    callback(new Error('private IPC failure'));
  };

  const summary = await runS9Worker({
    argv: [
      'node',
      'scripts/s9-visual-smoke.mjs',
      '--s9-worker',
      'http://127.0.0.1:3010',
      path.join(os.tmpdir(), 'revolution-s9-edge-worker-failure'),
    ],
    dependencies: { edgeExists: () => false },
    env: { S9_EDGE_PATH: 'C:/owned/msedge.exe' },
    processLike,
  });

  assert.deepEqual(summary.failures, ['harness:infrastructure:browser:edge-missing']);
  assert.deepEqual(calls, ['send-callback-error', 'disconnect', ['exit', 1]]);
  assert.doesNotMatch(JSON.stringify({ calls, summary }), /private IPC failure/);
});

test('Windows supervisor accepts IPC, clears profile processes, waits for worker close, removes profile, then emits once', async () => {
  const { runS9Supervisor } = await loadHarness();
  assert.equal(typeof runS9Supervisor, 'function');
  const worker = createFakeWorker();
  const processLike = createSupervisorProcess();
  const output = createSupervisorConsole();
  const profileDir = path.resolve('C:/Temp/revolution-s9-edge-supervised');
  const calls = [];

  const summary = await runS9Supervisor({
    argv: ['node', 'scripts/s9-visual-smoke.mjs', 'http://127.0.0.1:3010'],
    processLike,
    dependencies: {
      consoleLike: {
        error: output.consoleLike.error,
        log: (value) => {
          calls.push(['emit']);
          output.consoleLike.log(value);
        },
      },
      makeProfile: (prefix) => {
        calls.push(['profile', prefix]);
        return profileDir;
      },
      removeProfile: async (candidate) => {
        calls.push(['remove', candidate]);
        assert.ok(
          calls.some(([name]) => name === 'profile-process-cleanup'),
          'profile deletion must happen after profile process cleanup',
        );
      },
      spawnWorker: (command, args, options) => {
        calls.push(['spawn', command, args, options]);
        return worker;
      },
      platform: 'win32',
      tempRoot: path.resolve('C:/Temp'),
      terminateProfileProcesses: async (candidate, options) => {
        calls.push(['profile-process-cleanup', candidate]);
        assert.deepEqual(options, { platform: 'win32' });
        worker.finish({ code: 1, signal: 'SIGTERM' });
      },
      terminateWorker: () => assert.fail('Windows supervisor must not trust taskkill tree cleanup'),
    },
  });

  const spawnCall = calls.find(([name]) => name === 'spawn');
  assert.equal(spawnCall[1], process.execPath);
  assert.equal(spawnCall[2][1], '--s9-worker');
  assert.equal(spawnCall[2][2], 'http://127.0.0.1:3010');
  assert.equal(spawnCall[2][3], profileDir);
  assert.equal(spawnCall[3].shell, false);
  assert.deepEqual(spawnCall[3].stdio, ['ignore', 'ignore', 'ignore', 'ipc']);
  assert.deepEqual(calls.slice(-3), [
    ['profile-process-cleanup', profileDir],
    ['remove', profileDir],
    ['emit'],
  ]);
  assert.deepEqual(summary, createPublicSummary());
  assert.equal(output.stdout.length, 1);
  assert.deepEqual(JSON.parse(output.stdout[0]), summary);
  assert.deepEqual(output.stderr, []);
  assert.equal(processLike.exitCode, 0);
});

test('Windows supervisor ignores taskkill success when profile descendants would remain', async () => {
  const { runS9Supervisor } = await loadHarness();
  const worker = createFakeWorker();
  const output = createSupervisorConsole();
  const processLike = createSupervisorProcess();
  let taskkillCalls = 0;
  let detachedEdgeProcesses = 15;

  const summary = await runS9Supervisor({
    processLike,
    dependencies: {
      consoleLike: output.consoleLike,
      makeProfile: () => path.resolve('C:/Temp/revolution-s9-edge-detached'),
      platform: 'win32',
      removeProfile: async () => {
        assert.equal(detachedEdgeProcesses, 0, 'profile deletion requires zero matching processes');
      },
      spawnWorker: () => worker,
      tempRoot: path.resolve('C:/Temp'),
      terminateProfileProcesses: async () => {
        detachedEdgeProcesses = 0;
        worker.finish({ code: 1, signal: 'SIGTERM' });
      },
      terminateWorker: async () => {
        taskkillCalls += 1;
        return { status: 0 };
      },
    },
  });

  assert.deepEqual(summary.failures, []);
  assert.equal(taskkillCalls, 0);
  assert.equal(detachedEdgeProcesses, 0);
  assert.equal(processLike.exitCode, 0);
});

test('Windows supervisor treats profile-process zero as completion when ChildProcess close never arrives', async () => {
  const { runS9Supervisor } = await loadHarness();
  const worker = createFakeWorker();
  const output = createSupervisorConsole();
  const processLike = createSupervisorProcess();
  const calls = [];

  const summary = await runS9Supervisor({
    processLike,
    dependencies: {
      consoleLike: output.consoleLike,
      makeProfile: () => path.resolve('C:/Temp/revolution-s9-edge-close-delayed'),
      platform: 'win32',
      removeProfile: async () => calls.push('remove'),
      spawnWorker: () => worker,
      tempRoot: path.resolve('C:/Temp'),
      terminateProfileProcesses: async () => calls.push('profile-process-zero'),
      workerCloseTimeoutMs: 1,
    },
  });

  assert.deepEqual(calls, ['profile-process-zero', 'remove']);
  assert.deepEqual(summary.failures, []);
  assert.equal(worker.closed, false);
  assert.equal(worker.disconnectCalls, 1);
  assert.equal(worker.unrefCalls, 1);
  assert.equal(output.stdout.length, 1);
  assert.equal(processLike.exitCode, 0);
});

test('Windows supervisor still reports a real profile deletion failure after profile processes reach zero', async () => {
  const { runS9Supervisor } = await loadHarness();
  const worker = createFakeWorker();
  const output = createSupervisorConsole();
  const processLike = createSupervisorProcess();
  let removals = 0;

  const summary = await runS9Supervisor({
    processLike,
    dependencies: {
      consoleLike: output.consoleLike,
      makeProfile: () => path.resolve('C:/Temp/revolution-s9-edge-delete-fails'),
      platform: 'win32',
      removeProfile: async () => {
        removals += 1;
        throw new Error('private profile deletion details');
      },
      spawnWorker: () => worker,
      tempRoot: path.resolve('C:/Temp'),
      terminateProfileProcesses: async () => {},
      workerCloseTimeoutMs: 1,
    },
  });

  assert.equal(removals, 1);
  assert.deepEqual(summary.failures, ['browser:owned-cleanup-failed']);
  assert.doesNotMatch(output.stdout[0] + output.stderr.join(''), /private profile deletion/);
});

test('Windows supervisor never removes a profile when profile-process cleanup fails', async () => {
  const { runS9Supervisor } = await loadHarness();
  const worker = createFakeWorker();
  const output = createSupervisorConsole();
  const processLike = createSupervisorProcess();
  let removals = 0;

  const summary = await runS9Supervisor({
    processLike,
    dependencies: {
      consoleLike: output.consoleLike,
      makeProfile: () => path.resolve('C:/Temp/revolution-s9-edge-process-fails'),
      platform: 'win32',
      removeProfile: async () => { removals += 1; },
      spawnWorker: () => worker,
      tempRoot: path.resolve('C:/Temp'),
      terminateProfileProcesses: async () => {
        throw new Error('private process cleanup details');
      },
      workerCloseTimeoutMs: 1,
    },
  });

  assert.equal(removals, 0);
  assert.deepEqual(summary.failures, ['browser:owned-cleanup-failed']);
});

test('non-Windows supervisor still requires worker close before profile removal', async () => {
  const { runS9Supervisor } = await loadHarness();
  const worker = createFakeWorker();
  const output = createSupervisorConsole();
  const processLike = createSupervisorProcess();
  let removals = 0;
  let processGroupTerminations = 0;

  const summary = await runS9Supervisor({
    processLike,
    dependencies: {
      consoleLike: output.consoleLike,
      makeProfile: () => path.resolve('C:/Temp/revolution-s9-edge-non-windows'),
      platform: 'linux',
      removeProfile: async () => { removals += 1; },
      spawnWorker: () => worker,
      tempRoot: path.resolve('C:/Temp'),
      terminateProfileProcesses: () => assert.fail('non-Windows must not use CIM cleanup'),
      terminateWorker: async () => { processGroupTerminations += 1; },
      workerCloseTimeoutMs: 1,
    },
  });

  assert.equal(processGroupTerminations, 1);
  assert.equal(removals, 0);
  assert.deepEqual(summary.failures, ['browser:owned-cleanup-failed']);
});

test('supervisor preserves a valid failing IPC summary and expected termination does not pollute it', async () => {
  const { runS9Supervisor } = await loadHarness();
  const workerSummary = createPublicSummary(['desktop:works:hash']);
  const worker = createFakeWorker({ summary: workerSummary });
  const output = createSupervisorConsole();
  const processLike = createSupervisorProcess();

  const summary = await runS9Supervisor({
    processLike,
    dependencies: {
      consoleLike: output.consoleLike,
      makeProfile: () => path.resolve('C:/Temp/revolution-s9-edge-failed'),
      removeProfile: async () => {},
      spawnWorker: () => worker,
      platform: 'win32',
      tempRoot: path.resolve('C:/Temp'),
      terminateProfileProcesses: async () => terminateFakeWorker(worker),
    },
  });

  assert.deepEqual(summary.failures, workerSummary.failures);
  assert.deepEqual(output.stderr, ['S9_VISUAL_SMOKE_FAILED']);
  assert.doesNotMatch(output.stdout.join('') + output.stderr.join(''), /private|C:\\Temp|SIGTERM/);
  assert.equal(processLike.exitCode, 1);
});

test('supervisor accepts the exact complete worker summary produced by the live gate', async () => {
  const { runS9Supervisor } = await loadHarness();
  const harnessRoutes = [
    '/',
    '/works',
    '/works#content-agent',
    '/works#auto-operations',
    '/works#not-a-project',
    '/works/content-agent',
    '/works/auto-operations',
    '/works/deep-research',
    '/works/digital-morse',
  ];
  const workerSummary = {
    ...createPublicSummary(),
    screenshots: ['docs/verify/s9/s9-home-desktop-1440x900.png'],
    routeStatuses: harnessRoutes.map((route) => ({
      route,
      statuses: route.startsWith('/works/') ? [307, 200] : [200],
      viewport: 'desktop',
    })),
    canvasPixelVariance: {
      desktop: {
        frameDifference: 1,
        sampleHeight: 90,
        sampleWidth: 160,
        variance: 2,
      },
    },
    expandedSlugs: { desktop: ['content-agent'] },
    horizontalOverflow: harnessRoutes.map((route) => ({
      pixels: 0,
      route,
      viewport: 'desktop',
    })),
  };
  const output = createSupervisorConsole();
  const processLike = createSupervisorProcess();
  const worker = createFakeWorker({ summary: workerSummary });

  const summary = await runS9Supervisor({
    processLike,
    dependencies: {
      consoleLike: output.consoleLike,
      makeProfile: () => path.resolve('C:/Temp/revolution-s9-edge-full-summary'),
      removeProfile: async () => {},
      spawnWorker: () => worker,
      platform: 'win32',
      tempRoot: path.resolve('C:/Temp'),
      terminateProfileProcesses: async () => terminateFakeWorker(worker),
    },
  });

  assert.deepEqual(summary, workerSummary);
  assert.deepEqual(output.stderr, []);
  assert.equal(processLike.exitCode, 0);
});

test('supervisor rejects every route outside the exact harness route allowlist', async () => {
  const { runS9Supervisor } = await loadHarness();
  const unsafeRoutes = [
    '/works/arbitrary-slug',
    '/works?token=private',
    'https://outside.example/works',
    '/works/../private',
    `/${'a'.repeat(500)}`,
  ];

  for (const route of unsafeRoutes) {
    for (const field of ['routeStatuses', 'horizontalOverflow']) {
      const workerSummary = {
        ...createPublicSummary(),
        [field]: field === 'routeStatuses'
          ? [{ route, statuses: [200], viewport: 'desktop' }]
          : [{ pixels: 0, route, viewport: 'desktop' }],
      };
      const output = createSupervisorConsole();
      const processLike = createSupervisorProcess();
      const worker = createFakeWorker({ summary: workerSummary });
      const summary = await runS9Supervisor({
        processLike,
        dependencies: {
          consoleLike: output.consoleLike,
          makeProfile: () => path.resolve('C:/Temp/revolution-s9-edge-unsafe-route'),
          removeProfile: async () => {},
          spawnWorker: () => worker,
          platform: 'win32',
          tempRoot: path.resolve('C:/Temp'),
          terminateProfileProcesses: async () => terminateFakeWorker(worker),
        },
      });

      assert.deepEqual(summary.failures, ['browser:worker-output-invalid'], `${field}: ${route}`);
      assert.doesNotMatch(output.stdout[0], /private|outside\.example|arbitrary-slug|a{64}/);
      assert.equal(processLike.exitCode, 1);
    }
  }
});

test('supervisor rejects invalid, duplicate, or oversized worker IPC messages with a fixed safe failure', async () => {
  const { runS9Supervisor } = await loadHarness();

  for (const scenario of [
    {
      start(worker) {
        setImmediate(() => worker.sendSummary('private profile C:\\Temp\\revolution-s9-edge-secret'));
      },
      worker: createFakeWorker({ autoMessage: false }),
    },
    {
      start(worker) {
        setImmediate(() => worker.sendSummary({ private: 'x'.repeat(70_000) }));
      },
      worker: createFakeWorker({ autoMessage: false }),
    },
    {
      start(worker) {
        setImmediate(() => {
          worker.sendSummary(createPublicSummary());
          worker.sendSummary(createPublicSummary());
        });
      },
      worker: createFakeWorker({ autoMessage: false }),
    },
  ]) {
    const output = createSupervisorConsole();
    const processLike = createSupervisorProcess();
    let terminations = 0;
    scenario.start?.(scenario.worker);
    const summary = await runS9Supervisor({
      processLike,
      dependencies: {
        consoleLike: output.consoleLike,
        makeProfile: () => path.resolve('C:/Temp/revolution-s9-edge-invalid-output'),
        removeProfile: async () => {},
        spawnWorker: () => scenario.worker,
        platform: 'win32',
        tempRoot: path.resolve('C:/Temp'),
        terminateProfileProcesses: async () => {
          terminations += 1;
          scenario.worker.finish({ code: 1, signal: 'SIGTERM' });
        },
      },
    });

    assert.deepEqual(summary.failures, ['browser:worker-output-invalid']);
    assert.equal(terminations, 1);
    assert.equal(output.stdout.length, 1);
    assert.doesNotMatch(output.stdout[0] + output.stderr.join(''), /private profile|revolution-s9-edge|x{32}/);
    assert.equal(processLike.exitCode, 1);
  }
});

test('supervisor maps worker error, close, disconnect, and IPC timeout before summary to one safe failure', async () => {
  const { runS9Supervisor } = await loadHarness();
  const scenarios = [
    (worker) => setImmediate(() => worker.failSpawn()),
    (worker) => setImmediate(() => worker.finish({ code: 1 })),
    (worker) => setImmediate(() => worker.disconnectIpc()),
    () => {},
  ];

  for (const [index, start] of scenarios.entries()) {
    const worker = createFakeWorker({ autoMessage: false });
    const output = createSupervisorConsole();
    const processLike = createSupervisorProcess();
    start(worker);
    const summary = await runS9Supervisor({
      processLike,
      dependencies: {
        consoleLike: output.consoleLike,
        makeProfile: () => path.resolve(`C:/Temp/revolution-s9-edge-worker-${index}`),
        removeProfile: async () => {},
        spawnWorker: () => worker,
        platform: 'win32',
        tempRoot: path.resolve('C:/Temp'),
        terminateProfileProcesses: async () => terminateFakeWorker(worker),
        workerMessageTimeoutMs: 1,
      },
    });

    assert.deepEqual(summary.failures, ['browser:worker-process-failed'], `scenario ${index}`);
    assert.equal(output.stdout.length, 1);
    assert.doesNotMatch(output.stdout[0] + output.stderr.join(''), /private spawn|C:\\Temp/);
    assert.equal(processLike.exitCode, 1);
  }
});

test('Windows supervisor does not delete a profile after profile-process cleanup errors', async () => {
  const { runS9Supervisor } = await loadHarness();

  const worker = createFakeWorker();
  const output = createSupervisorConsole();
  const processLike = createSupervisorProcess();
  let removals = 0;
  const summary = await runS9Supervisor({
    processLike,
    dependencies: {
      consoleLike: output.consoleLike,
      makeProfile: () => path.resolve('C:/Temp/revolution-s9-edge-cleanup-error'),
      removeProfile: async () => { removals += 1; },
      spawnWorker: () => worker,
      platform: 'win32',
      tempRoot: path.resolve('C:/Temp'),
      terminateProfileProcesses: async () => {
        throw new Error('private profile process cleanup failure');
      },
      workerCloseTimeoutMs: 1,
    },
  });

  assert.deepEqual(summary.failures, ['browser:owned-cleanup-failed']);
  assert.equal(removals, 0);
  assert.equal(output.stdout.length, 1);
  assert.doesNotMatch(output.stdout[0] + output.stderr.join(''), /private profile process|C:\\Temp/);
});

test('supervisor reports only the fixed cleanup failure when profile deletion fails', async () => {
  const { runS9Supervisor } = await loadHarness();
  const output = createSupervisorConsole();
  const processLike = createSupervisorProcess();
  const worker = createFakeWorker();

  const summary = await runS9Supervisor({
    processLike,
    dependencies: {
      consoleLike: output.consoleLike,
      makeProfile: () => path.resolve('C:/Temp/revolution-s9-edge-cleanup-fails'),
      removeProfile: async () => {
        throw new Error('private cleanup path and native error');
      },
      spawnWorker: () => worker,
      platform: 'win32',
      tempRoot: path.resolve('C:/Temp'),
      terminateProfileProcesses: async () => terminateFakeWorker(worker),
    },
  });

  assert.deepEqual(summary.failures, ['browser:owned-cleanup-failed']);
  assert.equal(output.stdout.length, 1);
  assert.equal(output.stderr.join('\n'), 'S9_VISUAL_SMOKE_FAILED');
  assert.doesNotMatch(output.stdout[0] + output.stderr.join(''), /private cleanup|native error|C:\\Temp/);
  assert.equal(processLike.exitCode, 1);
});

test('Windows supervisor SIGINT and SIGTERM paths clear profile processes, clean once, and emit once', async () => {
  const { runS9Supervisor } = await loadHarness();

  for (const { signal, exitCode } of [
    { signal: 'SIGINT', exitCode: 130 },
    { signal: 'SIGTERM', exitCode: 143 },
  ]) {
    const output = createSupervisorConsole();
    const processLike = createSupervisorProcess();
    const worker = createFakeWorker({ autoMessage: false });
    const calls = [];
    const running = runS9Supervisor({
      processLike,
      dependencies: {
        consoleLike: output.consoleLike,
        makeProfile: () => path.resolve('C:/Temp/revolution-s9-edge-signal'),
        removeProfile: async () => calls.push('remove'),
        spawnWorker: () => worker,
        platform: 'win32',
        tempRoot: path.resolve('C:/Temp'),
        terminateProfileProcesses: async () => {
          calls.push('profile-process-cleanup');
          worker.finish({ code: exitCode, signal });
        },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    processLike.emit(signal);
    const summary = await running;

    assert.deepEqual(calls, ['profile-process-cleanup', 'remove']);
    assert.deepEqual(summary.failures, ['browser:worker-interrupted']);
    assert.equal(output.stdout.length, 1);
    assert.deepEqual(output.stderr, ['S9_VISUAL_SMOKE_FAILED']);
    assert.deepEqual(processLike.exits, [exitCode]);
    assert.equal(processLike.listenerCount('SIGINT'), 0);
    assert.equal(processLike.listenerCount('SIGTERM'), 0);
  }
});

test('supervisor rejects an out-of-bound profile before spawning or deleting', async () => {
  const { runS9Supervisor } = await loadHarness();
  const output = createSupervisorConsole();
  const processLike = createSupervisorProcess();
  let spawns = 0;
  let removals = 0;

  const summary = await runS9Supervisor({
    processLike,
    dependencies: {
      consoleLike: output.consoleLike,
      makeProfile: () => path.resolve('C:/Users/Someone/revolution-s9-edge-outside'),
      removeProfile: async () => { removals += 1; },
      spawnWorker: () => {
        spawns += 1;
        return createFakeWorker();
      },
      tempRoot: path.resolve('C:/Temp'),
    },
  });

  assert.equal(spawns, 0);
  assert.equal(removals, 0);
  assert.deepEqual(summary.failures, ['browser:profile-boundary']);
  assert.equal(output.stdout.length, 1);
  assert.equal(processLike.exitCode, 1);
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
    options: { force: true, maxRetries: 0, recursive: true },
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

test('profile cleanup retries only transient Windows locks and remains bounded', async () => {
  const { removeOwnedProfileWithRetry } = await loadHelpers();
  assert.equal(typeof removeOwnedProfileWithRetry, 'function');
  const waits = [];
  let attempts = 0;
  let nowMs = 0;

  await removeOwnedProfileWithRetry('C:/Temp/revolution-s9-edge-owned', {
    now: () => nowMs,
    poll: async (milliseconds) => {
      waits.push(milliseconds);
      nowMs += milliseconds;
    },
    removeProfile: () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('private locked path'), { code: 'EPERM' });
      if (attempts === 2) throw Object.assign(new Error('private locked path'), { code: 'EACCES' });
    },
    timeoutMs: 500,
  });
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [100, 100]);

  let boundedAttempts = 0;
  nowMs = 0;
  await assert.rejects(
    removeOwnedProfileWithRetry('C:/Temp/revolution-s9-edge-owned', {
      now: () => nowMs,
      poll: async (milliseconds) => { nowMs += milliseconds; },
      removeProfile: () => {
        boundedAttempts += 1;
        throw Object.assign(new Error('private locked path'), { code: 'EBUSY' });
      },
      timeoutMs: 200,
    }),
    (error) => error?.code === 'OWNED_PROFILE_CLEANUP_FAILED',
  );
  assert.equal(boundedAttempts, 3);

  let permanentAttempts = 0;
  await assert.rejects(
    removeOwnedProfileWithRetry('C:/Temp/revolution-s9-edge-owned', {
      poll: async () => assert.fail('permanent errors must not be retried'),
      removeProfile: () => {
        permanentAttempts += 1;
        throw Object.assign(new Error('private invalid path'), { code: 'EINVAL' });
      },
      timeoutMs: 500,
    }),
    (error) => error?.code === 'EINVAL',
  );
  assert.equal(permanentAttempts, 1);
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

test('network monitor ignores only exact tracked aborts from any retired navigation loader', async () => {
  const { createNetworkMonitor } = await loadHelpers();
  const monitor = createNetworkMonitor({ targetOrigin: 'http://127.0.0.1:3010' });

  monitor.beginNavigation('/');
  monitor.handle('Network.requestWillBeSent', {
    loaderId: 'loader-a',
    request: { url: 'http://127.0.0.1:3010/' },
    requestId: 'document-a',
    type: 'Document',
  });
  for (const [requestId, type, url] of [
    ['retired-font', 'Font', 'http://127.0.0.1:3010/fonts/morse.woff2'],
    ['failed-script', 'Script', 'http://127.0.0.1:3010/app.js'],
    ['uncanceled-stylesheet', 'Stylesheet', 'http://127.0.0.1:3010/app.css'],
    ['external-image', 'Image', 'https://outside.example/image.png'],
    ['url-less-fetch', 'Fetch', 'invalid request url'],
  ]) {
    monitor.handle('Network.requestWillBeSent', {
      loaderId: 'loader-a',
      request: { url },
      requestId,
      type,
    });
  }

  monitor.beginNavigation('/works');
  monitor.handle('Network.requestWillBeSent', {
    loaderId: 'loader-b',
    request: { url: 'http://127.0.0.1:3010/works' },
    requestId: 'document-b',
    type: 'Document',
  });
  monitor.beginNavigation('/');
  monitor.handle('Network.requestWillBeSent', {
    loaderId: 'loader-c',
    request: { url: 'http://127.0.0.1:3010/' },
    requestId: 'document-c',
    type: 'Document',
  });
  monitor.handle('Network.requestWillBeSent', {
    loaderId: 'loader-c',
    request: { url: 'http://127.0.0.1:3010/fonts/current.woff2' },
    requestId: 'current-font',
    type: 'Font',
  });

  monitor.handle('Network.loadingFailed', {
    canceled: true,
    errorText: 'net::ERR_ABORTED',
    requestId: 'retired-font',
    type: 'Font',
  });
  assert.deepEqual(monitor.snapshot().failures, []);

  for (const failure of [
    { canceled: true, errorText: 'net::ERR_ABORTED', requestId: 'current-font', type: 'Font' },
    { canceled: true, errorText: 'net::ERR_FAILED', requestId: 'failed-script', type: 'Script' },
    {
      canceled: false,
      errorText: 'net::ERR_ABORTED',
      requestId: 'uncanceled-stylesheet',
      type: 'Stylesheet',
    },
    { canceled: true, errorText: 'net::ERR_ABORTED', requestId: 'external-image', type: 'Image' },
    { canceled: true, errorText: 'net::ERR_ABORTED', requestId: 'url-less-fetch', type: 'Fetch' },
    { canceled: true, errorText: 'net::ERR_ABORTED', requestId: 'untracked-other', type: 'Other' },
  ]) {
    monitor.handle('Network.loadingFailed', failure);
  }

  assert.deepEqual(monitor.snapshot().failures, [
    '/:network-Font-failed',
    '/:network-Script-failed',
    '/:network-Stylesheet-failed',
    '/:network-Image-failed',
    '/:network-Fetch-failed',
    '/:network-Other-failed',
  ]);
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

test('network monitor ignores an exact current-document favicon cancellation', async () => {
  const { createNetworkMonitor } = await loadHelpers();
  const monitor = createNetworkMonitor({ targetOrigin: 'http://127.0.0.1:3010' });

  monitor.beginNavigation('/works');
  monitor.handle('Network.requestWillBeSent', {
    loaderId: 'loader-current',
    request: { url: 'http://127.0.0.1:3010/works' },
    requestId: 'document-current',
    type: 'Document',
  });
  monitor.handle('Network.requestWillBeSent', {
    loaderId: 'loader-current',
    request: { url: 'http://127.0.0.1:3010/icon.svg' },
    requestId: 'icon-current',
    type: 'Other',
  });
  monitor.handle('Network.loadingFailed', {
    canceled: true,
    errorText: 'net::ERR_ABORTED',
    requestId: 'icon-current',
    type: 'Other',
  });

  assert.deepEqual(monitor.snapshot().failures, []);
});

test('network monitor ignores the Next-versioned favicon canceled with a retired document', async () => {
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
    request: { url: 'http://127.0.0.1:3010/icon.svg?icon.1z5tp9-bb1htd.svg' },
    requestId: 'next-versioned-icon',
    type: 'Other',
  });
  monitor.beginNavigation('/works');
  monitor.handle('Network.loadingFailed', {
    canceled: true,
    errorText: 'net::ERR_ABORTED',
    requestId: 'next-versioned-icon',
    type: 'Other',
  });

  assert.deepEqual(monitor.snapshot().failures, []);
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

test('project scroll geometry accepts the closest reachable visible position at maxScrollY', async () => {
  const { isProjectScrollGeometryAcceptable } = await loadHelpers();
  assert.equal(typeof isProjectScrollGeometryAcceptable, 'function');

  const bottomLimited = {
    articleBottom: 700,
    articleTop: 300,
    clientHeight: 844,
    scrollHeight: 2_044,
    scrollMarginTop: 96,
    scrollY: 1_200,
    viewportHeight: 844,
  };
  assert.equal(isProjectScrollGeometryAcceptable(bottomLimited), true);
  assert.equal(isProjectScrollGeometryAcceptable({
    ...bottomLimited,
    articleBottom: 900,
    articleTop: 500,
    scrollY: 1_000,
  }), false);
  assert.equal(isProjectScrollGeometryAcceptable({
    ...bottomLimited,
    articleBottom: 1_000,
    articleTop: 900,
  }), false);
});

test('project scroll stability waits through asynchronous final scroll and requires quiet frames', async () => {
  const { assertConsecutiveProjectScrollStable } = await loadHelpers();
  assert.equal(typeof assertConsecutiveProjectScrollStable, 'function');
  const moving = {
    articleBottom: 900,
    articleTop: 500,
    clientHeight: 844,
    scrollHeight: 2_044,
    scrollMarginTop: 96,
    scrollY: 1_000,
    viewportHeight: 844,
  };
  const settled = {
    ...moving,
    articleBottom: 700,
    articleTop: 300,
    scrollY: 1_200,
  };
  const samples = [moving, settled, settled, settled, settled];
  let sampleIndex = 0;
  let frameCount = 0;

  const finalState = await assertConsecutiveProjectScrollStable({
    maxFrames: 8,
    quietFrames: 3,
    requestFrame: async () => { frameCount += 1; },
    sample: async () => samples[Math.min(sampleIndex++, samples.length - 1)],
  });

  assert.deepEqual(finalState, settled);
  assert.equal(frameCount, 4);
  assert.equal(sampleIndex, 4);

  await assert.rejects(
    assertConsecutiveProjectScrollStable({
      maxFrames: 3,
      quietFrames: 2,
      requestFrame: async () => {},
      sample: async () => moving,
    }),
    (error) => error?.code === 'PROJECT_SCROLL_STABILITY_TIMEOUT',
  );
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
