import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { remainingPercent } from "@t3tools/shared/usageLimits";

import { usePrimarySettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { environmentPresentations } from "../../state/presentation";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { sidebarQuotaSummary } from "./SidebarQuotaSummary.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const LABELS: Record<string, string> = {
  codex: "Codex",
  antigravity: "Antigravity · Gemini",
  minimax: "MiniMax M Plan",
};

export function SidebarQuotaSummary() {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const now = Date.parse(`${useNowMinute()}:00Z`);
  const { accounts, notices } = sidebarQuotaSummary(presentations);
  if (accounts.length === 0 && notices.length === 0) return null;

  return (
    <section
      aria-label="Subscription quotas"
      className="max-h-64 overflow-y-auto border-t border-border/60 px-2 py-2 text-xs"
    >
      <Link
        to="/usage"
        className="mb-2 block font-medium text-muted-foreground hover:text-foreground"
      >
        Subscription quotas
      </Link>
      <div className="flex flex-col gap-3">
        {accounts.map((account) => (
          <div key={account.key} className="flex min-w-0 flex-col gap-1">
            <Tooltip>
              <TooltipTrigger render={<div className="truncate font-medium" tabIndex={0} />}>
                {LABELS[account.driver] ?? account.driver}
                {account.driver !== "minimax" && account.displayName
                  ? ` · ${account.displayName}`
                  : ""}
              </TooltipTrigger>
              <TooltipPopup>
                {account.sourceLabel ??
                  account.environments.map((environment) => environment.label).join(", ")}
              </TooltipPopup>
            </Tooltip>
            {account.limits.windows.length === 0 ? (
              <span className="text-muted-foreground">Gemini quotas unavailable</span>
            ) : (
              account.limits.windows.map((window) => {
                const remaining = remainingPercent(window);
                return (
                  <div key={window.id} className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-muted-foreground">{window.label}</span>
                      <span className="shrink-0 tabular-nums">{remaining}% left</span>
                    </div>
                    <div
                      role="meter"
                      aria-label={`${LABELS[account.driver]} · ${window.label}: quota remaining`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={remaining}
                      className="h-1 overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        className="h-full rounded-full bg-foreground/70"
                        style={{ width: `${remaining}%` }}
                      />
                    </div>
                    {window.resetsAt ? (
                      <span className="text-3xs text-muted-foreground">
                        Resets {formatUpcomingTimestamp(window.resetsAt, timestampFormat, now)}
                      </span>
                    ) : null}
                  </div>
                );
              })
            )}
            <span className="text-3xs text-muted-foreground">
              Updated {formatUpcomingTimestamp(account.limits.checkedAt, timestampFormat, now)}
            </span>
          </div>
        ))}
        {notices.map((notice) => (
          <p key={notice} className="text-muted-foreground">
            {notice}
          </p>
        ))}
      </div>
    </section>
  );
}
