import { ProviderDriverKind, type UsageLimitSourceAccount } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

class MinimaxQuotaReadError extends Schema.TaggedError<MinimaxQuotaReadError>()(
  "MinimaxQuotaReadError",
  {
    stage: Schema.Literals(["request", "http", "json", "decode", "api", "quota"]),
    cause: Schema.optional(Schema.Defect()),
    httpStatus: Schema.optional(Schema.Number),
    apiCode: Schema.optional(Schema.Number),
  },
) {
  override get message(): string {
    return "Could not read MiniMax M Plan quotas. Check the Subscription Key and plan.";
  }
}

const Percent = Schema.NullOr(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 })));
const ApiStatus = Schema.Struct({
  base_resp: Schema.optional(Schema.Struct({ status_code: Schema.Number })),
});
const QuotaResponse = Schema.Struct({
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
const decodeApiStatus = Schema.decodeUnknownEffect(ApiStatus);
const decodeQuotaResponse = Schema.decodeUnknownEffect(QuotaResponse);

export const makeMinimaxApi = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const crypto = yield* Crypto.Crypto;

  const readAccounts = Effect.fn("MinimaxApi.readAccounts")(function* (key: string) {
    const json = yield* client
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
        Effect.mapError((cause) => new MinimaxQuotaReadError({ stage: "request", cause })),
        Effect.flatMap((response) =>
          HttpClientResponse.filterStatusOk(response).pipe(
            Effect.mapError(
              (cause) =>
                new MinimaxQuotaReadError({ stage: "http", httpStatus: response.status, cause }),
            ),
          ),
        ),
        Effect.flatMap((response) =>
          response.json.pipe(
            Effect.mapError((cause) => new MinimaxQuotaReadError({ stage: "json", cause })),
          ),
        ),
        Effect.timeout("20 seconds"),
        Effect.catchTags({
          TimeoutError: (cause) =>
            Effect.fail(new MinimaxQuotaReadError({ stage: "request", cause })),
        }),
      );
    const status = yield* decodeApiStatus(json).pipe(
      Effect.mapError((cause) => new MinimaxQuotaReadError({ stage: "decode", cause })),
    );
    if (status.base_resp && status.base_resp.status_code !== 0) {
      return yield* new MinimaxQuotaReadError({
        stage: "api",
        apiCode: status.base_resp.status_code,
      });
    }
    const response = yield* decodeQuotaResponse(json).pipe(
      Effect.mapError((cause) => new MinimaxQuotaReadError({ stage: "decode", cause })),
    );
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
      return yield* new MinimaxQuotaReadError({ stage: "quota" });
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
