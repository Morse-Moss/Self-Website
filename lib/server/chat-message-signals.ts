export function looksLikeFullJobDescription(message: string): boolean {
  if (message.length < 80) return false;
  const hasResponsibilities = /岗位职责|工作职责|职位描述|职责描述|工作内容/iu.test(message);
  const hasRequirements = /任职要求|岗位要求|职位要求|资格要求|任职资格/iu.test(message);
  return hasResponsibilities && hasRequirements;
}
