import {
  ProviderDriverKind,
  UsageLimitSourceError,
  type UsageLimitSourceAccount,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

const Percent = Schema.NullOr(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 })));
const QuotaResponse = Schema.Struct({
  base_resp: Schema.optional(Schema.Struct({ status_code: Schema.Number })),
  model_remains: Schema.Array(
    Schema.Struct({
      model_name: Schema.String,
      current_interval_remaining_percent: Schema.optional(Percent),
      current_interval_status: Schema.optional(Schema.NullOr(Schema.Number)),
      remains_time: Schema.optional(Schema.NullOr(Schema.Number)),
      current_weekly_remaining_percent: Schema.optional(Percent),
      current_weekly_status: Schema.optional(Schema.NullOr(Schema.Number)),
      weekly_remains_time: Schema.optional(Schema.NullOr(Schema.Number)),
    }),
  ),
});

export const makeMinimaxApi = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const crypto = yield* Crypto.Crypto;

  const readAccounts = Effect.fn("MinimaxApi.readAccounts")(function* (key: string) {
    const response = yield* client
      .execute(
        HttpClientRequest.get("https://www.minimax.io/v1/token_plan/remains").pipe(
          HttpClientRequest.setHeaders({
            Authorization: `Bearer ${key}`,
            Accept: "application/json",
          }),
        ),
      )
      .pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(QuotaResponse)),
        Effect.timeout("20 seconds"),
        Effect.mapError(
          () =>
            new UsageLimitSourceError({
              detail: "Could not read MiniMax M Plan quotas. Check the Subscription Key and plan.",
            }),
        ),
      );
    if (response.base_resp && response.base_resp.status_code !== 0) {
      return yield* new UsageLimitSourceError({
        detail: "MiniMax rejected the quota request. Check the Subscription Key and plan.",
      });
    }
    const general = response.model_remains.find((entry) => entry.model_name === "general");
    const now = yield* DateTime.now;
    const checkedAt = DateTime.formatIso(now);
    const windows = [];
    for (const [id, kind, label, remaining, status, resetIn, duration] of [
      [
        "five-hour",
        "session",
        "5-hour",
        general?.current_interval_remaining_percent,
        general?.current_interval_status,
        general?.remains_time,
        300,
      ],
      [
        "weekly",
        "weekly",
        "Weekly",
        general?.current_weekly_remaining_percent,
        general?.current_weekly_status,
        general?.weekly_remains_time,
        10080,
      ],
    ] as const) {
      if (remaining == null || (status != null && status !== 1)) continue;
      const resetsAt =
        resetIn != null && Number.isFinite(resetIn)
          ? DateTime.make(DateTime.toEpochMillis(now) + Math.max(0, resetIn)).pipe(
              Option.map(DateTime.formatIso),
              Option.getOrUndefined,
            )
          : undefined;
      windows.push({
        id,
        kind,
        label,
        usedPercent: 100 - remaining,
        windowDurationMins: duration,
        ...(resetsAt ? { resetsAt } : {}),
      });
    }
    if (windows.length === 0) {
      return yield* new UsageLimitSourceError({
        detail: "MiniMax did not return available quotas for the general category of M Plan.",
      });
    }
    const fingerprint = yield* crypto
      .digest("SHA-256", new TextEncoder().encode(key))
      .pipe(Effect.map(Hex.encode), Effect.orDie);
    const accounts: ReadonlyArray<UsageLimitSourceAccount> = [
      {
        id: "MiniMax",
        driver: ProviderDriverKind.make("minimax"),
        plan: "M Plan",
        usageLimits: { checkedAt, credentialFingerprint: fingerprint, windows },
      },
    ];
    return accounts;
  });
  return { readAccounts };
});
