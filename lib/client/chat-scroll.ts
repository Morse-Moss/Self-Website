type ChatScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

const CHAT_BOTTOM_THRESHOLD_PX = 48;

export function isNearChatBottom(metrics: ChatScrollMetrics): boolean {
  const distanceFromBottom = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
  return distanceFromBottom <= CHAT_BOTTOM_THRESHOLD_PX;
}
