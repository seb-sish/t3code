import type {
  OrchestrationV2ProviderTurn,
  OrchestrationV2RunAttempt,
  OrchestrationV2ThreadTokenUsage,
  OrchestrationV2TokenUsageTotals,
  RunId,
} from "@t3tools/contracts";

/** Uses persisted per-turn consumption, never the context window or cumulative provider ledger. */
export function summarizeThreadTokenUsage(records: {
  readonly attempts: ReadonlyArray<Pick<OrchestrationV2RunAttempt, "id" | "runId">>;
  readonly providerTurns: ReadonlyArray<OrchestrationV2ProviderTurn>;
}): OrchestrationV2ThreadTokenUsage {
  const runByAttempt = new Map(records.attempts.map((attempt) => [attempt.id, attempt.runId]));
  const byRun = new Map<RunId, Array<OrchestrationV2ProviderTurn>>();
  const turns = records.providerTurns.filter(
    (turn) =>
      turn.runAttemptId !== null &&
      (turn.turnTokenUsage !== undefined ||
        (turn.status !== "pending" && turn.status !== "running")) &&
      turn.turnTokenUsage?.localCommand !== true,
  );
  for (const turn of turns) {
    const runId = turn.runAttemptId === null ? undefined : runByAttempt.get(turn.runAttemptId);
    if (runId === undefined) continue;
    const group = byRun.get(runId) ?? [];
    group.push(turn);
    byRun.set(runId, group);
  }
  return {
    total: sumUsage(turns),
    runs: Array.from(byRun, ([runId, group]) => ({ runId, usage: sumUsage(group) })),
  };
}

function sumUsage(
  turns: ReadonlyArray<OrchestrationV2ProviderTurn>,
): OrchestrationV2TokenUsageTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let reasoningTokens = 0;
  let recordedTurns = 0;
  let unavailableTurns = 0;
  let inputKnown = turns.length > 0;
  let outputKnown = turns.length > 0;
  let cacheKnown = turns.length > 0;
  let reasoningKnown = turns.length > 0;
  let hasSubagents = false;
  for (const { turnTokenUsage: reported } of turns) {
    const usage = reported?.usageStatus === "unavailable" ? undefined : reported;
    if (
      usage?.inputTokens !== undefined ||
      usage?.outputTokens !== undefined ||
      usage?.otherUsage !== undefined
    )
      recordedTurns += 1;
    if (usage?.usageStatus !== "complete") unavailableTurns += 1;
    inputTokens += (usage?.inputTokens ?? 0) + (usage?.otherUsage?.inputTokens ?? 0);
    outputTokens += (usage?.outputTokens ?? 0) + (usage?.otherUsage?.outputTokens ?? 0);
    inputKnown &&= usage?.inputTokens !== undefined;
    outputKnown &&= usage?.outputTokens !== undefined;
    cachedInputTokens += usage?.cachedInputTokens ?? 0;
    reasoningTokens += usage?.reasoningTokens ?? 0;
    const otherTokens =
      (usage?.otherUsage?.inputTokens ?? 0) + (usage?.otherUsage?.outputTokens ?? 0);
    cacheKnown &&= usage?.cachedInputTokens !== undefined && otherTokens === 0;
    reasoningKnown &&= usage?.reasoningTokens !== undefined && otherTokens === 0;
    hasSubagents ||= reported?.hasSubagents === true;
  }
  return {
    totalTokens: inputTokens + outputTokens,
    recordedTurns,
    unavailableTurns,
    hasSubagents,
    ...(inputKnown ? { inputTokens } : {}),
    ...(outputKnown ? { outputTokens } : {}),
    ...(cacheKnown ? { cachedInputTokens } : {}),
    ...(reasoningKnown ? { reasoningTokens } : {}),
  };
}
