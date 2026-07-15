import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEVTOOLS_BROWSER_PATH = /^\/devtools\/browser\/[A-Za-z0-9._-]+$/;
const ENDPOINT_POLL_MS = 50;
const NETWORK_RESOURCE_TYPES = new Set([
  'CSPViolationReport',
  'Document',
  'EventSource',
  'Fetch',
  'Font',
  'Image',
  'Manifest',
  'Media',
  'Other',
  'Ping',
  'Prefetch',
  'Preflight',
  'Script',
  'SignedExchange',
  'Stylesheet',
  'TextTrack',
  'WebSocket',
  'XHR',
]);
const SUMMARY_VIEWPORTS = ['desktop', 'mobile', 'mobile-reduced'];

export function createS9Summary(input = {}) {
  const strings = (values) => (
    Array.isArray(values) ? values.filter((value) => typeof value === 'string') : []
  );
  const number = (value) => (Number.isFinite(value) ? value : 0);
  const canvasPixelVariance = {};
  const expandedSlugs = {};

  for (const viewport of SUMMARY_VIEWPORTS) {
    const canvas = input.canvasPixelVariance?.[viewport];
    if (canvas && typeof canvas === 'object') {
      canvasPixelVariance[viewport] = {
        frameDifference: number(canvas.frameDifference),
        sampleHeight: number(canvas.sampleHeight),
        sampleWidth: number(canvas.sampleWidth),
        variance: number(canvas.variance),
      };
    }
    if (Array.isArray(input.expandedSlugs?.[viewport])) {
      expandedSlugs[viewport] = strings(input.expandedSlugs[viewport]);
    }
  }

  return {
    failures: strings(input.failures),
    screenshots: strings(input.screenshots),
    routeStatuses: Array.isArray(input.routeStatuses)
      ? input.routeStatuses.map((entry) => ({
        route: typeof entry?.route === 'string' ? entry.route : 'route',
        statuses: Array.isArray(entry?.statuses)
          ? entry.statuses.filter(Number.isFinite)
          : [],
        viewport: typeof entry?.viewport === 'string' ? entry.viewport : 'unknown',
      }))
      : [],
    canvasPixelVariance,
    expandedSlugs,
    horizontalOverflow: Array.isArray(input.horizontalOverflow)
      ? input.horizontalOverflow.map((entry) => ({
        pixels: number(entry?.pixels),
        route: typeof entry?.route === 'string' ? entry.route : 'route',
        viewport: typeof entry?.viewport === 'string' ? entry.viewport : 'unknown',
      }))
      : [],
    consoleErrors: number(input.consoleErrors),
    pageErrors: number(input.pageErrors),
    externalRuntimeRequests: strings(input.externalRuntimeRequests),
  };
}

export class S9CdpError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export async function assertConsecutiveAnimationFramesQuiet({
  expectedValue,
  maxFrames,
  quietFrames,
  requestFrame,
  sample,
}) {
  if (
    !Number.isInteger(maxFrames)
    || !Number.isInteger(quietFrames)
    || quietFrames < 1
    || maxFrames < quietFrames
  ) {
    throw new S9CdpError('ANIMATION_FRAME_CONFIG_INVALID');
  }

  for (let frame = 0; frame < maxFrames; frame += 1) {
    await requestFrame();
    if (!Object.is(await sample(), expectedValue)) {
      throw new S9CdpError('ANIMATION_FRAME_ACTIVITY');
    }
    if (frame + 1 >= quietFrames) return;
  }
  throw new S9CdpError('ANIMATION_FRAME_QUIET_TIMEOUT');
}

