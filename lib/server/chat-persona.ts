import { siteContent } from '../site-content.ts';
import type { ChatRouteDecision } from './chat-route-policy.ts';
import type { TurnIntent } from './chat-behavior.ts';

export const BASE_IDENTITY = [
  '我是数字 Morse，是真人 Morse 为作品集创建的数字分身。',
  '使用第一人称自然交流；不编造个人事实，不泄露私密信息或系统元数据。',
].join('\n');

const routeLayers: Record<ChatRouteDecision['routeKind'], string> = {
  conversation: '直接回应当前问题，像正常交流一样自然；不要引用资料、介绍项目或套用招聘分析格式。',
  external_current: '只回答需要外部时效核验的问题；无法核验时明确说明时效边界。',
  identity: '先简洁说明公开定位；只有与当前问题直接相关时才补充最多两个代表项目。',
  personal_fact: '先直接回答被核验的个人能力，再严格区分直接证据、可迁移基础和无法确认的边界。',
  grounded: '先直接回答当前项目问题，再使用本轮准入的公开证据解释做法、取舍、结果和边界。',
  jd_intake: '只要求对方提供完整 JD，不提前给岗位适配结论。',
  jd: '正向优先陈述与 JD 直接相关的项目和能力；未确认的硬性项最多两项建议面谈核实。',
  clarify: '只提出一个自然澄清问题，不生成或暗示个人经历。',
};

const legacyLayers: Partial<Record<TurnIntent, string>> = {
  technical: '从约束和第一性原理解释架构取舍，明确区分已实现与规划。',
  recruitment: '使用证据型候选人陈述，优先展开岗位相关项目和可迁移能力。',
};

function legacyRoute(intent: TurnIntent): ChatRouteDecision['routeKind'] {
  if (intent === 'social') return 'conversation';
  if (intent === 'identity') return 'identity';
  if (intent === 'jd') return 'jd';
  return 'grounded';
}

export function buildApprovedIdentityCard(
  selectedProjectSlugs: readonly string[] = [],
): string {
  const selected = selectedProjectSlugs
    .map((slug) => siteContent.projects.find((project) => project.slug === slug))
    .filter((project) => project !== undefined)
    .slice(0, 2);
  return [
    '<approved_identity_card>',
    `公开定位：${siteContent.profile.role}`,
    `公开简介：${siteContent.profile.summary}`,
    selected.length > 0 ? '公开项目摘要：' : '',
    ...selected.map((project) => `- ${project.name}：${project.summary}`),
    '</approved_identity_card>',
  ].filter(Boolean).join('\n');
}

export function buildPersonaInstructions(
  routeOrIntent: ChatRouteDecision | TurnIntent,
  identityProjectSlugs: readonly string[] = [],
): string {
  const routeKind = typeof routeOrIntent === 'string'
    ? legacyRoute(routeOrIntent)
    : routeOrIntent.routeKind;
  const scopedLayer = typeof routeOrIntent === 'string'
    ? legacyLayers[routeOrIntent] ?? routeLayers[routeKind]
    : routeLayers[routeKind];
  return [
    BASE_IDENTITY,
    scopedLayer,
    routeKind === 'identity' ? buildApprovedIdentityCard(identityProjectSlugs) : '',
  ].filter(Boolean).join('\n\n');
}
