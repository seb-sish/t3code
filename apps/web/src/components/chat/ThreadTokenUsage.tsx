import type { OrchestrationV2TokenUsageTotals, RunId, ScopedThreadRef } from "@t3tools/contracts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useThreadTokenUsage } from "./useThreadTokenUsage";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat("en-US");

export function ThreadTokenUsage({
  thread,
  runId,
}: {
  readonly thread: ScopedThreadRef;
  readonly runId?: RunId;
}) {
  const query = useThreadTokenUsage(thread);
  const usage =
    runId === undefined
      ? query.data?.total
      : query.data?.runs.find((run) => run.runId === runId)?.usage;
  const label = runId === undefined ? "Chat tokens" : "Request tokens";
  const text = usage?.recordedTurns
    ? compact.format(usage.totalTokens)
    : query.isPending
      ? "…"
      : "no data";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums"
          />
        }
      >
        {label}: {text}
        {usage && usage.unavailableTurns > 0 && usage.recordedTurns > 0 ? "+" : ""}
      </TooltipTrigger>
      <TooltipPopup className="max-w-xs">
        {usage?.recordedTurns ? (
          <TokenBreakdown usage={usage} />
        ) : query.error ? (
          "Token usage is currently unavailable."
        ) : (
          "The provider has not reported token usage for this work."
        )}
      </TooltipPopup>
    </Tooltip>
  );
}

function TokenBreakdown({ usage }: { readonly usage: OrchestrationV2TokenUsageTotals }) {
  return (
    <div className="space-y-1">
      <p>
        {usage.unavailableTurns > 0 ? "Known total" : "Total"}: {exact.format(usage.totalTokens)}
      </p>
      <p>
        Input:{" "}
        {usage.inputTokens === undefined ? "not fully reported" : exact.format(usage.inputTokens)} ·
        Output:{" "}
        {usage.outputTokens === undefined ? "not fully reported" : exact.format(usage.outputTokens)}
      </p>
      <p>
        Cached input:{" "}
        {usage.cachedInputTokens === undefined
          ? "not reported"
          : exact.format(usage.cachedInputTokens)}
      </p>
      {usage.reasoningTokens !== undefined ? (
        <p>Reasoning output: {exact.format(usage.reasoningTokens)}</p>
      ) : null}
      <p>Cached input and reasoning are already included in the total.</p>
      {usage.unavailableTurns > 0 ? <p>Partial usage: some turns have missing counters.</p> : null}
      {usage.hasSubagents ? (
        <p>Includes additional usage reported by the provider. Subagent usage may be incomplete.</p>
      ) : null}
    </div>
  );
}
