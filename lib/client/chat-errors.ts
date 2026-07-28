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
  if (code === 'CHAT_RATE_LIMITED') {
    return '这一分钟内提问有点密集,本次未扣减对话次数。请稍等约一分钟再点「重试本次问题」。';
  }
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
  if (code === 'CONTEXT_LIMIT_EXCEEDED') {
    return '这次对话内容超过了当前模型可处理的范围。请缩小问题范围后重试。';
  }
  if (code === 'CONTEXT_WINDOW_UNKNOWN') {
    return '当前模型没有提供可确认的上下文容量，无法安全整理历史后继续。请稍后重试。';
  }
  if (code === 'OUTPUT_TRUNCATED') {
    return '模型输出在完成前被截断，本次未扣减对话次数。请缩小问题范围后重试。';
  }
  if (code === 'CONTEXT_COMPACTION_FAILED') {
    return '历史对话整理未完成，本次未扣减对话次数。请稍后重试。';
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
