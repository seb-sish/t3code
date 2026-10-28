import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageWindow,
  UsageLimitSourceId,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { sidebarQuotaSummary } from "./SidebarQuotaSummary.logic";

const checkedAt = "2026-10-28T10:00:00.000Z";
const window = { id: "five-hour", kind: "session", label: "5-hour", usedPercent: 25 } as const;

function provider(driver: string, windows: ServerProviderUsageWindow[] = [window]): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: { checkedAt, windows },
  };
}

it("shows native Codex, only Gemini quotas from Antigravity, and MiniMax sources", () => {
  const providers = [
    provider("codex"),
    provider("claudeAgent"),
    provider("antigravity", [
      { ...window, id: "gemini-5h" },
      { ...window, id: "gemini-weekly" },
      { ...window, id: "3p-5h" },
    ]),
  ];
  const result = sidebarQuotaSummary(
    new Map([
      [
        EnvironmentId.make("server"),
        {
          entry: { target: { label: "Server" } },
          serverConfig: {
            providers,
            usageLimitSources: [
              {
                id: UsageLimitSourceId.make("minimax"),
                kind: "minimax",
                label: "MiniMax M Plan",
                checkedAt,
                accounts: [
                  {
                    id: "key-fingerprint",
                    driver: ProviderDriverKind.make("minimax"),
                    plan: "M Plan",
                    usageLimits: { checkedAt, windows: [window] },
                  },
                ],
              },
              {
                id: UsageLimitSourceId.make("hub"),
                kind: "cliproxy",
                label: "Other hub",
                checkedAt,
                accounts: [],
                error: "Unrelated error",
              },
            ],
          },
        },
      ],
    ]),
  );
  expect(result.accounts.map((account) => account.driver)).toEqual([
    "codex",
    "antigravity",
    "minimax",
  ]);
  expect(result.accounts[1]?.limits.windows.map((entry) => entry.id)).toEqual([
    "gemini-5h",
    "gemini-weekly",
  ]);
  expect(result.notices).toEqual([]);
  expect(providers[2]?.usageLimits?.windows).toHaveLength(3);
});

it("retains MiniMax errors and tolerates disconnected environments", () => {
  const result = sidebarQuotaSummary(
    new Map([
      [
        EnvironmentId.make("offline"),
        { entry: { target: { label: "Offline" } }, serverConfig: null },
      ],
      [
        EnvironmentId.make("server"),
        {
          entry: { target: { label: "Server" } },
          serverConfig: {
            providers: [],
            usageLimitSources: [
              {
                id: UsageLimitSourceId.make("minimax"),
                kind: "minimax",
                label: "MiniMax M Plan",
                checkedAt,
                accounts: [],
                error: "Subscription Key required",
              },
            ],
          },
        },
      ],
    ]),
  );
  expect(result.accounts).toEqual([]);
  expect(result.notices).toEqual(["Server · MiniMax M Plan: Subscription Key required"]);
});
