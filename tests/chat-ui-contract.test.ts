import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const componentPath = path.resolve('components/MorseChat.tsx');
const stylePath = path.resolve('components/MorseChat.module.css');
const shellPath = path.resolve('components/site/SiteShell.tsx');
const pagePath = path.resolve('app/page.tsx');

test('MorseChat exposes invite, mode, stream, source, error, and logout states', () => {
  const component = fs.readFileSync(componentPath, 'utf8');

  assert.match(component, /data-testid="morse-chat"/);
  assert.match(component, /\/api\/access/);
  assert.match(component, /\/api\/chat/);
  assert.match(component, /面试官模式/);
  assert.match(component, /普通对话/);
  assert.match(component, /event === 'meta'/);
  assert.match(component, /event === 'delta'/);
  assert.match(component, /event === 'done'/);
  assert.match(component, /event === 'error'/);
  assert.match(component, /budgetLevel/);
  assert.match(component, /本月对话额度/);
  assert.match(component, /setRemainingMessages\(data\.remainingMessages/);
  assert.match(component, /sources\.map/);
  assert.match(component, /退出会话/);
  assert.match(component, /classList\.add\('morse-chat-open'\)/);
});

test('MorseChat opens from the global event and exposes the three structured starter intents', () => {
  const component = fs.readFileSync(componentPath, 'utf8');

  assert.match(component, /window\.addEventListener\(['"]morse-chat:open['"],\s*\w+\)/);
  assert.match(component, /window\.removeEventListener\(['"]morse-chat:open['"],\s*\w+\)/);
  assert.match(
    component,
    /label:\s*'招人的',\s*mode:\s*'interviewer',\s*prompt:\s*'请从招聘方视角介绍最匹配的项目、能力证据和仍需补充的信息。'/s,
  );
  assert.match(
    component,
    /label:\s*'找人做事的',\s*mode:\s*'general',\s*prompt:\s*'我想了解摩斯会如何分析并推进一个 AI 系统需求。'/s,
  );
  assert.match(
    component,
    /label:\s*'同行交流',\s*mode:\s*'general',\s*prompt:\s*'请介绍摩斯在 Agent、RAG 和多 Agent 系统上的关键工程判断。'/s,
  );
  assert.equal((component.match(/label:\s*'/g) ?? []).length, 3);

  const intentClick = component.match(
    /onClick=\{\(\)\s*=>\s*\{\s*setMode\(intent\.mode\);\s*setDraft\(intent\.prompt\);\s*\}\}/s,
  )?.[0] ?? '';
  assert.ok(intentClick, 'starter intent click must set mode and draft');
  assert.doesNotMatch(intentClick, /sendMessage|submit|fetch/);
});

test('MorseChat is mounted once by SiteShell and its styles preserve tokenized mobile full-screen mode', () => {
  const shell = fs.readFileSync(shellPath, 'utf8');
  const page = fs.readFileSync(pagePath, 'utf8');
  const styles = fs.readFileSync(stylePath, 'utf8');

  assert.match(shell, /import MorseChat/);
  assert.equal((shell.match(/<MorseChat \/>/g) ?? []).length, 1);
  assert.doesNotMatch(page, /import MorseChat|<MorseChat\b/);
  assert.match(styles, /var\(--z-chat\)/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /inset:\s*0/);
  assert.match(styles, /width:\s*100%/);
  assert.match(styles, /100dvh/);
  assert.match(styles, /html\.morse-chat-open/);
  assert.match(styles, /overflow:\s*hidden/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}|rgba?\(/i);
});
