import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const files = {
  projectCard: path.resolve('components/works/ProjectCard.tsx'),
  projectCardStyles: path.resolve('components/works/ProjectCard.module.css'),
  caseStudy: path.resolve('components/works/CaseStudy.tsx'),
  caseStudyStyles: path.resolve('components/works/CaseStudy.module.css'),
  openChatButton: path.resolve('components/site/OpenChatButton.tsx'),
  home: path.resolve('app/page.tsx'),
  homeStyles: path.resolve('app/page.module.css'),
  works: path.resolve('app/works/page.tsx'),
  worksStyles: path.resolve('app/works/page.module.css'),
  caseRoute: path.resolve('app/works/[slug]/page.tsx'),
  caseRouteStyles: path.resolve('app/works/[slug]/page.module.css'),
} as const;

const retiredSurfacePattern = new RegExp(
  [
    'S3',
    'Sections|s3',
    '-content|Digital',
    'Human|Life',
    'form|Scroll',
    'Effects|stats|chips|contact',
  ].join(''),
  'i',
);

const prohibitedProductPattern = new RegExp(
  ['image', 'gen|Digital', 'Human|Life', 'form|S3', 'Sections|s3', '-content'].join(''),
  'i',
);

function readSource(filePath: string): string {
  assert.ok(fs.existsSync(filePath), `missing expected file: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function positionOf(source: string, value: string): number {
  const position = source.indexOf(value);
  assert.notEqual(position, -1, `missing ordered value: ${value}`);
  return position;
}

test('ProjectCard renders real media, an honest empty state, and at most the content-owned actions', () => {
  const source = readSource(files.projectCard);

  assert.match(source, /import Image from ['"]next\/image['"]/);
  assert.match(source, /import Link from ['"]next\/link['"]/);
  assert.match(source, /project\.status/);
  assert.match(source, /project\.name/);
  assert.match(source, /project\.type/);
  assert.match(source, /project\.summary/);
  assert.match(source, /project\.media/);
  assert.match(source, /<Image[\s\S]*src=\{project\.media\.src\}[\s\S]*width=\{project\.media\.width\}[\s\S]*height=\{project\.media\.height\}[\s\S]*alt=\{project\.media\.alt\}/);
  assert.match(source, /role=['"]img['"]/);
  assert.match(source, /aria-label=\{`\$\{project\.name\}暂无可公开截图`\}/);
  assert.match(source, />截图待补<\/div>/);
  assert.match(source, /project\.actions\.map/);
  assert.match(source, /action\.kind === ['"]case['"][\s\S]*<Link/);
  assert.match(source, /<a[\s\S]*target=['"]_blank['"][\s\S]*rel=['"]noreferrer['"]/);
  assert.doesNotMatch(source, /slice\s*\(/);
});

test('CaseStudy keeps the six evidence sections in exact order and leads with honest media evidence', () => {
  const source = readSource(files.caseStudy);
  const headings = ['问题', '我的角色', '关键判断', '真实结构', '验证证据', '当前边界'];
  const positions = headings.map((heading) => positionOf(source, heading));

  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  assert.ok(positionOf(source, 'project.media') < positions[0]);
  assert.match(source, /import Image from ['"]next\/image['"]/);
  assert.match(source, /<figcaption>[\s\S]*project\.media\.caption/);
  for (const field of ['capturedAt', 'commit', 'runMode', 'sanitization']) {
    assert.match(source, new RegExp(`project\\.media\\.evidence\\.${field}`));
  }
  assert.match(source, /<dl/);
  assert.match(source, /role=['"]img['"]/);
  assert.match(source, /aria-label=\{`\$\{project\.name\}暂无可公开截图`\}/);
  assert.match(source, />截图待补<\/div>/);
});

test('home page uses approved profile copy, the real featured workbench, and all four projects', () => {
  const source = readSource(files.home);
  const chatButton = readSource(files.openChatButton);

  assert.match(source, /import Image from ['"]next\/image['"]/);
  assert.match(source, /import Link from ['"]next\/link['"]/);
  assert.match(source, /getAllProjects/);
  assert.match(source, /getFeaturedProjects/);
  assert.match(source, /siteContent\.profile\.title/);
  assert.match(source, /siteContent\.profile\.role/);
  assert.match(source, /siteContent\.profile\.summary/);
  assert.match(source, /href=['"]\/works['"][\s\S]*查看作品/);
  assert.match(source, /<OpenChatButton[\s\S]*问数字摩斯/);
  assert.match(source, /<Image[\s\S]*featured\.media\.src[\s\S]*featured\.media\.width[\s\S]*featured\.media\.height/);
  assert.match(source, /projects\.map[\s\S]*<ProjectCard/);
  assert.doesNotMatch(source, retiredSurfacePattern);

  assert.match(chatButton, /^['"]use client['"];?/);
  assert.match(chatButton, /window\.dispatchEvent\(new Event\(['"]morse-chat:open['"]\)\)/);
  assert.match(chatButton, /type=['"]button['"]/);
});

test('works index is an unfiltered four-project catalog driven by the public content helper', () => {
  const source = readSource(files.works);

  assert.match(source, /siteContent\.works\.title/);
  assert.match(source, /siteContent\.works\.intro/);
  assert.match(source, /getAllProjects\(\)/);
  assert.match(source, /projects\.map[\s\S]*<ProjectCard/);
  assert.doesNotMatch(source, /filter|search|sort/i);
});

test('dynamic case route uses Next 16 async params, exact helper params, metadata, notFound, and CaseStudy', () => {
  const source = readSource(files.caseRoute);

  assert.match(source, /params:\s*Promise<\{\s*slug:\s*string;?\s*\}>/);
  assert.match(source, /await params/);
  assert.match(source, /export function generateStaticParams\(\)[\s\S]*getProjectStaticParams\(\)/);
  assert.match(source, /export async function generateMetadata/);
  assert.match(source, /getProjectBySlug\(slug\)/);
  assert.match(source, /notFound\(\)/);
  assert.match(source, /<CaseStudy\s+project=\{project\}/);
});

test('new route styles are tokenized, compact, and include mobile overflow safeguards', () => {
  const styleSources = [
    files.projectCardStyles,
    files.caseStudyStyles,
    files.homeStyles,
    files.worksStyles,
    files.caseRouteStyles,
  ].map(readSource);
  const combined = styleSources.join('\n');

  assert.doesNotMatch(combined, /#[0-9a-f]{3,8}|rgba?\(/i);
  const letterSpacingValues = [...combined.matchAll(/letter-spacing:\s*([^;}]+)/gi)]
    .map((match) => match[1].trim());
  assert.ok(letterSpacingValues.every((value) => value === '0'));
  assert.doesNotMatch(combined, /var\(--radius-(?:md|lg|pill)\)/);
  assert.match(combined, /min-height:\s*44px/);
  assert.match(combined, /@media\s*\(max-width:\s*640px\)/);
  assert.match(combined, /min-width:\s*0/);
  assert.match(combined, /overflow-wrap:\s*anywhere/);
  assert.match(combined, /aspect-ratio/);
});

test('new route TSX stays inside the approved evidence-only product surface', () => {
  const sources = [
    files.projectCard,
    files.caseStudy,
    files.openChatButton,
    files.home,
    files.works,
    files.caseRoute,
  ].map(readSource);
  const combined = sources.join('\n');

  assert.doesNotMatch(combined, prohibitedProductPattern);
  assert.doesNotMatch(combined, /Email|WeChat|contact/i);
  assert.doesNotMatch(combined, /节省工时|增长率|产能提升/);
  assert.doesNotMatch(combined, /https:\/\/(?:aitavix\.com|github\.com\/Morse-Moss)/);
});
