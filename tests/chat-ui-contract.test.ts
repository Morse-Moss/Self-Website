import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const componentPath = path.resolve('components/MorseChat.tsx');
const stylePath = path.resolve('components/MorseChat.module.css');
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

test('MorseChat is mounted once and its styles use tokens with a mobile full-screen mode', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const styles = fs.readFileSync(stylePath, 'utf8');

  assert.match(page, /import MorseChat/);
  assert.equal((page.match(/<MorseChat \/>/g) ?? []).length, 1);
  assert.match(styles, /var\(--z-chat\)/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /100dvh/);
  assert.match(styles, /html\.morse-chat-open/);
  assert.match(styles, /overflow:\s*hidden/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}|rgba?\(/i);
});
