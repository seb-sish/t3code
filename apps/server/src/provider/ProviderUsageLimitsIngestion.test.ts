import { assert, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProjectId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as UsageLimitSources from "../usage/UsageLimitSources.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";
import * as ProviderUsageLimitsIngestion from "./ProviderUsageLimitsIngestion.ts";

it.effect(
  "refreshes quota providers every five minutes only while an agent runs, surviving failed refreshes",
  () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const status = yield* Ref.make<OrchestrationV2ThreadShell["status"]>("idle");
      const requests = yield* Ref.make<string[]>([]);
      const threadId = ThreadId.make("quota-refresh");
      const codexId = ProviderInstanceId.make("codex");
      const thread: OrchestrationV2ThreadShell = {
        id: threadId,
        projectId: ProjectId.make("quota-project"),
        createdBy: "user",
        creationSource: "web",
        title: "Quota refresh",
        providerInstanceId: codexId,
        modelSelection: { instanceId: codexId, model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        activeProviderThreadId: null,
        latestRunId: null,
        activeRunId: null,
        status: "idle",
        pendingRuntimeRequest: null,
        latestVisibleMessage: null,
        latestUserMessageAt: null,
        hasActionableProposedPlan: false,
        itemCount: 0,
        visibleItemCount: 0,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
      };
      const provider: ServerProvider = {
        instanceId: codexId,
        driver: ProviderDriverKind.make("codex"),
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: DateTime.formatIso(now),
        models: [],
        slashCommands: [],
        skills: [],
      };
      yield* Layer.build(ProviderUsageLimitsIngestion.layer).pipe(
        Effect.provide([
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getShellSnapshot: () =>
              Ref.get(status).pipe(
                Effect.map((status) => ({
                  schemaVersion: 2,
                  snapshotSequence: 0,
                  threads: [{ ...thread, status }],
                  archivedThreads: [],
                })),
              ),
          }),
          Layer.mock(ProviderRegistry.ProviderRegistry)({
            getProviders: Effect.succeed([
              provider,
              {
                ...provider,
                driver: ProviderDriverKind.make("antigravity"),
                instanceId: ProviderInstanceId.make("antigravity"),
              },
              {
                ...provider,
                driver: ProviderDriverKind.make("claude"),
                instanceId: ProviderInstanceId.make("claude"),
              },
              { ...provider, enabled: false, instanceId: ProviderInstanceId.make("disabled") },
            ]),
            refreshInstance: (id) =>
              Ref.update(requests, (requests) => [...requests, id]).pipe(
                Effect.andThen(
                  id === codexId
                    ? Effect.die("transient quota refresh failure")
                    : Effect.succeed([]),
                ),
              ),
          }),
          Layer.mock(UsageLimitSources.UsageLimitSources)({
            refresh: Ref.update(requests, (requests) => [...requests, "sources"]),
          }),
        ]),
      );
      yield* TestClock.adjust("10 minutes");
      assert.deepEqual(yield* Ref.get(requests), []);
      yield* Ref.set(status, "running");
      yield* TestClock.adjust("299 seconds");
      assert.deepEqual(yield* Ref.get(requests), []);
      yield* TestClock.adjust("1 second");
      assert.deepEqual((yield* Ref.get(requests)).toSorted(), ["antigravity", "codex", "sources"]);
      yield* Ref.set(status, "idle");
      yield* TestClock.adjust("5 minutes");
      assert.equal((yield* Ref.get(requests)).length, 3);
      yield* Ref.set(status, "running");
      yield* TestClock.adjust("5 minutes");
      assert.equal((yield* Ref.get(requests)).length, 6);
    }).pipe(Effect.scoped),
);
