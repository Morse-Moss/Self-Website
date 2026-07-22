import {
  CHAT_ERROR_CODES,
  RECOVERABLE_CHAT_ERROR_CODES,
  type ChatErrorCode,
} from '../contracts/chat.ts';

const stableChatErrorCodes = new Set<string>(CHAT_ERROR_CODES);
const recoverableChatErrorCodes = new Set<string>(RECOVERABLE_CHAT_ERROR_CODES);
const autoReplayChatErrorCodes = new Set<string>([
  'RETRIEVAL_UNAVAILABLE',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_INCOMPLETE',
  'CONVERSATION_BUSY',
  'CHAT_UNAVAILABLE',
]);

export function publicErrorMessage(code?: string): string {
  if (code === 'MESSAGE_LIMIT') return '本次邀请码的对话额度已用完,请联系摩斯获取新码。';
  if (code === 'BUDGET_EXHAUSTED') return '数字摩斯本月额度已用完,作品集仍可正常浏览。';
  if (code === 'SESSION_INVALID' || code === 'ACCESS_REQUIRED') {
    return '本次访问已过期,请重新输入有效邀请码。';
  }
  if (code === 'RETRIEVAL_UNAVAILABLE') {
    return '公开知识暂时检索失败,本次未扣减对话次数。';
  }
  if (code === 'PROVIDER_UNAVAILABLE' || code === 'PROVIDER_INCOMPLETE') {
    return '回答流中断了,本次未扣减对话次数。';
  }
  if (code === 'CONVERSATION_BUSY') {
    return '上一轮还在处理,本次未扣减对话次数。可以稍后重试本次问题。';
  }
  if (code === 'CONVERSATION_INVALID' || code === 'CONVERSATION_MODE_MISMATCH') {
    return '这段会话状态已变化,可以重新发起本次问题。';
  }
  return '这次回答没有完成,可以稍后重试。';
}

export function isRecoverableChatError(code?: string): boolean {
  return typeof code === 'string' && recoverableChatErrorCodes.has(code);
}

export function isAutoReplayChatError(code?: string): boolean {
  return typeof code === 'string' && autoReplayChatErrorCodes.has(code);
}

export function normalizeChatErrorCode(error: unknown): ChatErrorCode {
  const code = error instanceof Error ? error.message : '';
  return stableChatErrorCodes.has(code) ? code as ChatErrorCode : 'CHAT_UNAVAILABLE';
}
