import type { NormalizedChatRequest } from '../contracts/chat-runtime.ts';
import { looksLikeFullJobDescription } from './chat-message-signals.ts';

export { looksLikeFullJobDescription } from './chat-message-signals.ts';

export const TURN_INTENTS = [
  'social',
  'identity',
  'project',
  'recruitment',
  'jd',
  'technical',
] as const;

export type TurnIntent = typeof TURN_INTENTS[number];
export type GenerationProfile = 'social' | 'grounded' | 'jd';
// Historical values remain typed only to read existing rows. New turns are fixed to V2.2 in chat-service.
export type ChatBehavior = 'v1' | 'v2' | 'safe';

export interface TurnRoute {
  intent: TurnIntent;
  profile: GenerationProfile;
  evidence: 'none' | 'identity' | 'rag';
  release: 'segment' | 'complete';
  reasoningEffort?: 'low';
}

export function routeChatTurn(request: NormalizedChatRequest): TurnRoute {
  if (request.workflow === 'jd_match' || looksLikeFullJobDescription(request.message)) {
    return {
      intent: 'jd',
      profile: 'jd',
      evidence: 'rag',
      release: 'complete',
      reasoningEffort: 'low',
    };
  }

  const message = request.message.trim();
  if (/^(?:(?:你好|嗨|hello|hi)(?:[!！。,.，\s]*(?:很高兴认识你|我们先(?:简单)?认识一下))?|谢谢|多谢|再见)[!！。,.，\s]*$/iu.test(message)) {
    return {
      intent: 'social',
      profile: 'social',
      evidence: 'none',
      release: 'segment',
      reasoningEffort: 'low',
    };
  }
  if (/你是谁|介绍(?:一下)?自己|数字\s*(?:morse|摩斯)/iu.test(message)) {
    return { intent: 'identity', profile: 'grounded', evidence: 'identity', release: 'segment' };
  }
  if (/招聘|岗位|面试|候选人|简历|胜任|匹配/iu.test(message)) {
    return { intent: 'recruitment', profile: 'grounded', evidence: 'rag', release: 'complete' };
  }
  if (/agent|rag|架构|技术|数据库|provider|sse|可靠性/iu.test(message)) {
    return { intent: 'technical', profile: 'grounded', evidence: 'rag', release: 'segment' };
  }
  return { intent: 'project', profile: 'grounded', evidence: 'rag', release: 'segment' };
}
