import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const layoutPath = path.resolve('app/layout.tsx');
const worksLayoutPath = path.resolve('app/works/layout.tsx');
const pagePath = path.resolve('app/page.tsx');
const shellPath = path.resolve('components/site/SiteShell.tsx');
const headerPath = path.resolve('components/site/SiteHeader.tsx');
const footerPath = path.resolve('components/site/SiteFooter.tsx');
const resumePath = path.resolve('components/site/ResumeSheet.tsx');
const siteStylePath = path.resolve('components/site/SiteShell.module.css');
const resumeStylePath = path.resolve('components/ResumeMode.module.css');

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

test('root layout is minimal and the works layout owns SiteShell', () => {
  const layout = readSource(layoutPath);
  const worksLayout = readSource(worksLayoutPath);

  assert.match(layout, /import\s+\{\s*siteContent\s*\}\s+from\s+["']@\/lib\/site-content["']/);
  assert.match(layout, /title:\s*siteContent\.site\.name/);
  assert.match(layout, /description:\s*siteContent\.site\.description/);
  assert.match(layout, /siteContent\.site\.resumeMode\.storageKey/);
  assert.match(layout, /siteContent\.site\.resumeMode\.bodyClass/);
  assert.doesNotMatch(layout, /s3-content/);
  assert.doesNotMatch(layout, /import\s+SiteShell|<SiteShell/);
  assert.match(layout, /<body>\s*\{children\}\s*<\/body>/s);

  assert.match(worksLayout, /import SiteShell/);
  assert.match(worksLayout, /<SiteShell>\s*\{children\}\s*<\/SiteShell>/s);
});

test('home and works trees each mount resume and chat surfaces exactly once', () => {
  const shell = readSource(shellPath);
  const page = readSource(pagePath);

  assert.equal(count(shell, /<MorseChat\s*\/>/g), 1);
  assert.equal(count(page, /<MorseChat\s*\/>/g), 1);
  assert.equal(count(page, /<ResumeModeToggle\b/g), 1);
  assert.equal(count(page, /<ResumeSheet\b/g), 1);
  assert.equal(count(page, /data-standard-content/g), 1);
});

test('SiteHeader is a compact pathname-aware two-link navigation without a hamburger', () => {
  const header = readSource(headerPath);

  assert.match(header, /^['"]use client['"];?/);
  assert.match(header, /from\s+["']next\/link["']/);
  assert.match(header, /usePathname/);
  assert.match(header, /site\.name/);
  assert.match(header, /site\.nav\.map/);
  assert.match(header, /aria-current=\{[^}]*\?\s*['"]page['"]\s*:\s*undefined\}/);
  assert.doesNotMatch(header, /hamburger|menuOpen|菜单/i);
});

test('footer renders only the three approved footer strings', () => {
  const footer = readSource(footerPath);

  assert.equal(count(footer, /footer\.morse/g), 1);
  assert.equal(count(footer, /footer\.statement/g), 1);
  assert.equal(count(footer, /footer\.copyright/g), 1);
  assert.doesNotMatch(footer, /contact|Email|WeChat|GitHub/i);
});

test('ResumeSheet contains the approved profile and four project statuses without stats or contact', () => {
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
  assert.doesNotMatch(resume, /stats|contact|Email|WeChat/i);
});

test('shell styles use tokens, 44px targets, a stable 390px header row, and no large card radii', () => {
  const siteStyles = readSource(siteStylePath);
  const resumeStyles = readSource(resumeStylePath);
  const styles = `${siteStyles}\n${resumeStyles}`;

  assert.match(siteStyles, /min-height:\s*44px/);
  assert.match(siteStyles, /@media\s*\(max-width:\s*640px\)/);
  assert.match(siteStyles, /flex-wrap:\s*nowrap/);
  assert.match(siteStyles, /white-space:\s*nowrap/);
  assert.match(siteStyles, /padding-right:\s*var\(--/);
  assert.match(resumeStyles, /min-height:\s*44px/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}|rgba?\(/i);

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