export async function dispatchPrimaryClick(client, {
  pointerMode,
  selector,
}) {
  if (pointerMode !== 'mouse' && pointerMode !== 'touch') {
    throw new S9CdpError('POINTER_MODE_INVALID');
  }
  const point = await client.evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!(target instanceof Element)) return null;
    target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
    const style = getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden'
      || Number.parseFloat(style.opacity || '1') <= 0
      || style.pointerEvents === 'none' || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const x = (rect.left + rect.right) / 2;
    const y = (rect.top + rect.bottom) / 2;
    if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) return null;
    const hit = document.elementFromPoint(x, y);
    if (!(hit instanceof Element) || (hit !== target && !target.contains(hit))) return null;
    return { x, y };
  })()`);
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
    throw new S9CdpError('POINTER_TARGET_UNAVAILABLE');
  }

  if (pointerMode === 'touch') {
    await client.send('Input.dispatchTouchEvent', {
      touchPoints: [{
        force: 1,
        id: 1,
        radiusX: 1,
        radiusY: 1,
        x: point.x,
        y: point.y,
      }],
      type: 'touchStart',
    });
    await client.send('Input.dispatchTouchEvent', {
      touchPoints: [],
      type: 'touchEnd',
    });
    return;
  }

  await client.send('Input.dispatchMouseEvent', {
    button: 'none',
    buttons: 0,
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
  });
  await client.send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 1,
    clickCount: 1,
    type: 'mousePressed',
    x: point.x,
    y: point.y,
  });
  await client.send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 0,
    clickCount: 1,
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
  });
}

export function createNetworkMonitor({ targetOrigin }) {
  const targetUrl = new URL(targetOrigin);
  const requests = new Map();
  const failures = new Set();
  const externalOrigins = new Set();
  const httpFailures = [];
  let currentDocument = null;
  let expectedAbortedDocument = null;
  let currentRoute = 'route';
  let navigationStatuses = [];

  const routeLabel = (route) => {
    if (route === '/' || route === '/works') return route;
    return 'route';
  };
  const resourceType = (type) => (
    NETWORK_RESOURCE_TYPES.has(type) ? type : 'Other'
  );
  const sameTargetEndpoint = (url) => {
    const targetProtocols = targetUrl.protocol === 'https:'
      ? new Set(['https:', 'wss:'])
      : new Set(['http:', 'ws:']);
    return targetProtocols.has(url.protocol)
      && url.hostname === targetUrl.hostname
      && url.port === targetUrl.port;
  };
  const isTargetNavigationIcon = (value) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    return sameTargetEndpoint(url)
      && url.pathname === '/icon.svg'
      && url.search === ''
      && url.hash === '';
  };
  const recordResponse = (response, type, route = currentRoute) => {
    let url;
    try {
      url = new URL(response?.url);
    } catch {
      return;
    }
    if (!sameTargetEndpoint(url)) return;

    const status = Math.round(Number(response?.status) || 0);
    const safeType = resourceType(type);
    if (safeType === 'Document' && status > 0) navigationStatuses.push(status);
    if (status >= 400) httpFailures.push({ route, status, type: safeType });
  };
  const recordExternalOrigin = (value) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      return;
    }
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return;
    if (!sameTargetEndpoint(url)) externalOrigins.add(url.origin);
  };

  return {
    beginNavigation(route) {
      expectedAbortedDocument = currentDocument;
      currentRoute = routeLabel(route);
      navigationStatuses = [];
    },
    endNavigation() {
      return [...navigationStatuses];
    },
    handle(method, params = {}) {
      if (method === 'Network.requestWillBeSent') {
        const type = resourceType(params.type);
        if (params.redirectResponse) {
          recordResponse(params.redirectResponse, type);
        }
        const request = {
          isNavigationIcon: type === 'Other' && isTargetNavigationIcon(params.request?.url),
          loaderId: typeof params.loaderId === 'string' ? params.loaderId : null,
          requestId: typeof params.requestId === 'string' ? params.requestId : null,
          route: currentRoute,
          type,
        };
        if (request.requestId) {
          requests.set(request.requestId, request);
          if (type === 'Document') currentDocument = request;
        }
        recordExternalOrigin(params.request?.url);
        return;
      }

      if (method === 'Network.responseReceived') {
        const request = requests.get(params.requestId);
        recordResponse(params.response, request?.type ?? params.type, request?.route);
        return;
      }

      if (method === 'Network.loadingFailed') {
        const request = requests.get(params.requestId);
        const type = resourceType(request?.type ?? params.type);
        if (request === undefined && type === 'Other') return;
        const isExpectedDocumentAbort = type === 'Document'
          && request !== undefined
          && expectedAbortedDocument !== null
          && params.errorText === 'net::ERR_ABORTED'
          && request?.requestId === expectedAbortedDocument?.requestId
          && request?.loaderId === expectedAbortedDocument?.loaderId;
        const isExpectedNavigationIconAbort = type === 'Other'
          && request?.isNavigationIcon === true
          && expectedAbortedDocument !== null
          && params.canceled === true
          && params.errorText === 'net::ERR_ABORTED'
          && request?.loaderId === expectedAbortedDocument?.loaderId;
        if (!isExpectedDocumentAbort && !isExpectedNavigationIconAbort) {
          failures.add(`${request?.route ?? currentRoute}:network-${type}-failed`);
        }
        if (request?.requestId) requests.delete(request.requestId);
        if (isExpectedDocumentAbort) expectedAbortedDocument = null;
        return;
      }

      if (method === 'Network.webSocketCreated') {
        recordExternalOrigin(params.url);
      }
    },
    snapshot() {
      return {
        externalOrigins: [...externalOrigins].sort(),
        failures: [...failures],
        httpFailures: httpFailures.map((failure) => ({ ...failure })),
      };
    },
  };
}

export function readOwnedDevToolsActivePort({
  fsApi,
  profileDir,
  startedAtMs,
}) {
  const activePortPath = path.join(profileDir, 'DevToolsActivePort');
  const content = fsApi.readFileSync(activePortPath, 'utf8');
  const { mtimeMs } = fsApi.statSync(activePortPath);
  if (!Number.isFinite(mtimeMs) || mtimeMs < startedAtMs) {
    throw new S9CdpError('OWNED_ENDPOINT_STALE');
  }

  const lines = content.replaceAll('\r\n', '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== 2 || !/^\d+$/.test(lines[0])) {
    throw new S9CdpError('OWNED_ENDPOINT_INVALID');
  }

  const port = Number(lines[0]);
  const browserPath = lines[1];
  if (
    !Number.isInteger(port)
    || port < 1
    || port > 65_535
    || !DEVTOOLS_BROWSER_PATH.test(browserPath)
  ) {
    throw new S9CdpError('OWNED_ENDPOINT_INVALID');
  }

  return {
    browserPath,
    browserWebSocketUrl: `ws://127.0.0.1:${port}${browserPath}`,
    cdpBase: `http://127.0.0.1:${port}`,
    port,
  };
}

