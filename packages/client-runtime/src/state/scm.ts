import { WS_METHODS } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createScmEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const status = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "scm:status",
    tag: WS_METHODS.scmStatus,
    staleTimeMs: 0,
    idleTtlMs: 0,
    refreshIntervalMs: 3000,
  });
  return {
    discovery: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "scm:discovery",
      tag: WS_METHODS.scmDiscover,
      idleTtlMs: 0,
      completeWhen: (snapshot) => !snapshot.scanning,
    }),
    status,
    history: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "scm:history",
      tag: WS_METHODS.scmHistory,
      staleTimeMs: 0,
      idleTtlMs: 0,
      refreshTrigger: ({ environmentId, input }) =>
        Atom.map(
          status({
            environmentId,
            input: {
              projectId: input.projectId,
              repositoryPath: input.repositoryPath,
              ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
            },
          }),
          (result) => AsyncResult.getOrElse(result, () => null)?.revision,
        ),
    }),
    diff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "scm:diff",
      tag: WS_METHODS.scmDiff,
      staleTimeMs: 0,
      idleTtlMs: 0,
      refreshTrigger: ({ environmentId, input }) =>
        Atom.map(
          status({
            environmentId,
            input: {
              projectId: input.projectId,
              repositoryPath: input.repositoryPath,
              ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
            },
          }),
          (result) => AsyncResult.getOrElse(result, () => null)?.revision,
        ),
    }),
    mutate: createEnvironmentRpcCommand(runtime, {
      label: "scm:mutate",
      tag: WS_METHODS.scmMutate,
    }),
  };
}
