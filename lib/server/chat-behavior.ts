import { createHash } from 'node:crypto';

import type { ChatBehaviorVersion } from '../contracts/chat.ts';
import type { NormalizedChatRequest } from './chat-core.ts';

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
export type ChatBehavior = ChatBehaviorVersion | 'safe';

export interface TurnRoute {
  intent: TurnIntent;
  profile: GenerationProfile;
  evidence: 'none' | 'identity' | 'rag';
  release: 'segment' | 'complete';
  reasoningEffort?: 'low';
}

export interface ChatBehaviorSelectionInput {
  safeMode: boolean;
  v2Enabled: boolean;
  canaryPercent: number;
  accessSessionId: string;
  inviteCodeId: string | null;
  canaryInviteIds: ReadonlySet<string>;
}

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function looksLikeFullJobDescription(message: string): boolean {
  if (message.length < 80) return false;
  const hasResponsibilities = /岗位职责|工作职责|职位描述|职责描述|工作内容/iu.test(message);
  const hasRequirements = /任职要求|岗位要求|职位要求|资格要求|任职资格/iu.test(message);
  return hasResponsibilities && hasRequirements;
}

export function routeChatTurn(request: NormalizedChatRequest): TurnRoute {
  if (request.workflow === 'jd_match' || looksLikeFullJobDescription(request.message)) {
    return { intent: 'jd', profile: 'jd', evidence: 'rag', release: 'complete' };
  }

  const message = request.message.trim();
  if (/^(你好|嗨|hello|hi|谢谢|多谢|再见)[!！。,.，\s]*$/iu.test(message)) {
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

export function stableChatCanaryBucket(accessSessionId: string): number {
  const normalized = accessSessionId.trim().toLowerCase();
  if (!CANONICAL_UUID_PATTERN.test(normalized)) {
    throw new TypeError('accessSessionId must be a canonical UUID.');
  }
  const digest = createHash('sha256').update(normalized, 'utf8').digest();
  return digest.readUInt32BE(0) % 100;
}

export function selectChatBehavior(input: ChatBehaviorSelectionInput): ChatBehavior {
  if (input.safeMode) return 'safe';
  if (!input.v2Enabled) return 'v1';
  if (!Number.isSafeInteger(input.canaryPercent)
    || input.canaryPercent < 0
    || input.canaryPercent > 100) {
    throw new RangeError('canaryPercent must be an integer between 0 and 100.');
  }
  if (
    input.inviteCodeId
    && input.canaryInviteIds.has(input.inviteCodeId.trim().toLowerCase())
  ) {
    return 'v2';
  }
  return stableChatCanaryBucket(input.accessSessionId) < input.canaryPercent ? 'v2' : 'v1';
}
