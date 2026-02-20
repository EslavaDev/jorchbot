// Pure functions for context window guard evaluation.
// Two-step pattern: resolveContextInfo → evaluateContextGuard → result object.

export const DEFAULT_WARN_PERCENT = 70;
export const DEFAULT_CRITICAL_PERCENT = 90;
export const DEFAULT_BLOCK_PERCENT = 95;
export const DEFAULT_CONTEXT_LIMIT = 200_000;

export type ContextGuardLevel = "ok" | "warn" | "critical" | "block";

export interface ContextGuardInfo {
  percent: number;
  totalTokens: number;
  contextLimit: number;
}

export interface ContextGuardThresholds {
  warnPercent?: number;
  criticalPercent?: number;
  blockPercent?: number;
}

export interface ContextGuardResult extends ContextGuardInfo {
  level: ContextGuardLevel;
  shouldWarn: boolean;
  shouldBlock: boolean;
  message: string | null;
}

/**
 * Step 1: Resolve context info from raw token counts.
 * Computes percentage and clamps to [0, 100].
 */
export function resolveContextInfo(params: {
  inputTokens: number;
  outputTokens: number;
  contextLimit?: number;
}): ContextGuardInfo {
  const contextLimit = params.contextLimit ?? DEFAULT_CONTEXT_LIMIT;
  const totalTokens = params.inputTokens + params.outputTokens;

  if (totalTokens <= 0 || contextLimit <= 0) {
    return { percent: 0, totalTokens: Math.max(0, totalTokens), contextLimit };
  }

  const percent = Math.min(100, Math.round((totalTokens / contextLimit) * 100));
  return { percent, totalTokens, contextLimit };
}

/**
 * Step 2: Evaluate guard level from context info and thresholds.
 * Returns a result with level, flags, and a ready-to-send message.
 */
export function evaluateContextGuard(params: {
  info: ContextGuardInfo;
  thresholds?: ContextGuardThresholds;
  project?: string;
}): ContextGuardResult {
  const { info, thresholds, project } = params;
  const warnPercent = thresholds?.warnPercent ?? DEFAULT_WARN_PERCENT;
  const criticalPercent = thresholds?.criticalPercent ?? DEFAULT_CRITICAL_PERCENT;
  const blockPercent = thresholds?.blockPercent ?? DEFAULT_BLOCK_PERCENT;

  const prefix = project ? `[${project}] ` : "";
  const { percent } = info;

  if (percent >= blockPercent) {
    return {
      ...info,
      level: "block",
      shouldWarn: false,
      shouldBlock: true,
      message: `${prefix}Context at ${percent}% (limit reached). Use /compact to free space before sending new prompts.`,
    };
  }

  if (percent >= criticalPercent) {
    return {
      ...info,
      level: "critical",
      shouldWarn: true,
      shouldBlock: false,
      message: `${prefix}Context at ${percent}%. Use /compact to free space.`,
    };
  }

  if (percent >= warnPercent) {
    return {
      ...info,
      level: "warn",
      shouldWarn: true,
      shouldBlock: false,
      message: `${prefix}Context at ${percent}%`,
    };
  }

  return {
    ...info,
    level: "ok",
    shouldWarn: false,
    shouldBlock: false,
    message: null,
  };
}