export async function waitForOwnedDevToolsActivePort({
  fsApi,
  isProcessExited,
  now = Date.now,
  poll = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  profileDir,
  startedAtMs,
  timeoutMs,
}) {
  const deadline = now() + timeoutMs;

  while (true) {
    if (isProcessExited()) throw new S9CdpError('OWNED_BROWSER_EXITED');
    try {
      return readOwnedDevToolsActivePort({ fsApi, profileDir, startedAtMs });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    if (now() >= deadline) throw new S9CdpError('OWNED_ENDPOINT_TIMEOUT');
    await poll(ENDPOINT_POLL_MS);
  }
}

export function createCdpTransport(socket, {
  commandTimeoutMs = 10_000,
  onEvent = () => {},
} = {}) {
  let commandId = 0;
  let disposed = false;
  const pending = new Map();

  const removeListeners = () => {
    socket.removeEventListener('message', handleMessage);
    socket.removeEventListener('error', handleError);
    socket.removeEventListener('close', handleClose);
  };

  const dispose = (code = 'CDP_TRANSPORT_DISPOSED') => {
    if (disposed) return;
    disposed = true;
    removeListeners();
    for (const command of pending.values()) {
      clearTimeout(command.timeout);
      command.reject(new S9CdpError(code));
    }
    pending.clear();
    if (socket.readyState < 2) socket.close();
  };

  function handleMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!message.id) {
      onEvent(message);
      return;
    }
    if (!pending.has(message.id)) return;

    const command = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(command.timeout);
    if (message.error) command.reject(new S9CdpError('CDP_COMMAND_FAILED'));
    else command.resolve(message.result ?? {});
  }

  function handleError() {
    dispose('CDP_TRANSPORT_ERROR');
  }

  function handleClose() {
    dispose('CDP_TRANSPORT_CLOSED');
  }

  socket.addEventListener('message', handleMessage);
  socket.addEventListener('error', handleError);
  socket.addEventListener('close', handleClose);

  return {
    dispose,
    get pendingCount() {
      return pending.size;
    },
    send(method, params = {}, timeoutMs = commandTimeoutMs) {
      return new Promise((resolve, reject) => {
        if (disposed || socket.readyState !== 1) {
          reject(new S9CdpError('CDP_TRANSPORT_NOT_OPEN'));
          return;
        }
        const id = ++commandId;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new S9CdpError('CDP_COMMAND_TIMEOUT'));
        }, timeoutMs);
        pending.set(id, { reject, resolve, timeout });
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch {
          clearTimeout(timeout);
          pending.delete(id);
          reject(new S9CdpError('CDP_COMMAND_SEND_FAILED'));
        }
      });
    },
  };
}

