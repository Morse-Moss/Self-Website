export const hrInterviewEightTurnChain = [
  {
    message: '我现在想找AI产品经理，你有多少适配？',
    requireEvidence: false,
    requireFollowUp: false,
  },
  { message: '做海外红人的合作式外贸', requireEvidence: false, requireFollowUp: false },
  {
    message: '你有什么项目是跟我们公司相匹配的吗',
    requireEvidence: true,
    requireFollowUp: false,
  },
  {
    message: '我要的是跟我的JD相关的业务项目，而不是让你列举全部',
    requireEvidence: false,
    requireFollowUp: false,
  },
  {
    message: '跟海外红人做合作式外贸，要求能全栈开发，了解自动化流程搭建，工具迭代与问题优化',
    requireEvidence: true,
    requireFollowUp: false,
  },
  { message: '你有什么相关的项目经验吗？', requireEvidence: true, requireFollowUp: true },
  { message: '你确定没有任何相关的项目经验吗', requireEvidence: true, requireFollowUp: true },
  { message: '你再去查一下', requireEvidence: true, requireFollowUp: true },
] as const;
