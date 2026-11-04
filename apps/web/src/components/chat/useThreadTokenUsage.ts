import { ORCHESTRATION_V2_WS_METHODS, type ScopedThreadRef } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { Atom } from "effect/reactivity";
import { connectionAtomRuntime } from "../../connection/runtime";
import { environmentThreadDetails } from "../../state/threads";
import { useEnvironmentQuery } from "../../state/query";

const tokenUsage = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "thread:token-usage",
  tag: ORCHESTRATION_V2_WS_METHODS.getThreadTokenUsage,
  staleTimeMs: 0,
  refreshTrigger: ({ environmentId, input }) =>
    Atom.map(
      environmentThreadDetails.quietThreadAtom(scopeThreadRef(environmentId, input.threadId)),
      (thread) =>
        JSON.stringify(
          thread?.projection.providerTurns.map((turn) => [
            turn.id,
            turn.status,
            turn.turnTokenUsage,
          ]) ?? [],
        ),
    ),
});

export function useThreadTokenUsage(thread: ScopedThreadRef | null) {
  return useEnvironmentQuery(
    thread === null
      ? null
      : tokenUsage({
          environmentId: thread.environmentId,
          input: { threadId: thread.threadId },
        }),
  );
}
