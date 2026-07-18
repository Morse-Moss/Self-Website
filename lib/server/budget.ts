import type { BudgetLevel, TokenUsage } from '../contracts/chat.ts';

export type { BudgetLevel, TokenUsage } from '../contracts/chat.ts';

export interface TokenRates {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export function classifyBudget(spentUsd: number, limitUsd: number): BudgetLevel {
  if (limitUsd <= 0 || spentUsd >= limitUsd) return 'exhausted';

  const ratio = spentUsd / limitUsd;
  if (ratio >= 0.9) return 'critical';
  if (ratio >= 0.75) return 'warning';
  if (ratio >= 0.5) return 'notice';
  return 'normal';
}

export function estimateCostUsd(usage: TokenUsage, rates: TokenRates): number {
  return (
    (usage.inputTokens / 1_000_000) * rates.inputUsdPerMillion
    + (usage.outputTokens / 1_000_000) * rates.outputUsdPerMillion
  );
}