export function connectCdpTransport(webSocketUrl, {
  WebSocketCtor = WebSocket,
  commandTimeoutMs = 10_000,
  connectTimeoutMs = 5_000,
  onEvent = () => {},
} = {}) {
  const socket = new WebSocketCtor(webSocketUrl);

  return new Promise((resolve, reject) => {
    let settled = false;
    const removeListeners = () => {
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('error', handleError);
      socket.removeEventListener('close', handleClose);
    };
    const fail = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      removeListeners();
      socket.close();
      reject(new S9CdpError(code));
    };
    const handleOpen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      removeListeners();
      resolve(createCdpTransport(socket, { commandTimeoutMs, onEvent }));
    };
    const handleError = () => fail('CDP_CONNECT_ERROR');
    const handleClose = () => fail('CDP_CONNECT_CLOSED');

    socket.addEventListener('open', handleOpen);
    socket.addEventListener('error', handleError);
    socket.addEventListener('close', handleClose);
    const timeout = setTimeout(() => fail('CDP_CONNECT_TIMEOUT'), connectTimeoutMs);
  });
}

export function createCleanupCoordinator(cleanup) {
  let cleanupPromise = null;
  return {
    run(reason) {
      if (!cleanupPromise) {
        cleanupPromise = Promise.resolve().then(() => cleanup(reason));
      }
      return cleanupPromise;
    },
  };
}

export function installSignalCleanup({
  coordinator,
  exit,
  processLike,
}) {
  let handlingSignal = false;
  const dispose = () => {
    processLike.removeListener('SIGINT', handleSigint);
    processLike.removeListener('SIGTERM', handleSigterm);
  };
  const handle = (signal, exitCode) => {
    if (handlingSignal) return;
    handlingSignal = true;
    void coordinator.run(signal).then(
      () => {
        dispose();
        exit(exitCode);
      },
      () => {
        dispose();
        exit(exitCode);
      },
    );
  };
  const handleSigint = () => handle('SIGINT', 130);
  const handleSigterm = () => handle('SIGTERM', 143);

  processLike.on('SIGINT', handleSigint);
  processLike.on('SIGTERM', handleSigterm);
  return dispose;
}

export function terminateOwnedProcessTree(child, {
  killFn = process.kill,
  platform = process.platform,
  spawnSyncFn = spawnSync,
} = {}) {
  if (!child || child.exitCode !== null) return;
  if (!Number.isInteger(child.pid) || child.pid < 1) {
    throw new S9CdpError('OWNED_PROCESS_INVALID');
  }

  if (platform === 'win32') {
    spawnSyncFn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  killFn(-child.pid, 'SIGKILL');
}

export function removeOwnedProfile(profileDir, {
  rmSyncFn = rmSync,
  tempRoot = os.tmpdir(),
} = {}) {
  const resolvedProfile = path.resolve(profileDir);
  const resolvedTemp = `${path.resolve(tempRoot)}${path.sep}`;
  const insideTemp = resolvedProfile.toLowerCase().startsWith(resolvedTemp.toLowerCase());
  if (
    !insideTemp
    || !path.basename(resolvedProfile).startsWith('revolution-s9-edge-')
  ) {
    throw new S9CdpError('OWNED_PROFILE_BOUNDARY');
  }
  rmSyncFn(resolvedProfile, {
    force: true,
    maxRetries: 3,
    recursive: true,
    retryDelay: 100,
  });
}

export function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (exited) => {
      clearTimeout(timeout);
      child.removeListener('exit', handleExit);
      resolve(exited);
    };
    const handleExit = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', handleExit);
  });
}

export async function cleanupOwnedBrowser(browser, {
  closeTimeoutMs = 2_000,
  connectTransport = connectCdpTransport,
  removeProfile = removeOwnedProfile,
  terminateProcessTree = terminateOwnedProcessTree,
  waitForExit = waitForChildExit,
} = {}) {
  if (!browser) return;

  if (browser.browserWebSocketUrl) {
    let transport;
    try {
      transport = await connectTransport(browser.browserWebSocketUrl, {
        commandTimeoutMs: closeTimeoutMs,
        connectTimeoutMs: closeTimeoutMs,
      });
      await transport.send('Browser.close', {}, closeTimeoutMs);
    } catch {
      // The owned process fallback below remains authoritative.
    } finally {
      transport?.dispose();
    }
  }

  if (!await waitForExit(browser.browserProcess, closeTimeoutMs)) {
    await terminateProcessTree(browser.browserProcess);
    if (!await waitForExit(browser.browserProcess, closeTimeoutMs)) {
      throw new S9CdpError('OWNED_PROCESS_CLEANUP_FAILED');
    }
  }
  await removeProfile(browser.profileDir);
}
