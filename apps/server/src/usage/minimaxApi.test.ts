import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";

import { makeMinimaxApi } from "./minimaxApi.ts";

const general = {
  model_name: "general",
  current_interval_remaining_percent: 72,
  current_interval_status: 1,
  remains_time: 3_600_000,
  current_weekly_remaining_percent: 41,
  current_weekly_status: 1,
  weekly_remains_time: 86_400_000,
};
const payload = { base_resp: { status_code: 0 }, model_remains: [general] };

function fixture(response: unknown, status = 200) {
  return makeMinimaxApi.pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((request, _url, _signal, fiber) =>
        Effect.sync(() => {
          expect(request.url).toBe("https://www.minimax.io/v1/token_plan/remains");
          expect(request.method).toBe("GET");
          expect(request.headers.authorization).toMatch(/^Bearer /);
          expect(Context.getOrUndefined(fiber.context, FetchHttpClient.RequestInit)?.redirect).toBe(
            "manual",
          );
          return HttpClientResponse.fromWeb(request, Response.json(response, { status }));
        }),
      ),
    ),
    Effect.provide(NodeCrypto.layer),
  );
}

describe("MiniMax M Plan quotas", () => {
  it.effect("reads remaining percentages and millisecond resets from the general category", () =>
    Effect.gen(function* () {
      const api = yield* fixture({ ...payload, model_remains: [{ model_name: "video" }, general] });
      const [account] = yield* api.readAccounts("subscription-test-key");
      expect(account).toMatchObject({ driver: "minimax", plan: "M Plan" });
      expect(account?.usageLimits.windows).toEqual([
        {
          id: "five-hour",
          kind: "session",
          label: "5-hour",
          usedPercent: 28,
          windowDurationMins: 300,
          resetsAt: "1970-01-01T01:00:00.000Z",
        },
        {
          id: "weekly",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 59,
          windowDurationMins: 10080,
          resetsAt: "1970-01-02T00:00:00.000Z",
        },
      ]);
      expect(account?.usageLimits.credentialFingerprint).toMatch(/^[0-9a-f]{64}$/);
      const same = yield* api.readAccounts("subscription-test-key");
      const different = yield* api.readAccounts("another-test-key");
      expect(same[0]?.usageLimits.credentialFingerprint).toBe(
        account?.usageLimits.credentialFingerprint,
      );
      expect(different[0]?.usageLimits.credentialFingerprint).not.toBe(
        account?.usageLimits.credentialFingerprint,
      );
      expect(JSON.stringify(account)).not.toContain("subscription-test-key");
    }),
  );

  it.effect("omits unavailable buckets and does not invent a missing reset", () =>
    Effect.gen(function* () {
      const api = yield* fixture({
        model_remains: [{ ...general, current_weekly_status: 3, remains_time: null }],
      });
      const [account] = yield* api.readAccounts("test-key");
      expect(account?.usageLimits.windows).toEqual([
        {
          id: "five-hour",
          kind: "session",
          label: "5-hour",
          usedPercent: 28,
          windowDurationMins: 300,
        },
      ]);
    }),
  );

  it.effect.each([
    ["HTTP authorization failure", { message: "Bearer subscription-test-key" }, 401],
    ["redirect", payload, 302],
    [
      "API failure",
      { ...payload, base_resp: { status_code: 1004, status_msg: "subscription-test-key" } },
      200,
    ],
    ["missing category", { model_remains: [{ model_name: "video" }] }, 200],
    [
      "invalid percentage",
      { model_remains: [{ ...general, current_interval_remaining_percent: 101 }] },
      200,
    ],
    [
      "unavailable plan",
      { model_remains: [{ ...general, current_interval_status: 3, current_weekly_status: 3 }] },
      200,
    ],
  ] as const)("reports %s without exposing the key or response", ([_name, response, status]) =>
    Effect.gen(function* () {
      const api = yield* fixture(response, status);
      const result = yield* api.readAccounts("subscription-test-key").pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("UsageLimitSourceError");
        expect(result.failure.detail).not.toContain("subscription-test-key");
      }
    }),
  );
});
