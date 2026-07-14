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
  siteHeader: path.resolve('components/site/SiteHeader.tsx'),
  rootLayout: path.resolve('app/layout.tsx'),
  home: path.resolve('app/page.tsx'),
  homeSections: path.resolve('components/home/MorseHomeSections.tsx'),
  homeStyles: path.resolve('app/styles/hero.module.css'),
  homeSectionStyles: path.resolve('components/home/MorseHomeSections.module.css'),
  tokens: path.resolve('app/styles/tokens.css'),
  siteContent: path.resolve('content/site-content.json'),
  works: path.resolve('app/works/page.tsx'),
  worksLayout: path.resolve('app/works/layout.tsx'),
  worksStyles: path.resolve('app/works/page.module.css'),
  projectGallery: path.resolve('components/works/ProjectGallery.tsx'),
  projectGalleryStyles: path.resolve('components/works/ProjectGallery.module.css'),
  caseRoute: path.resolve('app/works/[slug]/page.tsx'),
  caseRouteStyles: path.resolve('app/works/[slug]/page.module.css'),
} as const;

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
  assert.doesNotMatch(source, /import Link from ['"]next\/link['"]/);
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
  assert.doesNotMatch(source, /action\.kind\s*===\s*['"]case['"]|<Link/);
  assert.match(source, /project\.actions\.map\(\(action\) =>\s*\(\s*<a/);
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
  assert.doesNotMatch(source, /action\.kind\s*!==\s*['"]case['"]|externalActions/);
  assert.match(source, /project\.actions\.length/);
  assert.match(source, /project\.actions\.map/);
  assert.match(source, /<Image[\s\S]*unoptimized/);
});

test('home leads with Morse, one embedded chat, and the shared shell controls', () => {
  const home = readSource(files.home);
  const rootLayout = readSource(files.rootLayout);
  const siteHeader = readSource(files.siteHeader);
  const worksLayout = readSource(files.worksLayout);

  assert.match(
    home,
    /<h1\s+id=["']home-title["']>\s*<span>\s*Morse\s*<\/span>\s*<\/h1>/,
  );
  assert.match(home, /siteContent\.profile\.role/);
  assert.match(home, /siteContent\.profile\.summary/);
  assert.match(home, /getFeaturedProjects/);
  assert.match(home, /MorseHomeSections/);
  assert.match(home, /<MorseChat variant="embedded"\s*\/>/);
  assert.equal((home.match(/<MorseChat\b/g) ?? []).length, 1);
  assert.match(home, /href="\/works"/);
  assert.doesNotMatch(
    home,
    /DigitalHuman|RestoredHomeSections|系统展厅|高频问题|杠杆账本|ResumeMode|ResumeSheet|SiteFooter|ProjectCard|content\.faq|content\.projects\.map/,
  );
  assert.match(rootLayout, /<SiteHeader\s+site=\{siteContent\.site\}\s*\/>/);
  assert.match(siteHeader, /site\.nav\.map/);
  assert.match(siteHeader, /<OpenChatButton\b/);
  assert.match(siteHeader, /<ResumeModeToggle\b/);
  assert.equal((worksLayout.match(/<MorseChat\s*\/>/g) ?? []).length, 1);
  assert.doesNotMatch(home, /1,200|480|示例数据|Email|WeChat|时间线|FAQ/i);
});

test('home sections render exactly two public projects, linked capabilities, and non-null facts', () => {
  const sections = readSource(files.homeSections);
  const content = JSON.parse(readSource(files.siteContent)) as {
    home: { featuredSlugs: string[] };
    projects: Array<{ slug: string; disclosure: string }>;
  };
  const featured = content.home.featuredSlugs
    .map((slug) => content.projects.find((project) => project.slug === slug))
    .filter((project) => project !== undefined);

  assert.deepEqual(content.home.featuredSlugs, ['deep-research', 'digital-morse']);
  assert.equal(featured.length, 2);
  assert.ok(featured.every((project) => project.disclosure === 'public'));
  assert.match(sections, /featuredProjects\.map/);
  assert.doesNotMatch(sections, /content\.projects\.map|content\.faq|project\.actions\.map/);
  assert.match(sections, /project\.status/);
  assert.match(sections, /project\.summary/);
  assert.match(sections, /project\.capabilities\.map/);
  assert.match(sections, /projectHashHref/);
  assert.match(sections, /能力矩阵/);
  assert.match(sections, /开发事实/);
  assert.match(
    sections,
    /const capabilityMatrix = featuredProjects\.flatMap\(\(project\) =>\s*project\.capabilities\.map\(\(capability\) => \(\{ project, capability \}\)\),?\s*\)/s,
  );
  assert.match(sections, /projectHashHref\(project\.slug\)/);
  assert.match(sections, /project\.name/);
  assert.match(sections, /\{capability\}/);
  assert.doesNotMatch(
    sections,
    /const deepResearchHref|const digitalMorseHref|content\.profile\.capabilities|可观察工件、质量门与可恢复运行|审核公开知识、语义检索与来源展示|受限研究链与人工发布审批|前端、服务端、数据层与验证链闭环/,
  );
  assert.match(sections, /\.flatMap\(\(metric\) => metric\.value === null \? \[\] : \[\{ \.\.\.metric, value: metric\.value \}\]\)/);
  assert.match(sections, /activity\.allTime !== null \|\| activity\.last30Days !== null/);
  assert.match(sections, /Intl\.NumberFormat\('zh-CN', \{\s*notation: 'compact',\s*maximumFractionDigits: 1,?\s*\}\)/);
  assert.match(sections, /title=\{fullValue\}/);
  assert.match(sections, /className=\{styles\.srOnly\}/);
  assert.doesNotMatch(sections, /\?\?\s*0|\|\|\s*0|职业|时间线|FAQ|高频问题/);
});

test('works index is an unfiltered four-project gallery driven by the public content helper', () => {
  const source = readSource(files.works);
  const content = JSON.parse(readSource(files.siteContent)) as {
    projects: Array<{ slug: string }>;
  };

  assert.match(source, /siteContent\.works\.title/);
  assert.match(source, /siteContent\.works\.intro/);
  assert.match(source, /getAllProjects\(\)/);
  assert.match(source, /<ProjectGallery\s+projects=\{projects\}\s*\/>/);
  assert.doesNotMatch(source, /filter|search|sort/i);
  assert.deepEqual(
    content.projects.map((project) => project.slug),
    ['content-agent', 'auto-operations', 'deep-research', 'digital-morse'],
  );
});

test('gallery keeps a single expanded project synchronized with valid URL hashes', () => {
  const gallery = readSource(files.projectGallery);

  assert.match(gallery, /useState<ProjectSlug \| null>/);
  assert.match(gallery, /useLayoutEffect/);
  assert.match(gallery, /useRef<number \| null>\(null\)/);
  assert.match(gallery, /window\.location\.hash/);
  assert.match(gallery, /projectSlugs\.includes\(slug as ProjectSlug\)/);
  assert.match(gallery, /\? \(slug as ProjectSlug\) : null/);
  assert.match(gallery, /window\.addEventListener\(['"]hashchange['"], syncFromHash\)/);
  assert.match(gallery, /window\.removeEventListener\(['"]hashchange['"], syncFromHash\)/);
  assert.match(gallery, /const next = openSlug === slug \? null : slug/);
  assert.match(gallery, /expanded=\{openSlug === project\.slug\}/);
  assert.match(gallery, /history\.replaceState/);
  assert.match(gallery, /next \? `\/works#\$\{next\}` : ['"]\/works['"]/);
  assert.match(gallery, /document\.getElementById\(next\)/);
  assert.match(gallery, /prefers-reduced-motion: reduce/);
  assert.match(gallery, /behavior: reducedMotion\.matches \? ['"]auto['"] : ['"]smooth['"]/);
  assert.match(gallery, /requestAnimationFrame/);
  assert.match(gallery, /cancelAnimationFrame/);
  assert.match(gallery, /window\.scrollTo\(\{[\s\S]*top: window\.scrollY,[\s\S]*behavior: ['"]auto['"]/);
  assert.match(gallery, /getBoundingClientRect\(\)\.top/);
  assert.match(gallery, /getComputedStyle\(target\)\.scrollMarginTop/);
  assert.match(
    gallery,
    /useLayoutEffect\(\(\) => \{[\s\S]*const currentTop[\s\S]*const preservedTop[\s\S]*window\.scrollBy\(\{[\s\S]*top: currentTop - preservedTop,[\s\S]*behavior: ['"]auto['"][\s\S]*\}\);[\s\S]*\}, \[openSlug\]\);/,
  );
});

test('gallery settles generation-safe scrolling after stale project presence exits', () => {
  const card = readSource(files.projectCard);
  const gallery = readSource(files.projectGallery);

  assert.match(card, /onPresenceChange:\s*\(slug: ProjectSlug, mounted: boolean\) => void/);
  assert.match(
    card,
    /useEffect\(\(\) => \{\s*onPresenceChange\(project\.slug, detailsMounted\);\s*\}, \[detailsMounted, onPresenceChange, project\.slug\]\);/,
  );
  assert.match(
    card,
    /useEffect\(\(\) => \(\) => \{\s*onPresenceChange\(project\.slug, false\);\s*\}, \[onPresenceChange, project\.slug\]\);/,
  );
  assert.match(gallery, /useCallback/);
  assert.match(gallery, /useRef<Set<ProjectSlug>>\(new Set\(\)\)/);
  assert.match(gallery, /navigationGeneration\s*=\s*useRef\(0\)/);
  assert.match(gallery, /pendingFinalTarget\s*=\s*useRef/);
  assert.match(gallery, /const handlePresenceChange = useCallback/);
  assert.match(gallery, /onPresenceChange=\{handlePresenceChange\}/);
  assert.match(gallery, /slug !== pending\.slug/);
  assert.match(gallery, /pending\.generation !== navigationGeneration\.current/);
  assert.match(gallery, /pending\.slug !== openSlugRef\.current/);
  assert.match(gallery, /presenceSlugs\.current\.has\(pending\.slug\)/);
  assert.match(
    gallery,
    /hasStalePresence \|\| !presenceSlugs\.current\.has\(openSlug\)/,
  );
  assert.match(
    gallery,
    /requestAnimationFrame\(\(\) => \{\s*finalScrollFrame\.current = requestAnimationFrame\(\(\) => \{[\s\S]*scrollToProject\(latest\.slug\)/,
  );
  assert.doesNotMatch(gallery, /setTimeout|setInterval/);
});

test('pending gallery correction is cancelled by subsequent user scroll intent only', () => {
  const gallery = readSource(files.projectGallery);

  for (const eventName of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    assert.match(gallery, new RegExp(`addEventListener\\(['"]${eventName}['"]`));
    assert.match(gallery, new RegExp(`removeEventListener\\(['"]${eventName}['"]`));
  }
  for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']) {
    assert.match(gallery, new RegExp(`['"]${key.replace(' ', '\\s')}['"]`));
  }
  assert.match(gallery, /cancelPendingFinalScroll/);
  assert.match(
    gallery,
    /pendingFinalTarget\.current = \{[\s\S]*removeIntentListeners\.current = listenForScrollIntent/,
  );
  assert.doesNotMatch(gallery, /addEventListener\(['"]scroll['"]/);
});

test('controlled project cards expose real hash targets and accessible embedded details', () => {
  const card = readSource(files.projectCard);
  const caseStudy = readSource(files.caseStudy);
  const problemPosition = positionOf(caseStudy, '问题');
  const rolePosition = positionOf(caseStudy, '我的角色');
  const stackPosition = positionOf(caseStudy, '技术栈');
  const decisionsPosition = positionOf(caseStudy, '关键判断');
  const structurePosition = positionOf(caseStudy, '真实结构');
  const evidencePosition = positionOf(caseStudy, '验证证据');
  const boundariesPosition = positionOf(caseStudy, '当前边界');

  assert.match(card, /<article[\s\S]*id=\{project\.slug\}[\s\S]*data-project-slug=\{project\.slug\}/);
  assert.match(card, /aria-expanded=\{expanded\}/);
  assert.match(card, /aria-controls=\{detailsId\}/);
  assert.match(card, /event\.stopPropagation\(\)/);
  assert.match(card, /project\.capabilities\.map/);
  assert.match(card, /project\.actions\.map[\s\S]*<a/);
  assert.match(card, /detailsMounted \? \([\s\S]*<CaseStudy[\s\S]*detailsId=\{detailsId\}/);
  assert.doesNotMatch(card, /expanded \? \(\s*<CaseStudy/);
  assert.match(caseStudy, /id=\{detailsId\}/);
  assert.match(caseStudy, /role=['"]region['"]/);
  assert.match(caseStudy, /aria-labelledby=\{labelledBy\}/);
  assert.match(caseStudy, /<h2>\{project\.name\}<\/h2>/);
  assert.match(caseStudy, /project\.techStack\.map/);
  assert.ok(problemPosition < rolePosition);
  assert.ok(rolePosition < stackPosition);
  assert.ok(stackPosition < decisionsPosition);
  assert.ok(decisionsPosition < structurePosition);
  assert.ok(structurePosition < evidencePosition);
  assert.ok(evidencePosition < boundariesPosition);
});

test('project details keep a cancellable presence until the row transition finishes', () => {
  const card = readSource(files.projectCard);
  const fallback = card.match(/const DETAIL_TRANSITION_FALLBACK_MS = (\d+);/);

  assert.match(card, /useEffect/);
  assert.match(card, /useRef/);
  assert.match(card, /useState/);
  assert.match(card, /const \[detailsMounted, setDetailsMounted\] = useState\(expanded\)/);
  assert.match(card, /const \[detailsOpen, setDetailsOpen\] = useState\(false\)/);
  assert.match(card, /requestAnimationFrame/);
  assert.match(card, /cancelAnimationFrame/);
  assert.match(card, /window\.setTimeout/);
  assert.match(card, /window\.clearTimeout/);
  assert.match(card, /presenceRun\.current/);
  assert.ok(fallback, 'missing bounded detail-transition fallback');
  assert.ok(Number(fallback[1]) >= 450 && Number(fallback[1]) <= 1000);
  assert.match(card, /event\.propertyName !== ['"]grid-template-rows['"]/);
  assert.match(card, /onTransitionEnd=\{handleDetailsTransitionEnd\}/);
  assert.match(card, /data-open=\{detailsOpen\}/);
  assert.match(card, /aria-hidden=\{!detailsOpen\}/);
  assert.match(card, /inert=\{!detailsOpen\}/);
  assert.match(card, /prefers-reduced-motion: reduce/);
  assert.match(card, /if \(expanded \|\| event\.propertyName !== ['"]grid-template-rows['"]\)/);
});

test('project card layout stays expanded through detail exit without a grid row gap', () => {
  const card = readSource(files.projectCard);
  const cardStyles = readSource(files.projectCardStyles);
  const desktopCardRule = cardStyles.match(/\.card\s*\{([\s\S]*?)\n\}/);
  const mobileCardRule = cardStyles.match(
    /@media\s*\(max-width:\s*640px\)[\s\S]*?\.card\s*\{([\s\S]*?)\n\s{2}\}/,
  );

  assert.match(card, /const layoutExpanded = expanded \|\| detailsMounted;/);
  assert.match(card, /data-expanded=\{layoutExpanded\}/);
  assert.match(card, /aria-expanded=\{expanded\}/);
  assert.match(card, /\{expanded \? ['"]收起详情['"] : ['"]展开详情['"]\}/);
  assert.ok(desktopCardRule, 'missing desktop project-card layout rule');
  assert.ok(mobileCardRule, 'missing mobile project-card layout rule');
  assert.match(desktopCardRule[1], /column-gap:\s*var\(--space-5\)/);
  assert.match(desktopCardRule[1], /row-gap:\s*0/);
  assert.doesNotMatch(desktopCardRule[1], /(?:^|\s)gap:/);
  assert.match(mobileCardRule[1], /column-gap:\s*var\(--space-4\)/);
  assert.match(mobileCardRule[1], /row-gap:\s*0/);
  assert.doesNotMatch(mobileCardRule[1], /(?:^|\s)gap:/);
});

test('legacy case routes validate slugs and redirect without rendering independent details', () => {
  const source = readSource(files.caseRoute);

  assert.match(source, /params:\s*Promise<\{\s*slug:\s*string;?\s*\}>/);
  assert.match(source, /await params/);
  assert.match(source, /export function generateStaticParams\(\)[\s\S]*getProjectStaticParams\(\)/);
  assert.match(source, /export async function generateMetadata/);
  assert.match(source, /getProjectBySlug\(slug\)/);
  assert.match(source, /notFound\(\)/);
  assert.match(source, /redirect\(`\/works#\$\{slug\}`\)/);
  assert.doesNotMatch(source, /CaseStudy|<main|<article/);
  assert.equal(fs.existsSync(files.caseRouteStyles), false);
});

test('new route styles are tokenized, compact, and include mobile overflow safeguards', () => {
  const styleSources = [
    files.projectCardStyles,
    files.caseStudyStyles,
    files.projectGalleryStyles,
    files.homeStyles,
    files.homeSectionStyles,
    files.worksStyles,
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

test('S9 gallery motion uses exact semantic card and detail duration tokens', () => {
  const tokens = readSource(files.tokens);
  const cardStyles = readSource(files.projectCardStyles);
  const detailStyles = readSource(files.caseStudyStyles);
  const detailsRule = cardStyles.match(/\.details\s*\{([\s\S]*?)\n\}/);
  const detailsOpenRule = cardStyles.match(/\.details\[data-open=['"]true['"]\]\s*\{([\s\S]*?)\n\}/);
  const detailsInnerRule = cardStyles.match(/\.detailsInner\s*\{([\s\S]*?)\n\}/);

  assert.match(tokens, /--dur-card:\s*300ms;/);
  assert.match(tokens, /--dur-detail:\s*450ms;/);
  assert.match(cardStyles, /var\(--dur-card\)/);
  assert.doesNotMatch(cardStyles, /var\(--dur\)/);
  assert.ok(detailsRule, 'missing collapsed project-detail grid rule');
  assert.ok(detailsOpenRule, 'missing expanded project-detail grid rule');
  assert.ok(detailsInnerRule, 'missing project-detail overflow wrapper');
  assert.match(detailsRule[1], /grid-template-rows:\s*0fr/);
  assert.match(detailsRule[1], /grid-template-rows var\(--dur-detail\) var\(--ease\)/);
  assert.match(detailsRule[1], /opacity var\(--dur-detail\) var\(--ease\)/);
  assert.match(detailsRule[1], /transform var\(--dur-detail\) var\(--ease\)/);
  assert.equal((detailsRule[1].match(/var\(--dur-detail\)/g) ?? []).length, 3);
  assert.match(detailsOpenRule[1], /grid-template-rows:\s*1fr/);
  assert.match(detailsInnerRule[1], /min-height:\s*0/);
  assert.match(detailsInnerRule[1], /overflow:\s*hidden/);
  assert.doesNotMatch(detailStyles, /caseStudyEnter|@keyframes/);
  assert.match(cardStyles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*transition:\s*none/);
});

test('new route TSX stays inside the approved evidence-only product surface', () => {
  const sources = [
    files.projectCard,
    files.caseStudy,
    files.openChatButton,
    files.home,
    files.homeSections,
    files.works,
    files.projectGallery,
    files.caseRoute,
  ].map(readSource);
  const combined = sources.join('\n');

  assert.doesNotMatch(combined, prohibitedProductPattern);
  assert.doesNotMatch(combined, /Email|WeChat|contact/i);
  assert.doesNotMatch(combined, /节省工时|增长率|产能提升/);
  assert.doesNotMatch(combined, /https:\/\/(?:aitavix\.com|github\.com\/Morse-Moss)/);
});
