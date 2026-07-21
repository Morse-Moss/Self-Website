import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const componentPath = path.resolve('components/MorseChat.tsx');
const stylePath = path.resolve('components/MorseChat.module.css');
const globalStylePath = path.resolve('app/globals.css');
const heroStylePath = path.resolve('app/styles/hero.module.css');
const chatDirectory = path.resolve('components/chat');
const portfolioLayoutPath = path.resolve('app/(portfolio)/layout.tsx');
const worksLayoutPath = path.resolve('app/(portfolio)/works/layout.tsx');
const pagePath = path.resolve('app/(portfolio)/page.tsx');
const projectCardPath = path.resolve('components/works/ProjectCard.tsx');
const caseStudyPath = path.resolve('components/works/CaseStudy.tsx');
const openChatButtonPath = path.resolve('components/site/OpenChatButton.tsx');
const scrollPath = path.resolve('lib/client/chat-scroll.ts');
const chatContractPath = path.resolve('lib/contracts/chat.ts');

const requiredChatFiles = [
  'useMorseChat.ts',
  'ChatWorkspace.tsx',
  'ChatTranscript.tsx',
  'ChatMessageContent.tsx',
  'ChatPhaseStatus.tsx',
  'ChatComposer.tsx',
  'ChatSources.tsx',
  'JdIntake.tsx',
  'DiagnosisIntake.tsx',
] as const;

