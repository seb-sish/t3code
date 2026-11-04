import type { ScmDiscoverySnapshot } from "@t3tools/contracts";
import { ChevronDown, FolderGit2, GitBranch } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

export function GitRepositoryList({
  repositories,
  selectedPath,
  onSelect,
}: {
  readonly repositories: ScmDiscoverySnapshot["repositories"];
  readonly selectedPath: string | null;
  readonly onSelect: (path: string) => void;
}) {
  return (
    <div role="group" aria-label="Репозитории проекта">
      {repositories.map((repository) => (
        <button
          key={repository.rootPath}
          type="button"
          onClick={() => onSelect(repository.rootPath)}
          aria-pressed={repository.rootPath === selectedPath}
          aria-description={repository.error ?? repository.rootPath}
          className={cn(
            "flex h-7 w-full min-w-0 items-center gap-1.5 border-l-2 px-3 text-left text-xs hover:bg-accent/50 focus-visible:outline-1 focus-visible:outline-ring",
            repository.rootPath === selectedPath
              ? "border-l-primary bg-primary/10"
              : "border-l-transparent",
          )}
        >
          <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {repository.activeWorktree
              ? "Worktree треда"
              : repository.relativePath || "Корневой репозиторий"}
          </span>
          <span className="flex max-w-28 shrink-0 items-center gap-1 truncate text-muted-foreground">
            <GitBranch className="size-3" />
            {repository.branch ?? "HEAD"}
          </span>
          {repository.error ? (
            <span className="text-destructive">!</span>
          ) : repository.changedFiles > 0 ? (
            <span className="min-w-4 text-right text-muted-foreground">
              {repository.changedFiles}
            </span>
          ) : null}
        </button>
      ))}
      {repositories.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">Репозитории ещё не обнаружены.</p>
      ) : null}
    </div>
  );
}

export function GitSection({
  title,
  count,
  children,
  open,
  onToggle,
}: {
  readonly title: string;
  readonly count?: number;
  readonly children: ReactNode;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-7 w-full items-center gap-1 border-y border-border/50 bg-muted/30 px-2 text-left text-xs font-medium hover:bg-accent/50"
      >
        <ChevronDown className={cn("size-3.5", !open && "-rotate-90")} />
        {title}
        {count !== undefined ? (
          <span className="ml-auto rounded-full bg-muted px-1.5 text-2xs tabular-nums">
            {count}
          </span>
        ) : null}
      </button>
      {open ? children : null}
    </section>
  );
}
