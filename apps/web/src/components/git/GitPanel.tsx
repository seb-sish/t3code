import { useAtomValue } from "@effect/atom-react";
import type { ProjectId, ScmFile, ScmMutationInput, ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import {
  Check,
  ChevronDown,
  ChevronRight,
  File,
  GitBranch,
  GitCommitHorizontal,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";

import { scmEnvironment } from "../../state/scm";
import { serverEnvironment } from "../../state/server";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "../../lib/utils";
import { scmMessageKey, scmSelectionKey, useGitPanelStore } from "./gitPanelStore";
import { GitHistory } from "./GitHistory";
import { GitRepositoryList, GitSection } from "./GitRepositoryList";

export function GitPanel({
  threadRef,
  projectId,
  projectName,
  visible,
  onOpenDiff,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly projectId: ProjectId | null;
  readonly projectName: string | null;
  readonly visible: boolean;
  readonly onOpenDiff?: (() => void) | undefined;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  if (projectId === null)
    return <p className="p-4 text-sm text-muted-foreground">Выберите проект для работы с Git.</p>;
  if (config?.scm !== true)
    return (
      <div className="p-4 text-sm">
        <p>Git-панель недоступна</p>
        <p className="mt-2 text-muted-foreground">
          {config === null
            ? "Подключение к окружению…"
            : "Обновите сервер этого окружения, чтобы использовать Git-панель."}
        </p>
      </div>
    );
  return (
    <GitPanelContents
      key={`${threadRef.environmentId}:${projectId}`}
      threadRef={threadRef}
      projectId={projectId}
      projectName={projectName}
      visible={visible}
      onOpenDiff={onOpenDiff}
    />
  );
}

function GitPanelContents({
  threadRef,
  projectId,
  projectName,
  visible,
  onOpenDiff,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly projectId: ProjectId;
  readonly projectName: string | null;
  readonly visible: boolean;
  readonly onOpenDiff?: (() => void) | undefined;
}) {
  const [repositoriesOpen, setRepositoriesOpen] = useState(true);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [workingOpen, setWorkingOpen] = useState(true);
  const [conflictsOpen, setConflictsOpen] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const discovery = useEnvironmentQuery(
    visible
      ? scmEnvironment.discovery({
          environmentId: threadRef.environmentId,
          input: { projectId, threadId: threadRef.threadId },
        })
      : null,
  );
  const selectionKey = scmSelectionKey(threadRef.environmentId, projectId);
  const storedPath = useGitPanelStore((state) => state.selected[selectionKey]);
  const select = useGitPanelStore((state) => state.select);
  const repositories = discovery.data?.repositories ?? [];
  const repositoryPath =
    storedPath ??
    repositories.find((repo) => repo.activeWorktree)?.rootPath ??
    repositories[0]?.rootPath ??
    null;
  const target =
    repositoryPath === null
      ? null
      : {
          environmentId: threadRef.environmentId,
          input: { projectId, repositoryPath, threadId: threadRef.threadId },
        };
  const status = useEnvironmentQuery(
    visible ? (target === null ? null : scmEnvironment.status(target)) : null,
  );
  const command = useAtomCommand(scmEnvironment.mutate, { reportFailure: false });
  const allowed = useAtomValue(scmEnvironment.mutate.permissionAtom(threadRef.environmentId));
  const messageKey =
    repositoryPath === null ? "" : scmMessageKey(threadRef.environmentId, repositoryPath);
  const message = useGitPanelStore((state) => state.messages[messageKey] ?? "");
  const setMessage = useGitPanelStore((state) => state.setMessage);
  const openDiff = useGitPanelStore((state) => state.openDiff);
  const files = status.data?.files ?? [];
  const staged = files.filter((file) => !file.conflict && file.indexStatus !== ".");
  const working = files.filter((file) => !file.conflict && file.worktreeStatus !== ".");
  const conflicts = files.filter((file) => file.conflict);

  // Rescan while the visible panel is idle so newly created repositories appear without restarting.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A visible panel owns one cancellable discovery refresh timer.
  useEffect(() => {
    if (
      !visible ||
      discovery.dataUpdatedAt === 0 ||
      discovery.data?.scanning !== false ||
      discovery.isPending
    )
      return;
    const timer = window.setTimeout(discovery.refresh, 30_000);
    return () => window.clearTimeout(timer);
  }, [
    visible,
    discovery.dataUpdatedAt,
    discovery.data?.scanning,
    discovery.isPending,
    discovery.refresh,
  ]);

  const refresh = () => {
    discovery.refresh();
    status.refresh();
  };
  const mutate = async (action: ScmMutationInput["action"], file?: ScmFile) => {
    if (pending || !allowed || target === null || status.data === null) return;
    const capturedMessageKey = messageKey;
    const capturedMessage = message;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await command({
        ...target,
        input: {
          ...target.input,
          action,
          expectedRevision: status.data.revision,
          ...(file ? { path: file.path } : {}),
          ...(action === "commit" ? { message } : {}),
        },
      });
      if (AsyncResult.isSuccess(result)) {
        if (
          action === "commit" &&
          useGitPanelStore.getState().messages[capturedMessageKey] === capturedMessage
        )
          setMessage(capturedMessageKey, "");
        setNotice(
          action === "commit"
            ? "Коммит создан. Неподготовленные изменения сохранены."
            : action === "fetch"
              ? "Данные удалённого репозитория обновлены."
              : action === "pull"
                ? "Pull завершён."
                : action === "push"
                  ? "Push завершён."
                  : null,
        );
      } else if (AsyncResult.isFailure(result)) setError(formatEnvironmentQueryError(result.cause));
      refresh();
    } catch {
      setError("Не удалось выполнить Git-операцию. Обновите статус и повторите.");
      refresh();
    }
    setPending(false);
  };
  const showFile = (file: ScmFile, side: "index" | "working") => {
    if (target !== null) {
      openDiff(threadRef, { ...target.input, path: file.path, side });
      onOpenDiff?.();
    }
  };
  const fileRows = (group: readonly ScmFile[], side: "index" | "working") =>
    group.map((file) => {
      const separator = file.path.lastIndexOf("/");
      const name = file.path.slice(separator + 1);
      const folder = separator < 0 ? "" : file.path.slice(0, separator);
      const letter = file.conflict
        ? "UU"
        : side === "index"
          ? file.indexStatus
          : file.worktreeStatus;
      return (
        <div
          key={file.path}
          className="group flex h-7 min-w-0 items-center gap-1 px-2 pl-5 hover:bg-accent/50"
        >
          <button
            type="button"
            onClick={() => showFile(file, side)}
            aria-description={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-xs focus-visible:outline-1 focus-visible:outline-ring"
          >
            <File className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{name}</span>
            <span className="min-w-0 truncate text-2xs text-muted-foreground">{folder}</span>
          </button>
          {!file.conflict ? (
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!allowed || pending}
              aria-label={`${side === "index" ? "Снять с подготовки" : "Подготовить"} ${file.path}`}
              aria-description={side === "index" ? "Снять с подготовки" : "Подготовить файл"}
              onClick={() => void mutate(side === "index" ? "unstage" : "stage", file)}
            >
              {side === "index" ? <Minus /> : <Plus />}
            </Button>
          ) : null}
          <span
            className={cn(
              "w-4 shrink-0 text-center text-2xs",
              file.conflict
                ? "text-destructive"
                : letter === "U" || letter === "A"
                  ? "text-success"
                  : "text-muted-foreground",
            )}
            aria-description={
              file.conflict
                ? "Неразрешённый конфликт"
                : side === "index"
                  ? "Подготовлено к коммиту"
                  : "Изменение рабочей копии"
            }
          >
            {letter}
          </span>
        </div>
      );
    });

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-xs" data-git-panel>
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <span>Система контроля версий</span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Обновить Git"
          aria-description="Обновить репозитории"
          onClick={refresh}
          disabled={pending}
        >
          <RefreshCw />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <GitSection
          title="Репозитории"
          count={repositories.length}
          open={repositoriesOpen}
          onToggle={() => setRepositoriesOpen(!repositoriesOpen)}
        >
          <div className="flex h-7 items-center gap-1.5 px-3 text-xs">
            <ChevronDown className="size-3.5" />
            <GitBranch className="size-3.5" />
            <span className="truncate">{projectName ?? "Проект"}</span>
          </div>
          <GitRepositoryList
            repositories={repositories}
            selectedPath={repositoryPath}
            onSelect={(value) => {
              if (!pending) {
                select(selectionKey, value);
                setError(null);
                setNotice(null);
              }
            }}
          />
          {discovery.isPending || discovery.data?.scanning ? (
            <p className="px-4 py-2 text-muted-foreground" role="status">
              Поиск вложенных репозиториев…
            </p>
          ) : null}
          {discovery.error ? (
            <p role="alert" className="px-4 py-2 text-destructive">
              {discovery.error}
            </p>
          ) : null}
          {discovery.data?.errors.map((entry) => (
            <p key={entry.path} className="px-4 py-1 text-muted-foreground">
              {entry.path || "."}: {entry.message}
            </p>
          ))}
        </GitSection>
        {repositoryPath !== null ? (
          <>
            <div className="mt-1 flex h-7 items-center gap-1 border-y border-border/50 bg-muted/30 px-2 font-medium">
              <ChevronDown className="size-3.5" />
              Изменения
              <span
                className="ml-auto min-w-0 truncate pl-2 text-2xs font-normal text-muted-foreground"
                aria-description={repositoryPath}
              >
                {repositoryPath.split(/[\\/]/).at(-1)}
              </span>
            </div>
            <div className="space-y-2 px-3 py-2">
              <Textarea
                value={message}
                rows={2}
                disabled={pending || !allowed}
                placeholder="Сообщение (Ctrl+Enter для коммита)"
                aria-label="Сообщение коммита"
                onChange={(event) => setMessage(messageKey, event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                    event.preventDefault();
                    if (staged.length && message.trim() && !conflicts.length) void mutate("commit");
                  }
                }}
              />
              <div className="flex">
                <Button
                  size="sm"
                  className="w-full"
                  disabled={
                    pending ||
                    !allowed ||
                    status.isPending ||
                    !staged.length ||
                    !message.trim() ||
                    conflicts.length > 0
                  }
                  onClick={() => void mutate("commit")}
                >
                  <Check />
                  {pending ? "Выполняется…" : "Коммит"}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-1 text-2xs text-muted-foreground">
                <GitBranch className="size-3" />
                <span className="mr-auto">
                  {status.data?.branch ??
                    (status.data?.head ? status.data.head.slice(0, 8) : "HEAD")}
                </span>
                <span aria-description="Входящие и исходящие коммиты">
                  {status.data?.behind ?? 0}↓ {status.data?.ahead ?? 0}↑
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={pending || !allowed || !status.data?.hasRemote}
                  onClick={() => void mutate("fetch")}
                >
                  Fetch
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={pending || !allowed || !status.data?.upstream}
                  onClick={() => void mutate("pull")}
                >
                  Pull
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={pending || !allowed || !status.data?.upstream || !status.data?.branch}
                  onClick={() => void mutate("push")}
                >
                  Push
                </Button>
              </div>
              {!allowed ? (
                <p className="text-muted-foreground">
                  В этом подключении Git доступен только для чтения.
                </p>
              ) : null}
              {status.data && !status.data.hasRemote ? (
                <p className="text-muted-foreground">Remote не настроен. Fetch недоступен.</p>
              ) : null}
              {status.data && !status.data.upstream ? (
                <p className="text-muted-foreground">
                  Upstream не настроен. Pull и Push недоступны.
                </p>
              ) : null}
              {error || status.error ? (
                <p role="alert" className="whitespace-pre-wrap text-destructive">
                  {error ?? status.error}
                </p>
              ) : null}
              {notice ? (
                <p role="status" className="text-muted-foreground">
                  {notice}
                </p>
              ) : null}
            </div>
            <GitSection
              title="Подготовленные изменения"
              count={staged.length}
              open={stagedOpen}
              onToggle={() => setStagedOpen(!stagedOpen)}
            >
              {fileRows(staged, "index")}
            </GitSection>
            <GitSection
              title="Изменения"
              count={working.length}
              open={workingOpen}
              onToggle={() => setWorkingOpen(!workingOpen)}
            >
              {fileRows(working, "working")}
            </GitSection>
            {conflicts.length ? (
              <GitSection
                title="Конфликты слияния"
                count={conflicts.length}
                open={conflictsOpen}
                onToggle={() => setConflictsOpen(!conflictsOpen)}
              >
                {fileRows(conflicts, "working")}
              </GitSection>
            ) : null}
            {status.data && !files.length ? (
              <p className="px-5 py-3 text-muted-foreground">Рабочая копия чистая.</p>
            ) : null}
            {target ? (
              <GitHistory
                key={repositoryPath}
                target={target.input}
                threadRef={threadRef}
                visible={visible}
              />
            ) : null}
          </>
        ) : null}
      </ScrollArea>
      <div className="flex min-h-7 shrink-0 items-center gap-1 border-t border-border/50 px-3 text-2xs text-muted-foreground">
        <GitCommitHorizontal className="size-3" />
        {discovery.data?.scanning ? "Обнаружение репозиториев" : "Git выбранного окружения"}
        <ChevronRight className="ml-auto size-3" />
      </div>
    </div>
  );
}
