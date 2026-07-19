import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const files = {
  ambient: path.resolve('components/site/AmbientBackground.tsx'),
  layout: path.resolve('app/(portfolio)/layout.tsx'),
  morse: path.resolve('components/site/MorseSignalCanvas.tsx'),
  packageJson: path.resolve('package.json'),
  warp: path.resolve('components/site/WarpTunnelCanvas.tsx'),
  warpStyles: path.resolve('components/site/WarpTunnelCanvas.module.css'),
  visualSmoke: path.resolve('scripts/s9-visual-smoke.mjs'),
} as const;

function readSource(filePath: string): string {
  assert.ok(fs.existsSync(filePath), `missing expected file: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

test('portfolio shell selects the warp field only for the homepage', () => {
  const ambient = readSource(files.ambient);
  const layout = readSource(files.layout);

  assert.match(layout, /import AmbientBackground from ['"]@\/components\/site\/AmbientBackground['"]/);
  assert.equal((layout.match(/<AmbientBackground\s*\/>/g) ?? []).length, 1);
  assert.doesNotMatch(layout, /<MorseSignalCanvas\s*\/>/);

  assert.match(ambient, /^['"]use client['"];?/);
  assert.match(ambient, /usePathname/);
  assert.match(ambient, /dynamic\(\(\) => import\(['"]\.\/WarpTunnelCanvas['"]\)/);
  assert.match(ambient, /ssr:\s*false/);
  assert.match(ambient, /pathname === ['"]\/['"]/);
  assert.match(ambient, /<WarpTunnelCanvas\s*\/>/);
  assert.match(ambient, /<MorseSignalCanvas\s*\/>/);
});

test('warp field is a bounded tokenized Three.js enhancement with lifecycle guards', () => {
  const pkg = JSON.parse(readSource(files.packageJson)) as {
    dependencies?: Record<string, string>;
  };
  const source = readSource(files.warp);

  assert.ok(pkg.dependencies?.three, 'three must be a production dependency');
  assert.match(source, /^['"]use client['"];?/);
  assert.match(source, /from ['"]three['"]/);
  assert.match(source, /new WebGLRenderer/);
  assert.match(source, /new PerspectiveCamera/);
  assert.match(source, /new BufferGeometry/);
  assert.match(source, /new LineSegments/);
  assert.match(source, /AdditiveBlending/);
  assert.match(source, /Math\.min\(window\.devicePixelRatio \|\| 1, 1\.5\)/);
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
  assert.match(source, /document\.hidden/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /webglcontextlost/);
  assert.match(source, /preventDefault\(\)/);
  assert.match(source, /cancelAnimationFrame/);
  assert.match(source, /renderer\.dispose\(\)/);
  assert.match(source, /geometry\.dispose\(\)/);
  assert.match(source, /material\.dispose\(\)/);
  assert.match(source, /getPropertyValue\(name\)/);
  assert.match(source, /readToken\(['"]--bg['"]\)/);
  assert.match(source, /readToken\(['"]--accent['"]\)/);
  assert.match(source, /readToken\(['"]--status-blue['"]\)/);
  assert.match(source, /readToken\(['"]--status-amber['"]\)/);
  assert.match(source, /data-testid=['"]warp-tunnel-canvas['"]/);
  assert.match(source, /aria-hidden=['"]true['"]/);
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/i);
});

test('warp background is fixed, non-blocking, resume-safe, and motion-safe', () => {
  const styles = readSource(files.warpStyles);

  assert.match(styles, /position:\s*fixed/);
  assert.match(styles, /inset:\s*0/);
  assert.match(styles, /pointer-events:\s*none/);
  assert.match(styles, /background:\s*var\(--bg\)/);
  assert.match(styles, /:global\(html\.resume-mode\)/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*no-preference\)/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/i);
});

test('the production visual gate proves the homepage uses the warp background', () => {
  const source = readSource(files.visualSmoke);

  assert.equal((source.match(/warp-tunnel-canvas/g) ?? []).length, 5);
  assert.equal((source.match(/morse-signal-canvas/g) ?? []).length, 1);
  assert.match(
    source,
    /waitFor\([\s\S]*warp-tunnel-canvas[\s\S]*home:canvas-timeout/,
  );
  assert.match(source, /new Event\(['"]webglcontextlost['"], \{ cancelable: true \}\)/);
  assert.match(source, /home:context-loss-not-handled/);
  assert.match(source, /home:canvas-fallback-timeout/);
});
