import { useAtomValue } from "@effect/atom-react";
import type { ScmRepositoryTarget, ScopedThreadRef } from "@t3tools/contracts";
import { GitBranch, Cloud, Check } from "lucide-react";
import { useState } from "react";

import { scmEnvironment } from "../../state/scm";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { GitSection } from "./GitRepositoryList";
import { commitGraph } from "./commitGraph";

const colors = [
  "var(--color-primary)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-info)",
  "var(--color-destructive)",
];
const colorFor = (index: number) => colors[index % colors.length];

export function GitHistory({
  target,
  threadRef,
  visible,
}: {
  readonly target: ScmRepositoryTarget;
  readonly threadRef: ScopedThreadRef;
  readonly visible: boolean;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [ref, setRef] = useState<string | undefined>();
  const [limit, setLimit] = useState(100);
  const history = useEnvironmentQuery(
    visible && config?.scmHistory && (branchesOpen || graphOpen)
      ? scmEnvironment.history({
          environmentId: threadRef.environmentId,
          input: { ...target, ...(ref === undefined ? {} : { ref }), limit },
        })
      : null,
  );
  const branches = history.data?.branches ?? [];
  const commits = history.data?.commits ?? [];
  const rows = commitGraph(commits);
  const width = Math.max(1, ...rows.map((row) => row.width)) * 12 + 8;
  if (!config?.scmHistory)
    return (
      <p className="px-4 py-2 text-muted-foreground">
        Обновите сервер для просмотра графа и веток.
      </p>
    );
  return (
    <>
      <GitSection
        title="Ветки"
        count={branches.length}
        open={branchesOpen}
        onToggle={() => setBranchesOpen(!branchesOpen)}
      >
        <div className="px-3 py-2">
          <Input
            aria-label="Поиск веток"
            placeholder="Найти ветку…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button
          type="button"
          aria-pressed={ref === undefined}
          className="flex h-7 w-full items-center gap-1.5 px-3 text-left text-xs hover:bg-accent/50 focus-visible:outline-1 focus-visible:outline-ring"
          onClick={() => {
            setRef(undefined);
            setLimit(100);
          }}
        >
          <GitBranch className="size-3.5" />
          Текущая ветка / HEAD
        </button>
        {[false, true].map((remote) => {
          const matching = branches.filter(
            (branch) =>
              branch.remote === remote && branch.name.toLowerCase().includes(search.toLowerCase()),
          );
          return (
            <div key={String(remote)}>
              <p className="px-3 py-1 text-2xs text-muted-foreground">
                {remote ? "Удалённые ветки" : "Локальные ветки"} · {matching.length}
              </p>
              {matching.map((branch) => (
                <button
                  type="button"
                  key={branch.ref}
                  aria-pressed={ref === branch.ref}
                  aria-label={`Показать историю ${branch.name}`}
                  className="flex w-full min-w-0 flex-col px-3 py-1 text-left hover:bg-accent/50 focus-visible:outline-1 focus-visible:outline-ring"
                  onClick={() => {
                    setRef(branch.ref);
                    setLimit(100);
                    setGraphOpen(true);
                  }}
                >
                  <span className="flex w-full min-w-0 items-center gap-1.5 text-xs">
                    {remote ? (
                      <Cloud className="size-3.5 shrink-0" />
                    ) : (
                      <GitBranch className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate">{branch.name}</span>
                    {branch.current ? (
                      <Check className="size-3 text-primary" aria-label="Текущая ветка" />
                    ) : null}
                  </span>
                  <span className="w-full truncate pl-5 text-2xs text-muted-foreground">
                    {branch.hash.slice(0, 7)} · {branch.subject}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
        <p className="px-3 py-2 text-2xs text-muted-foreground">
          Выбор меняет только граф. Удалённые ветки обновляются через Fetch.
        </p>
      </GitSection>
      <GitSection
        title="Граф"
        count={commits.length}
        open={graphOpen}
        onToggle={() => setGraphOpen(!graphOpen)}
      >
        <div className="flex items-center gap-1 px-3 py-2 text-xs">
          <GitBranch className="size-3.5 shrink-0" />
          <span className="truncate">
            {ref?.replace(/^refs\/(heads|remotes)\//, "") ?? "Текущая ветка / HEAD"}
          </span>
          <div className="ml-auto">
            <Button variant="ghost" size="xs" onClick={history.refresh}>
              Обновить
            </Button>
          </div>
        </div>
        {history.isPending && !history.data ? (
          <p role="status" className="px-3 py-2">
            Загрузка истории…
          </p>
        ) : null}
        {history.error ? (
          <p role="alert" className="px-3 py-2 text-destructive">
            {history.error}
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setRef(undefined);
                history.refresh();
              }}
            >
              Текущая ветка
            </Button>
          </p>
        ) : null}
        <div className="overflow-x-auto" role="list" aria-label="История коммитов">
          {commits.map((commit, index) => {
            const row = rows[index]!;
            return (
              <div
                key={commit.hash}
                role="listitem"
                className="flex h-7 min-w-0 items-center pr-3 text-xs hover:bg-accent/40"
              >
                <svg width={width} height={28} className="shrink-0" aria-hidden="true">
                  {index > 0
                    ? rows[index - 1]!.edges.map((edge) => (
                        <line
                          key={`top-${edge.from}-${edge.to}`}
                          x1={edge.to * 12 + 10}
                          x2={edge.to * 12 + 10}
                          y1={0}
                          y2={14}
                          stroke={colorFor(edge.color)}
                          strokeWidth={1.5}
                        />
                      ))
                    : null}
                  {row.edges.map((edge) => (
                    <path
                      key={`${edge.from}-${edge.to}`}
                      d={`M ${edge.from * 12 + 10} 14 C ${edge.from * 12 + 10} 23, ${edge.to * 12 + 10} 19, ${edge.to * 12 + 10} 28`}
                      fill="none"
                      stroke={colorFor(edge.color)}
                      strokeWidth={1.5}
                    />
                  ))}
                  <circle
                    cx={row.lane * 12 + 10}
                    cy={14}
                    r={commit.parents.length > 1 ? 4 : 3}
                    fill="var(--color-background)"
                    stroke={colorFor(row.color)}
                    strokeWidth={2}
                  />
                </svg>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        tabIndex={0}
                        className="min-w-0 flex-1 truncate focus-visible:outline-1 focus-visible:outline-ring"
                      />
                    }
                  >
                    {commit.subject}
                  </TooltipTrigger>
                  <TooltipPopup>
                    <p>{commit.subject}</p>
                    <p>
                      {commit.author} · {commit.date}
                    </p>
                    <p>{commit.hash}</p>
                  </TooltipPopup>
                </Tooltip>
                <span className="ml-2 max-w-20 truncate text-2xs text-muted-foreground">
                  {commit.author}
                </span>
                {branches
                  .filter((branch) => branch.hash === commit.hash)
                  .map((branch) => (
                    <span
                      key={branch.ref}
                      className="ml-1 max-w-28 truncate rounded-sm bg-primary/10 px-1 text-2xs text-primary"
                    >
                      {branch.name}
                    </span>
                  ))}
                <span className="ml-2 text-2xs text-muted-foreground">
                  {commit.hash.slice(0, 7)}
                </span>
              </div>
            );
          })}
        </div>
        {history.data && commits.length === 0 ? (
          <p className="px-3 py-3 text-muted-foreground">Коммитов пока нет.</p>
        ) : null}
        {history.data?.hasMore ? (
          <div className="px-3 py-2">
            {limit < 1000 ? (
              <Button
                variant="ghost"
                size="xs"
                disabled={history.isPending}
                onClick={() => setLimit(Math.min(1000, limit + 100))}
              >
                Показать ещё 100
              </Button>
            ) : (
              <p className="text-2xs text-muted-foreground">
                Показаны первые 1000 коммитов выбранной ветки.
              </p>
            )}
          </div>
        ) : null}
      </GitSection>
    </>
  );
}
