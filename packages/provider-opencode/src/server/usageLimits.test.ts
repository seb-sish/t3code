import * as NodeSqlite from "node:sqlite";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { assert } from "vite-plus/test";

import { readOpenCodeGoUsageLimits } from "./usageLimits.ts";

it.effect(
  "reads selected Console OAuth Go limits in the selected workspace without changing credentials",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dataHome = yield* fs.makeTempDirectoryScoped();
      yield* fs.makeDirectory(`${dataHome}/opencode`);
      const databasePath = `${dataHome}/opencode/opencode.db`;
      const database = yield* Effect.acquireRelease(
        Effect.sync(() => new NodeSqlite.DatabaseSync(databasePath)),
        (database) => Effect.sync(() => database.close()),
      );
      database.exec(
        "CREATE TABLE credential (id text PRIMARY KEY, integration_id text, value text, active integer, time_created integer)",
      );
      const insert = database.prepare("INSERT INTO credential VALUES (?, 'opencode', ?, ?, ?)");
      insert.run("inactive", JSON.stringify({ type: "key", key: "old-key" }), 0, 2);
      const selected = {
        type: "oauth",
        access: "console-access",
        refresh: "console-refresh",
        expires: 2_000_000_000_000,
        metadata: { server: "https://opencode.ai/console", orgID: "workspace-a" },
      };
      insert.run("selected", JSON.stringify(selected), 1, 1);
      const fingerprints = [];
      for (const orgID of ["workspace-a", "workspace-b"]) {
        database
          .prepare("UPDATE credential SET value = ? WHERE id = 'selected'")
          .run(JSON.stringify({ ...selected, metadata: { ...selected.metadata, orgID } }));
        const snapshot = yield* fs.readFile(databasePath);
        const limits = yield* readOpenCodeGoUsageLimits({
          enabled: true,
          serverUrl: "",
          environment: { XDG_DATA_HOME: dataHome },
        }).pipe(
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make((request) => {
              assert.equal(request.url, "https://opencode.ai/zen/go/v1/usage");
              assert.equal(request.headers.authorization, "Bearer console-access");
              assert.equal(request.headers["x-opencode-org-id"], orgID);
              const window = { percent: 12, resetsAt: "2026-12-01T00:00:00.000Z" };
              return Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  Response.json({
                    usage: { rolling: window, weekly: window, monthly: window },
                  }),
                ),
              );
            }),
          ),
        );
        assert.isUndefined(limits.unavailable);
        assert.deepEqual(
          limits.windows.map((window) => window.usedPercent),
          [12, 12, 12],
        );
        fingerprints.push(limits.credentialFingerprint);
        assert.deepEqual(yield* fs.readFile(databasePath), snapshot);
      }
      assert.notEqual(fingerprints[0], fingerprints[1]);
      // An expired/rejected workspace must not fall back to an unrelated legacy Go key.
      yield* fs.writeFileString(
        `${dataHome}/opencode/auth.json`,
        JSON.stringify({
          "opencode-go": { type: "api", key: "legacy-go-key" },
        }),
      );
      for (const status of [401, 403, 500]) {
        let requests = 0;
        const snapshot = yield* fs.readFile(databasePath);
        const limits = yield* readOpenCodeGoUsageLimits({
          enabled: true,
          serverUrl: "",
          environment: { XDG_DATA_HOME: dataHome },
        }).pipe(
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make((request) => {
              requests += 1;
              assert.equal(request.method, "GET");
              assert.equal(request.headers.authorization, "Bearer console-access");
              assert.equal(request.headers["x-opencode-org-id"], "workspace-b");
              return Effect.succeed(
                HttpClientResponse.fromWeb(request, Response.json({}, { status })),
              );
            }),
          ),
        );
        assert.equal(requests, 1);
        assert.equal(limits.unavailable?.reason, status === 403 ? "unsupported" : "probeFailed");
        assert.deepEqual(yield* fs.readFile(databasePath), snapshot);
      }
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);
