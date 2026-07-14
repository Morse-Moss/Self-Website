export type TokenTotals = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type ToolActivity = {
  sessions: number | null;
  projects: number | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  allTime: TokenTotals | null;
  last30Days: TokenTotals | null;
  recordsWithoutUsage: number;
};

export type DevelopmentStats = {
  generatedAt: string;
  methodology: string;
  totals: {
    sessions: number | null;
    projects: number | null;
    activeDaysLast90: number | null;
  };
  claudeCode: ToolActivity;
  codex: ToolActivity;
};