function readIfPresent(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function readChatSource(fileName: typeof requiredChatFiles[number]): string {
  return readIfPresent(path.join(chatDirectory, fileName));
}

function allVisitorSource(): string {
  return [
    readIfPresent(componentPath),
    ...requiredChatFiles.map(readChatSource),
  ].join('\n');
}

test('visitor chat is split into the Task 6 interaction components', () => {
  for (const fileName of requiredChatFiles) {
    assert.ok(fs.existsSync(path.join(chatDirectory, fileName)), `missing components/chat/${fileName}`);
  }
  const component = fs.readFileSync(componentPath, 'utf8');
  assert.match(component, /<ChatWorkspace/);
  assert.match(component, /useMorseChat/);
});

test('visitor chat exposes exactly three workflow controls without monthly budget UI', () => {
  const source = allVisitorSource();
  const contract = readIfPresent(chatContractPath);

  assert.match(source, /from ['"]@\/lib\/contracts\/chat['"]/);
  assert.match(contract, /CHAT_WORKFLOWS\s*=\s*\[['"]chat['"],\s*['"]jd_match['"],\s*['"]diagnosis['"]\]/);
  assert.match(source, /自由对话/);
  assert.match(source, /JD 匹配/);
  assert.match(source, /需求初诊/);
  assert.match(source, /aria-label="对话流程"/);
  assert.match(source, /setWorkflow\(['"]chat['"]\)/);
  assert.match(source, /setWorkflow\(['"]jd_match['"]\)/);
  assert.match(source, /setWorkflow\(['"]diagnosis['"]\)/);
  assert.doesNotMatch(source, /本月对话额度|budgetMessage|BudgetLevel|budgetNotice/);
});

test('send switches in place to a real AbortController stop action', () => {
  const hook = readChatSource('useMorseChat.ts');
  const composer = readChatSource('ChatComposer.tsx');

  assert.match(hook, /new AbortController\(\)/);
  assert.match(hook, /if \(streaming \|\| abortControllerRef\.current\) return/);
  assert.match(hook, /signal:\s*abortController\.signal/);
  assert.match(hook, /abortControllerRef\.current\s*=\s*abortController/);
  assert.match(hook, /abortControllerRef\.current\?\.abort\(\)/);
  assert.match(hook, /error\s+instanceof\s+DOMException[\s\S]*error\.name\s*===\s*['"]AbortError['"]/);
  assert.match(hook, /stopped:\s*true/);
  assert.match(composer, /streaming\s*\?\s*['"]停止['"]\s*:\s*['"]发送['"]/);
  assert.match(composer, /streaming\s*\?\s*onStop\s*:\s*undefined/);
  assert.equal((composer.match(/<button/g) ?? []).length, 1, 'send and stop must share one button');
});

test('service-driven stages use one status region and include diagnosis handoff', () => {
  const hook = readChatSource('useMorseChat.ts');
  const status = readChatSource('ChatPhaseStatus.tsx');
  const contract = readIfPresent(chatContractPath);

  for (const stage of ['routing', 'knowledge', 'web', 'answering', 'handoff']) {
    assert.match(contract, new RegExp(`['"]${stage}['"]`));
  }
  assert.match(hook, /new Set<ChatPhase>\(CHAT_PHASES\)/);
  assert.match(hook, /validPhases\.has\(payload\.stage\)/);
  assert.match(hook, /event === ['"]status['"]/);
  assert.match(hook, /setPhase\(payload\.stage/);
  assert.match(status, /role="status"/);
  assert.match(status, /aria-live="polite"/);
  assert.match(status, /正在判断是否需要联网/);
  assert.match(status, /已进入转交队列/);
});

test('authorized access restores the newest 12-hour conversation history', () => {
  const hook = readChatSource('useMorseChat.ts');

  assert.match(hook, /fetch\(['"]\/api\/chat\/history['"],\s*\{\s*cache:\s*['"]no-store['"]/s);
  assert.match(hook, /setConversationId\(history\.conversationId/);
  assert.match(hook, /setWorkflowState\(history\.workflow/);
  assert.match(
    hook,
    /setWorkflowState\(history\.workflow\)[\s\S]*setConversationId\(history\.conversationId\)/,
    'workflow reset must happen before restoring the conversation id',
  );
  assert.match(hook, /setAudienceIntent\(restoredAudience/);
  assert.match(hook, /history\.messages\.map/);
  assert.match(hook, /setRemainingMessages\(history\.remainingMessages/);
  assert.match(hook, /restoreHistory\(\)/);
});

test('authorized chat gates the workspace until history restoration settles', () => {
  const component = fs.readFileSync(componentPath, 'utf8');
  const hook = readChatSource('useMorseChat.ts');

  assert.match(hook, /const \[historyLoading, setHistoryLoading\] = useState\(true\)/);
  assert.match(hook, /setHistoryLoading\(true\)[\s\S]*await fetch\(['"]\/api\/chat\/history['"]/);
  assert.match(hook, /finally\s*\{\s*setHistoryLoading\(false\)/);
  assert.match(hook, /setHistoryLoading\(true\)[\s\S]*setAccessState\(['"]authorized['"]\)/);
  assert.match(hook, /historyLoading,[\s\S]*restoreHistory/);
  assert.match(
    component,
    /chat\.historyLoading\s*\?\s*\([\s\S]*role="status"[\s\S]*<ChatWorkspace/,
  );
});

test('transcript groups audited local sources separately from web sources', () => {
  const sources = readChatSource('ChatSources.tsx');
  const transcript = readChatSource('ChatTranscript.tsx');

  assert.match(sources, /source\.kind === ['"]local['"]/);
  assert.match(sources, /站内公开资料/);
  assert.match(sources, /联网参考资料/);
  assert.match(sources, /target="_blank"/);
  assert.match(sources, /rel="noopener noreferrer"/);
  assert.match(sources, /citationIndex:\s*index \+ 1/);
  assert.match(sources, /extractCitationIndexes/);
  assert.doesNotMatch(sources, /资料 \{citationIndex\}/);
  assert.match(readChatSource('ChatMessageContent.tsx'), /依据：\{source\.title\}/);
  assert.doesNotMatch(readChatSource('ChatMessageContent.tsx'), /资料 \{token\.index\}/);
  assert.match(transcript, /<ChatMessageContent/);
  assert.match(transcript, /<ChatSources/);
  assert.match(transcript, /message\.complete/);
  assert.doesNotMatch(transcript, /aria-live=/, 'streaming token text must not be an aria-live region');
});

test('source evidence never replaces the active chat document', () => {
  const sources = readChatSource('ChatSources.tsx');
  const messageContent = readChatSource('ChatMessageContent.tsx');

  assert.match(sources, /const navigable = external \|\| source\.href !== ['"]\/['"]/);
  assert.match(sources, /data-source-static="true"/);
  assert.match(sources, /target="_blank"/);
  assert.match(sources, /rel="noopener noreferrer"/);
  assert.match(sources, /当前对话引用的公开资料/);
  assert.match(sources, /站内案例 · 新标签页/);
  assert.match(messageContent, /const navigable = source\.kind !== ['"]local['"] \|\| source\.href !== ['"]\/['"]/);
  assert.match(messageContent, /data-citation-static="true"/);
  assert.match(messageContent, /target="_blank"/);
  assert.match(messageContent, /rel="noopener noreferrer"/);
  assert.doesNotMatch(messageContent, /href=\{`#\$\{sourceAnchorId/);
});

test('starter questions send immediately and pending assistants replace the empty suggestions', () => {
  const hook = readChatSource('useMorseChat.ts');
  const workspace = readChatSource('ChatWorkspace.tsx');
  const transcript = readChatSource('ChatTranscript.tsx');

  assert.match(hook, /function sendStarter/);
  assert.match(hook, /sendSnapshot\(\{[\s\S]*message:\s*input\.prompt/);
  assert.match(workspace, /label:\s*['"]招聘['"][\s\S]*?mode:\s*['"]interviewer['"][\s\S]*?audienceIntent:\s*['"]recruiter['"]/);
  assert.match(workspace, /label:\s*['"]合作['"][\s\S]*?mode:\s*['"]general['"][\s\S]*?audienceIntent:\s*['"]collaboration['"]/);
  assert.match(workspace, /label:\s*['"]同行交流['"][\s\S]*?mode:\s*['"]general['"][\s\S]*?audienceIntent:\s*['"]peer['"]/);
  assert.doesNotMatch(workspace, /招人的|找人做事的/);
  assert.match(workspace, /onClick=\{\(\) => chat\.sendStarter\(intent\)\}/);
  assert.match(workspace, /type="button"/);
  assert.match(transcript, /数字摩斯正在思考/);
  assert.match(transcript, /!message\.text[\s\S]*!message\.error[\s\S]*!message\.stopped/);
});

test('project CTA opens Digital Morse with the approved content-agent question prefilled', () => {
  const component = readIfPresent(componentPath);
  const projectCard = readIfPresent(projectCardPath);
  const caseStudy = readIfPresent(caseStudyPath);
  const openChatButton = readIfPresent(openChatButtonPath);

  assert.match(openChatButton, /prompt\?:\s*string/);
  assert.match(openChatButton, /new CustomEvent\(['"]morse-chat:open['"]/);
  assert.match(openChatButton, /detail:\s*\{\s*prompt\s*\}/);
  assert.doesNotMatch(projectCard, /import OpenChatButton|project\.askMorse/);
  assert.match(caseStudy, /import OpenChatButton/);
  assert.match(caseStudy, /project\.askMorse/);
  assert.match(
    caseStudy,
    /<OpenChatButton[\s\S]*prompt=\{project\.askMorse\.prompt\}[\s\S]*project\.askMorse\.label/,
  );
  assert.match(component, /event\s+instanceof\s+CustomEvent/);
  assert.match(component, /event\.detail\?\.prompt/);
  assert.match(component, /chat\.setWorkflow\(['"]chat['"]\)/);
  assert.match(component, /chat\.setDraft\(prompt\)/);
});

test('structured intake supports 12,000-character JD and five-field diagnosis', () => {
  const jd = readChatSource('JdIntake.tsx');
  const diagnosis = readChatSource('DiagnosisIntake.tsx');
  const hook = readChatSource('useMorseChat.ts');

  assert.match(jd, /maxLength=\{12_000\}/);
  assert.match(jd, /12,000/);
  assert.match(hook, /jobDescription/);
  assert.match(diagnosis, /name=\{field\.name\}/);
  for (const field of ['problem', 'goal', 'currentState', 'constraints', 'expectedTimeline']) {
    assert.match(diagnosis, new RegExp(`name:\\s*["']${field}["']`));
    assert.match(hook, new RegExp(field));
  }
  assert.match(diagnosis, /totalCharacters/);
  assert.match(diagnosis, /6_500/);
  assert.match(diagnosis, /6,500/);
  assert.match(hook, /diagnosisStatus:\s*['"]handoff_pending['"]/);
  assert.match(diagnosis, /提交初诊/);
});

test('recoverable retry reuses the assistant row without a second user bubble', () => {
  const hook = readChatSource('useMorseChat.ts');
  const transcript = readChatSource('ChatTranscript.tsx');

  assert.match(hook, /retryAssistantId\?:\s*string/);
  assert.match(hook, /if\s*\(retryAssistantId\)[\s\S]*updateAssistant/);
  assert.match(hook, /else\s*\{[\s\S]*role:\s*['"]user['"]/);
  assert.match(hook, /retry:\s*requestSnapshot/);
  assert.match(transcript, /onRetry\(message\.id,\s*message\.retry!?\)/);
  assert.match(transcript, /已停止/);
});

test('MorseChat retains the S9 embedded and overlay shell behavior', () => {
  const component = fs.readFileSync(componentPath, 'utf8');
  const styles = fs.readFileSync(stylePath, 'utf8');

  assert.match(component, /type MorseChatProps = \{ variant\?: 'overlay' \| 'embedded' \};/);
  assert.match(component, /export default function MorseChat\(\{ variant = 'overlay' \}: MorseChatProps\)/);
  assert.match(component, /const embedded = variant === 'embedded'/);
  assert.match(component, /useState\(embedded\)/);
  assert.match(component, /window\.addEventListener\(['"]morse-chat:open['"]/);
  assert.match(component, /window\.removeEventListener\(['"]morse-chat:open['"]/);
  assert.match(component, /role=\{embedded \? undefined : 'dialog'\}/);
  assert.match(component, /embedded[\s\S]*scrollIntoView/);
  assert.match(component, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(component, /video|audio|speech|tts|lipSync/i);
  assert.match(styles, /\.panel\.embeddedPanel/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /100dvh/);
});

test('MorseChat document scroll lock stays in global CSS instead of a pure global module selector', () => {
  const styles = fs.readFileSync(stylePath, 'utf8');
  const globalStyles = fs.readFileSync(globalStylePath, 'utf8');

  assert.doesNotMatch(styles, /:global\(html\.morse-chat-open\)/);
  assert.match(globalStyles, /html\.morse-chat-open\s*\{[\s\S]*?overflow:\s*hidden;/);
});

test('MorseChat returns focus to the active intake after a stream settles', () => {
  const component = fs.readFileSync(componentPath, 'utf8');

  assert.match(component, /const wasStreamingRef = useRef\(false\)/);
  assert.match(component, /wasStreamingRef\.current && !chat\.streaming/);
  assert.match(component, /messageInputRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(component, /window\.requestAnimationFrame/);
});

test('chat scrolling keeps auto-follow inside the transcript viewport', () => {
  const source = allVisitorSource();

  assert.ok(fs.existsSync(scrollPath), 'missing chat scroll helper');
  assert.match(source, /from ['"]@\/lib\/client\/chat-scroll['"]/);
  assert.match(source, /const messagesRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(source, /const autoFollowRef = useRef\(true\)/);
  assert.match(source, /isNearChatBottom\(event\.currentTarget\)/);
  assert.match(source, /!chat\.streaming && !forceAutoFollowRef\.current/);
  assert.match(source, /scrollTo\(\{\s*top:\s*container\.scrollHeight,\s*behavior:\s*['"]auto['"],?\s*\}\)/s);
  assert.equal((source.match(/scrollIntoView/g) ?? []).length, 1);
});

test('portfolio route group keeps one embedded chat and one works overlay', () => {
  const portfolioLayout = readIfPresent(portfolioLayoutPath);
  const worksLayout = readIfPresent(worksLayoutPath);
  const page = readIfPresent(pagePath);

  assert.match(portfolioLayout, /AmbientBackground/);
  assert.match(page, /import MorseChat/);
  assert.equal((page.match(/<MorseChat variant="embedded"\s*\/>/g) ?? []).length, 1);
  assert.match(worksLayout, /import MorseChat/);
  assert.equal((worksLayout.match(/<MorseChat\s*\/>/g) ?? []).length, 1);
});

test('visitor controls remain tokenized, at least 44px, and responsive at 390px', () => {
  const styles = fs.readFileSync(stylePath, 'utf8');
  const heroStyles = fs.readFileSync(heroStylePath, 'utf8');

  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}|rgba?\(/i);
  assert.doesNotMatch(styles, /letter-spacing:\s*-[^;]+/i);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /min-width:\s*0/);
  assert.match(styles, /max-width:\s*100%/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /overflow-wrap:\s*anywhere/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /width:\s*min\(560px,\s*calc\(100vw - var\(--space-6\)\)\)/);
  assert.match(styles, /height:\s*min\(680px,\s*72svh\)/);
  assert.match(styles, /height:\s*min\(720px,\s*calc\(100svh - var\(--space-3\)\)\)/);
  assert.match(heroStyles, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*36rem\)/);
  assert.match(
    heroStyles,
    /@media \(max-width: 900px\)[\s\S]*?\.heroInner\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
});

test('visitor chat exposes stable selectors for deterministic browser acceptance', () => {
  const component = fs.readFileSync(componentPath, 'utf8');
  const workspace = readChatSource('ChatWorkspace.tsx');
  const transcript = readChatSource('ChatTranscript.tsx');
  const messageContent = readChatSource('ChatMessageContent.tsx');
  const phase = readChatSource('ChatPhaseStatus.tsx');
  const sources = readChatSource('ChatSources.tsx');
  const jd = readChatSource('JdIntake.tsx');
  const diagnosis = readChatSource('DiagnosisIntake.tsx');

  assert.match(component, /data-testid="morse-chat-panel"/);
  assert.match(workspace, /data-testid="morse-chat-workspace"/);
  for (const workflow of ['chat', 'jd_match', 'diagnosis']) {
    assert.match(workspace, new RegExp(`data-workflow=["']${workflow}["']`));
  }
  assert.match(transcript, /data-testid="morse-chat-transcript"/);
  assert.match(transcript, /data-message-role=\{message\.role\}/);
  assert.match(messageContent, /data-testid="morse-chat-message-content"/);
  assert.match(phase, /data-testid="morse-chat-phase"/);
  assert.match(phase, /data-phase=\{visiblePhase \?\? undefined\}/);
  assert.match(sources, /data-source-group="local"/);
  assert.match(sources, /data-source-group="web"/);
  assert.match(jd, /data-testid="morse-jd-intake"/);
  assert.match(diagnosis, /data-testid="morse-diagnosis-intake"/);
});
