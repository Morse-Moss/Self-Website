import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const layoutPath = path.resolve('app/layout.tsx');
const worksLayoutPath = path.resolve('app/works/layout.tsx');
const pagePath = path.resolve('app/page.tsx');
const obsoleteShellPath = path.resolve('components/site/SiteShell.tsx');
const headerPath = path.resolve('components/site/SiteHeader.tsx');
const footerPath = path.resolve('components/site/SiteFooter.tsx');
const resumePath = path.resolve('components/site/ResumeSheet.tsx');
const resumeModePath = path.resolve('components/ResumeMode.tsx');
const canvasPath = path.resolve('components/site/MorseSignalCanvas.tsx');
const siteStylePath = path.resolve('components/site/SiteShell.module.css');
const resumeStylePath = path.resolve('components/ResumeMode.module.css');
const canvasStylePath = path.resolve('components/site/MorseSignalCanvas.module.css');

function readSource(filePath: string): string {
  assert.ok(fs.existsSync(filePath), `missing expected file: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

function readRule(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1];
  assert.ok(rule, `missing expected CSS rule: ${selector}`);
  return rule;
}

test('root layout owns the persistent visual shell and global resume surface', () => {
  const layout = readSource(layoutPath);

  assert.match(layout, /import\s+\{\s*siteContent\s*\}\s+from\s+["']@\/lib\/site-content["']/);
  assert.match(layout, /title:\s*siteContent\.site\.name/);
  assert.match(layout, /description:\s*siteContent\.site\.description/);
  assert.match(layout, /siteContent\.site\.resumeMode\.storageKey/);
  assert.match(layout, /siteContent\.site\.resumeMode\.bodyClass/);
  assert.doesNotMatch(layout, /s3-content/);
  assert.doesNotMatch(layout, /import\s+SiteShell|<SiteShell/);

  assert.equal(count(layout, /<MorseSignalCanvas\s*\/>/g), 1);
  assert.equal(count(layout, /<ScrollEffects\s*\/>/g), 1);
  assert.equal(count(layout, /<SiteHeader\b/g), 1);
  assert.equal(count(layout, /<SiteFooter\b/g), 1);
  assert.equal(count(layout, /<ResumeSheet\b/g), 1);
  assert.equal(count(layout, /data-standard-content/g), 1);
  assert.match(layout, /<SiteHeader\s+site=\{siteContent\.site\}\s*\/>/);
  assert.match(layout, /<SiteFooter\s+footer=\{siteContent\.site\.footer\}\s*\/>/);
  assert.match(layout, /printLabel=\{siteContent\.site\.resumeMode\.printLabel\}/);
  assert.match(layout, /resumeMode=\{siteContent\.site\.resumeMode\}/);
  assert.doesNotMatch(layout, /<MorseChat\b/);
});

test('route trees do not duplicate the global shell and works keeps only its chat overlay', () => {
  const page = readSource(pagePath);
  const worksLayout = readSource(worksLayoutPath);

  assert.equal(fs.existsSync(obsoleteShellPath), false);
  assert.doesNotMatch(page, /<ResumeModeToggle\b|<ResumeSheet\b|<MorseChat\b|<ScrollEffects\b/);
  assert.doesNotMatch(page, /data-standard-content/);
  assert.doesNotMatch(worksLayout, /SiteShell|SiteHeader|SiteFooter|ResumeSheet|ScrollEffects/);
  assert.match(worksLayout, /import MorseChat from ['"]@\/components\/MorseChat['"]/);
  assert.equal(count(worksLayout, /<MorseChat\s*\/>/g), 1);
  assert.match(worksLayout, /<>\s*\{children\}\s*<MorseChat\s*\/>\s*<\/>/s);
});

test('SiteHeader is a compact two-link navigation with inline chat and resume controls', () => {
  const header = readSource(headerPath);

  assert.match(header, /^['"]use client['"];?/);
  assert.match(header, /from\s+['"]next\/link['"]/);
  assert.match(header, /usePathname/);
  assert.match(header, /首页/);
  assert.match(header, /作品集/);
  assert.match(header, /<OpenChatButton\b/);
  assert.match(header, /<ResumeModeToggle\b/);
  assert.match(header, /<ResumeModeToggle\s+config=\{site\.resumeMode\}\s+inline\s*\/>/);
  assert.match(header, /aria-current=\{[^}]*\?\s*['"]page['"]\s*:\s*undefined\}/);
  assert.doesNotMatch(header, /className=\{styles\.brand\}|site\.name/);
  assert.doesNotMatch(header, /hamburger|menuOpen|菜单/i);
});

test('footer renders approved copy and maps only configured external links', () => {
  const footer = readSource(footerPath);

  assert.equal(count(footer, /footer\.morse/g), 1);
  assert.equal(count(footer, /footer\.statement/g), 1);
  assert.equal(count(footer, /footer\.copyright/g), 1);
  assert.match(footer, /footer\.links\.map/);
  assert.match(footer, /href=\{link\.href\}/);
  assert.match(footer, /target=['"]_blank['"]/);
  assert.match(footer, /rel=['"]noreferrer['"]/);
  assert.doesNotMatch(footer, /Email|WeChat|微信|邮箱/i);
});

test('ResumeSheet contains the approved profile and project statuses without stats or contact', () => {
  const resume = readSource(resumePath);

  assert.match(resume, /data-resume-section/);
  assert.match(resume, /profile\.title/);
  assert.match(resume, /profile\.role/);
  assert.match(resume, /profile\.summary/);
  assert.match(resume, /profile\.principles\.map/);
  assert.match(resume, /projects\.map/);
  assert.match(resume, /project\.name/);
  assert.match(resume, /project\.status/);
  assert.match(resume, /<ResumePrintButton\b/);
  assert.match(resume, /<ResumeModeExitButton\s+config=\{resumeMode\}\s*\/>/);
  assert.doesNotMatch(resume, /stats|contact|Email|WeChat/i);
});

test('resume sheet exit resets DOM mode, persistence, scroll, and header-toggle state', () => {
  const resumeMode = readSource(resumeModePath);

  assert.match(resumeMode, /export function ResumeModeExitButton/);
  assert.match(resumeMode, /applyResumeMode\(false,\s*config\.bodyClass\)/);
  assert.match(resumeMode, /localStorage\.setItem\(config\.storageKey,\s*['"]false['"]\)/);
  assert.match(resumeMode, /window\.scrollTo\(\{\s*top:\s*0,\s*behavior:\s*['"]auto['"]\s*\}\)/);
  assert.match(resumeMode, /morse-resume-mode:change/);
  assert.match(resumeMode, /addEventListener\(RESUME_MODE_CHANGE_EVENT/);
  assert.match(resumeMode, /removeEventListener\(RESUME_MODE_CHANGE_EVENT/);
});

test('ResumeModeToggle supports header-inline positioning without changing its behavior', () => {
  const resumeMode = readSource(resumeModePath);

  assert.match(resumeMode, /inline\??:\s*boolean/);
  assert.match(resumeMode, /inline\s*\?\s*styles\.inline/);
  assert.match(resumeMode, /aria-pressed=\{active\}/);
  assert.match(resumeMode, /localStorage\.setItem/);
});

test('MorseSignalCanvas uses one bounded native loop with responsive and lifecycle guards', () => {
  const canvas = readSource(canvasPath);

  assert.match(canvas, /^['"]use client['"];?/);
  assert.match(canvas, /useEffect/);
  assert.match(canvas, /useRef/);
  assert.match(canvas, /['"]\.['"],\s*['"]-['"],\s*['"]M['"],\s*['"]O['"],\s*['"]R['"],\s*['"]S['"],\s*['"]E['"],\s*['"]0['"],\s*['"]1['"],\s*['"]\/['"],\s*['"]>['"]/);
  assert.match(canvas, /prefers-reduced-motion:\s*reduce/);
  assert.match(canvas, /new ResizeObserver/);
  assert.match(canvas, /Math\.min\([^;]*1\.5\)/);
  assert.match(canvas, /document\.hidden/);
  assert.match(canvas, /visibilitychange/);
  assert.match(canvas, /cancelAnimationFrame/);
  assert.match(canvas, /\.disconnect\(\)/);
  assert.match(canvas, /removeEventListener\(['"]visibilitychange['"]/);
  assert.match(canvas, /<=\s*640/);
  assert.match(canvas, /\?\s*12\s*:\s*14/);
  assert.match(canvas, /\?\s*64\s*:\s*52/);
  assert.match(canvas, /\?\s*24\s*:\s*30/);
  assert.match(canvas, /getPropertyValue\(['"]--accent['"]\)/);
  assert.match(canvas, /globalAlpha\s*=\s*0\.16/);
  assert.match(canvas, /data-testid=['"]morse-signal-canvas['"]/);
  assert.match(canvas, /aria-hidden=['"]true['"]/);
  assert.doesNotMatch(canvas, /gsap|three|requestAnimationFrame\([^)]*while/i);
  assert.doesNotMatch(canvas, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/i);
});

test('shell and canvas styles keep interaction above a tokenized non-blocking background', () => {
  const siteStyles = readSource(siteStylePath);
  const resumeStyles = readSource(resumeStylePath);
  const canvasStyles = readSource(canvasStylePath);
  const styles = `${siteStyles}\n${resumeStyles}\n${canvasStyles}`;

  assert.match(siteStyles, /min-height:\s*44px/);
  assert.match(siteStyles, /@media\s*\(max-width:\s*640px\)/);
  assert.match(siteStyles, /flex-wrap:\s*nowrap/);
  assert.match(siteStyles, /white-space:\s*nowrap/);
  assert.match(resumeStyles, /min-height:\s*44px/);
  assert.match(readRule(resumeStyles, '.inline'), /position:\s*static/);
  assert.match(readRule(siteStyles, '.standardContent'), /position:\s*relative/);
  assert.match(readRule(siteStyles, '.standardContent'), /z-index:\s*1/);

  const canvasRule = readRule(canvasStyles, '.canvas');
  assert.match(canvasRule, /position:\s*fixed/);
  assert.match(canvasRule, /inset:\s*0/);
  assert.match(canvasRule, /pointer-events:\s*none/);
  assert.match(canvasRule, /background:\s*var\(--bg\)/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/i);

  for (const surfaceRule of [
    readRule(siteStyles, '.resumePaper'),
    readRule(siteStyles, '.projectList li'),
  ]) {
    assert.doesNotMatch(surfaceRule, /var\(--radius-(?:md|lg|pill)\)/);
  }

  const signalRule = readRule(resumeStyles, '.signal');
  assert.match(signalRule, /width:\s*7px/);
  assert.match(signalRule, /height:\s*7px/);
  assert.match(signalRule, /border-radius:\s*var\(--radius-pill\)/);
  assert.equal(count(styles, /var\(--radius-pill\)/g), 1);
});

test('S9 shell components do not import animation frameworks', () => {
  const components = [headerPath, footerPath, resumeModePath, canvasPath]
    .map(readSource)
    .join('\n');

  assert.doesNotMatch(components, /from\s+['"](?:gsap|three)(?:\/[^'"]*)?['"]/i);
});
