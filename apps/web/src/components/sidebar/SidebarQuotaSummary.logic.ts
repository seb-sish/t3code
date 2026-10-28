import {
  collectLimitAccounts,
  collectLimitNotices,
  type LimitPresentations,
} from "@t3tools/shared/usageLimits";

export function sidebarQuotaSummary(presentations: LimitPresentations) {
  const selected: LimitPresentations = new Map(
    [...presentations].map(([id, presentation]) => [
      id,
      {
        ...presentation,
        serverConfig: presentation.serverConfig
          ? {
              ...presentation.serverConfig,
              providers: presentation.serverConfig.providers.filter(
                (provider) => provider.driver === "codex" || provider.driver === "antigravity",
              ),
              usageLimitSources: presentation.serverConfig.usageLimitSources?.filter(
                (source) => source.kind === "minimax",
              ),
            }
          : null,
      },
    ]),
  );
  return {
    accounts: collectLimitAccounts(selected).map((account) =>
      account.driver === "antigravity"
        ? {
            ...account,
            limits: {
              ...account.limits,
              windows: account.limits.windows.filter((window) => window.id.startsWith("gemini-")),
            },
          }
        : account,
    ),
    notices: collectLimitNotices(selected),
  };
}
