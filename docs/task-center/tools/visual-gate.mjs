// CEO visual gate — S2 hero. Pitfall-aware: scroll reset, touch emulation + reload, bringToFront, frame settle.
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'docs/verify/v1';
fs.mkdirSync(OUT, { recursive: true });

const res = await fetch('http://localhost:9222/json/new?about:blank', { method: 'PUT' });
const tab = await res.json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });

let id = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    consoleErrors.push(JSON.stringify(m.params.args?.map(a => a.value ?? a.description ?? '')).slice(0, 300));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error')
    consoleErrors.push(m.params.entry.text?.slice(0, 300));
  if (m.method === 'Runtime.exceptionThrown')
    consoleErrors.push('EXCEPTION: ' + (m.params.exceptionDetails?.text ?? '').slice(0, 300));
};
const send = (method, params = {}) => new Promise((ok) => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;

const shot = async (file) => {
  await send('Page.bringToFront');
  await evaluate('window.scrollTo(0,0)');
  await sleep(1200); // frame settle (throttled-tab stale frame pitfall)
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(r.result.data, 'base64'));
  return r.result.data;
};

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

// ---- Desktop 1440x900 ----
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://localhost:3000' });
await sleep(4500);
const d1 = await shot('desktop-hero.png');
const d2raw = await send('Page.captureScreenshot', { format: 'png' }); // second frame ~immediately after for animation check
const desktopInfo = await evaluate(`JSON.stringify({
  sh: document.documentElement.scrollHeight, ih: window.innerHeight,
  h1: !!document.querySelector('h1'), canvas: !!document.querySelector('canvas'),
  lifeform: !!(window.Lifeform && window.Lifeform.params),
  sample: document.body.innerText.slice(0,120)
})`);
const animDesktop = d1 !== d2raw.result.data;

// ---- Mobile 390x844 + touch + reload (pitfall #2) ----
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.reload', { ignoreCache: false });
await sleep(4500);
await shot('mobile-hero.png');
const mobileInfo = await evaluate(`JSON.stringify({
  coarse: matchMedia('(pointer: coarse)').matches,
  sh: document.documentElement.scrollHeight, ih: window.innerHeight,
  overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
})`);

// ---- reduced-motion: two frames must be identical ----
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Page.reload', { ignoreCache: false });
await sleep(4500);
const r1 = await shot('mobile-reduced-motion.png');
await sleep(1500);
const r2 = await send('Page.captureScreenshot', { format: 'png' });
const reducedStatic = r1 === r2.result.data;

console.log(JSON.stringify({ desktopInfo: JSON.parse(desktopInfo), animDesktop, mobileInfo: JSON.parse(mobileInfo), reducedStatic, consoleErrors }, null, 2));
ws.close();
