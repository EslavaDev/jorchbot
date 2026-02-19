const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-opus-4": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-haiku-3.5": 200_000,
  default: 200_000,
};

export interface ContextUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  percent: number;
  limit: number;
}

export function calculateContextUsage(
  inputTokens: number,
  outputTokens: number,
  model?: string,
): ContextUsage {
  const limit = MODEL_CONTEXT_LIMITS[model ?? "default"] ?? MODEL_CONTEXT_LIMITS.default;
  const totalTokens = inputTokens + outputTokens;
  const percent = Math.min(100, Math.round((totalTokens / limit) * 100));
  return { inputTokens, outputTokens, totalTokens, percent, limit };
}

export function formatContextUsage(usage: ContextUsage): string {
  const totalK = Math.round(usage.totalTokens / 1000);
  const limitK = Math.round(usage.limit / 1000);
  return `Context: ${usage.percent}% (${totalK}K/${limitK}K tokens)`;
}
