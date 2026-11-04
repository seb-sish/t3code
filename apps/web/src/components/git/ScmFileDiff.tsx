import { useAtomValue } from "@effect/atom-react";
import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import type { CodeViewDiffItem } from "@pierre/diffs";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { FileDiff, MessagesSquare, X } from "lucide-react";
import { useState } from "react";

import { useTheme } from "../../hooks/useTheme";
import { buildFileDiffContentVersion, resolveDiffThemeName } from "../../lib/diffRendering";
import { scmEnvironment } from "../../state/scm";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { StyledDiffCodeView } from "../diffs/StyledDiffCodeView";
import { useGitPanelStore } from "./gitPanelStore";
import { serverEnvironment } from "../../state/server";
import { useRightPanelStore } from "../../rightPanelStore";

export function ScmFileDiff({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const selection = useGitPanelStore((state) => state.diffs[scopedThreadKey(threadRef)]);
  if (selection === undefined) return null;
  return <ScmFileDiffContent threadRef={threadRef} />;
}

function ScmFileDiffContent({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const selection = useGitPanelStore((state) => state.diffs[scopedThreadKey(threadRef)]);
  const close = useGitPanelStore((state) => state.closeDiff);
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  const result = useEnvironmentQuery(
    selection && config?.scm
      ? scmEnvironment.diff({ environmentId: threadRef.environmentId, input: selection })
      : null,
  );
  const { resolvedTheme } = useTheme();
  const [split, setSplit] = useState(false);
  const parsed = (() => {
    if (!result.data?.patch || result.data.binary) return { items: [], error: null };
    try {
      const items: CodeViewDiffItem[] = parsePatchFiles(result.data.patch).flatMap((patch) =>
        patch.files.map((fileDiff, index) => ({
          type: "diff",
          id: `${index}:${fileDiff.name}`,
          fileDiff,
          version: buildFileDiffContentVersion(fileDiff),
        })),
      );
      return { items, error: null };
    } catch {
      return {
        items: [],
        error: "Не удалось отобразить diff. Обновите состояние Git и откройте файл снова.",
      };
    }
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background" data-scm-diff>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 text-xs">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            close(threadRef);
            useRightPanelStore.getState().show(threadRef);
          }}
        >
          Git
        </Button>
        <Button variant="ghost" size="sm" onClick={() => close(threadRef)}>
          <MessagesSquare />
          Чат
        </Button>
        <span className="flex min-w-0 items-center gap-1 border-t border-t-primary px-2">
          <FileDiff className="size-3.5" />
          <span className="truncate">{selection?.path.split("/").at(-1)}</span>
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Закрыть diff и вернуться в чат"
          onClick={() => close(threadRef)}
        >
          <X />
        </Button>
        <div className="ml-auto pr-2">
          <Button size="xs" variant="ghost" aria-pressed={split} onClick={() => setSplit(!split)}>
            {split ? "Единый diff" : "Сравнить рядом"}
          </Button>
        </div>
      </div>
      <div className="flex shrink-0 gap-2 border-b border-border/50 px-3 py-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" aria-description={selection?.repositoryPath}>
          {selection?.repositoryPath}
        </span>
        <span>{selection?.side === "index" ? "HEAD → индекс" : "Индекс → рабочая копия"}</span>
      </div>
      {result.isPending && !result.data ? (
        <p className="p-4 text-sm text-muted-foreground" role="status">
          Загрузка изменений…
        </p>
      ) : null}
      {result.error || parsed.error ? (
        <div role="alert" className="p-4 text-sm text-destructive">
          {result.error ?? parsed.error}
          <Button size="xs" variant="ghost" onClick={result.refresh}>
            Обновить
          </Button>
        </div>
      ) : null}
      {config && !config.scm ? (
        <p className="p-4 text-sm text-muted-foreground">
          Обновите сервер этого окружения для просмотра Git diff.
        </p>
      ) : null}
      {result.data?.truncated ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Diff слишком большой. Показана только доступная часть.
        </p>
      ) : null}
      {result.data?.binary ? (
        <p className="p-4 text-sm text-muted-foreground">
          Бинарный файл изменён. Текстовое сравнение недоступно.
        </p>
      ) : null}
      {result.data && !result.data.binary && !result.data.patch ? (
        <p className="p-4 text-sm text-muted-foreground">
          На выбранной стороне больше нет изменений.
        </p>
      ) : null}
      {parsed.items.length ? (
        <StyledDiffCodeView
          className="min-h-0 flex-1"
          items={parsed.items}
          options={{
            theme: resolveDiffThemeName(resolvedTheme),
            themeType: resolvedTheme,
            diffStyle: split ? "split" : "unified",
          }}
        />
      ) : null}
    </div>
  );
}
