export interface ControlledContextFailureChainStep {
  message: string;
  semanticIntent: 'project_fit' | 'jd_match';
  taskAction: 'create' | 'continue' | 'complete';
  discourseAction: 'new_task' | 'correction' | 'follow_up';
}

export const controlledContextFailureChain = {
  steps: [
    {
      message: '公司：示例科技，岗位：AI 产品经理，哪些项目和这个岗位最匹配？',
      semanticIntent: 'project_fit',
      taskAction: 'create',
      discourseAction: 'new_task',
    },
    {
      message: '不是这样的，公司不是示例科技，而是示例云科技，备注 STALE_CORRECTION_DETAIL，继续看匹配项目。',
      semanticIntent: 'project_fit',
      taskAction: 'continue',
      discourseAction: 'correction',
    },
    {
      message: 'AI Product Manager，需要设计 RAG 产品、评测方案并推动跨团队交付',
      semanticIntent: 'jd_match',
      taskAction: 'continue',
      discourseAction: 'follow_up',
    },
    {
      message: '你有什么相关的项目经验吗？',
      semanticIntent: 'project_fit',
      taskAction: 'continue',
      discourseAction: 'follow_up',
    },
    {
      message: '就按这个岗位给出最终结论并结束',
      semanticIntent: 'project_fit',
      taskAction: 'complete',
      discourseAction: 'follow_up',
    },
  ] satisfies ControlledContextFailureChainStep[],
  expectedEvidence: [
    { projectSlug: 'digital-morse', level: 'direct' },
    { projectSlug: 'deep-research', level: 'transferable' },
    { projectSlug: 'content-agent', level: 'transferable' },
  ] as const,
  forbiddenProjectSlugs: ['auto-operations', 'ai-leadgen'] as const,
  staleMarkers: ['STALE_CORRECTION_DETAIL', '示例科技'] as const,
} as const;
