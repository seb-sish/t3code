import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { forkParked } from "../serverActivation.ts";
import * as UsageLimitSources from "../usage/UsageLimitSources.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const registry = yield* ProviderRegistry.ProviderRegistry;
    const sources = yield* UsageLimitSources.UsageLimitSources;
    const refresh = Effect.fn("ProviderUsageLimitsIngestion.refreshActiveQuotas")(function* () {
      const shell = yield* projections.getShellSnapshot({ unsettledOnly: true });
      if (!shell.threads.some((thread) => thread.status === "running")) return;
      const providers = (yield* registry.getProviders).filter(
        (provider) =>
          provider.enabled &&
          provider.installed &&
          provider.auth.status === "authenticated" &&
          (provider.driver === "codex" || provider.driver === "antigravity"),
      );
      yield* Effect.all(
        [
          ...providers.map((provider) =>
            registry.refreshInstance(provider.instanceId).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Active quota refresh failed", {
                  instanceId: provider.instanceId,
                  cause,
                }),
              ),
            ),
          ),
          sources.refresh,
        ],
        { concurrency: "unbounded", discard: true },
      );
    });
    yield* forkParked(
      Effect.sleep("5 minutes").pipe(
        Effect.andThen(
          refresh().pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Active quota refresh failed", { cause }),
            ),
          ),
        ),
        Effect.forever,
      ),
    );
  }),
);
