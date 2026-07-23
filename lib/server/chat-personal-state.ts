const realtimePersonalStatePatterns = [
  /(?:今天|今晚|刚才)?\s*吃(?:饭)?(?:了|过|了吗|没|什么)/iu,
  /(?:昨晚|今天|今晚|刚才)?\s*睡(?:了|过|觉了吗|得怎么样|得好吗)/iu,
  /(?:最近|近来|这几天|现在|目前|今天|今晚|刚才).{0,12}(?:忙什么|忙吗|在做什么|在干嘛|工作|生活|状态|安排|行程|怎么样)/iu,
  /(?:你|真人\s*Morse|Morse)?\s*(?:现在)?\s*(?:在做什么|在干嘛|忙什么|忙吗|在哪(?:里)?)/iu,
  /(?:心情|身体|状态).{0,8}(?:怎么样|好吗|如何)|(?:累|困|生病)了吗?/iu,
];

const digitalBoundary = /(?:数字\s*Morse|数字分身|没有(?:身体|真实生活|实时(?:生活|状态)|个人行程)|不(?:真正|会|需要)(?:吃|睡|休息)|(?:不能|无法)替真人确认|不掌握真人.{0,12}(?:实时|最近|当前|行程|状态)|不知道真人.{0,12}(?:实时|最近|当前|行程|状态))/iu;

export function asksRealtimePersonalState(question: string): boolean {
  return realtimePersonalStatePatterns.some((pattern) => pattern.test(question));
}

export function preservesDigitalStateBoundary(answer: string): boolean {
  return digitalBoundary.test(answer);
}

export function realtimePersonalStateInstruction(question: string): string {
  if (!asksRealtimePersonalState(question)) return '';
  return [
    '当前问题涉及身体状态或实时个人状态。',
    '你是数字分身：自然说明自己没有身体或实时生活，且不能替真人 Morse 确认当前或近期状态。',
    '不得像真人一样声称已经吃饭、正在工作或最近在做某件事；保持简短自然，不要转成项目介绍。',
  ].join('\n');
}
