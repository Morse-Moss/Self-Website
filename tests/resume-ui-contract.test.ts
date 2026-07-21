import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const componentPath = path.resolve('components/ResumeMode.tsx');
const stylePath = path.resolve('components/ResumeMode.module.css');
const layoutPath = path.resolve('app/(portfolio)/layout.tsx');
const globalsPath = path.resolve('app/globals.css');
const resumeSheetPath = path.resolve('components/site/ResumeSheet.tsx');

const read = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('public shell no longer embeds or persists a structured resume', () => {
  const sources = [componentPath, layoutPath, globalsPath].map(read).join('\n');
  assert.equal(fs.existsSync(resumeSheetPath), false);
  assert.doesNotMatch(
    sources,
    /ResumeSheet|resume-mode-boot|localStorage|sessionStorage|data-resume-section|document\.cookie/u,
  );
  assert.doesNotMatch(sources, /profile\.(?:title|role|summary|principles)|projects\.map/u);
  assert.doesNotMatch(sources, /<iframe|<embed|<object|window\.print|URL\.createObjectURL|FileReader/u);
});

test('resume access is checked, redeemed, and revoked only through the same-origin API', () => {
  const source = read(componentPath);
  assert.match(source, /type ResumeAccessState/u);
  assert.match(source, /fetch\(['"]\/api\/resume\/access['"]/u);
  assert.match(source, /method:\s*['"]POST['"]/u);
  assert.match(source, /JSON\.stringify\(\{\s*code/u);
  assert.match(source, /method:\s*['"]DELETE['"]/u);
  assert.match(source, /cache:\s*['"]no-store['"]/u);
  assert.match(source, /credentials:\s*['"]same-origin['"]/u);
  assert.doesNotMatch(source, /URLSearchParams|[?&]code=/u);
});

test('authorized visitors open the PDF as a top-level same-origin document', () => {
  const source = read(componentPath);
  assert.match(source, /href=['"]\/api\/resume\/file['"]/u);
  assert.match(source, /target=['"]_blank['"]/u);
  assert.match(source, /rel=['"]noreferrer['"]/u);
  assert.match(source, /打开 PDF/u);
  assert.match(source, /退出简历模式/u);
  assert.match(source, /查看简历/u);
  assert.match(source, /简历暂不可用/u);
});

test('resume access dialog is modal, keyboard-safe, responsive, and tokenized', () => {
  const source = read(componentPath);
  const styles = read(stylePath);
  assert.match(source, /role=['"]dialog['"]/u);
  assert.match(source, /aria-modal=['"]true['"]/u);
  assert.match(source, /event\.key === ['"]Escape['"]/u);
  assert.match(source, /querySelectorAll<HTMLElement>/u);
  assert.match(source, /dialogRef\.current\.contains\(document\.activeElement\)/u);
  assert.match(source, /previousFocusRef\.current\?\.focus\(\)/u);
  assert.match(styles, /min-height:\s*44px/u);
  assert.match(styles, /@media\s*\(max-width:\s*640px\)/u);
  assert.match(styles, /height:\s*100dvh/u);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/iu);
});
