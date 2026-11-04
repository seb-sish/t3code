import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { lazy, Suspense, useLayoutEffect, useRef, type ReactNode } from "react";

import { useGitPanelStore } from "./gitPanelStore";

const ScmFileDiff = lazy(() =>
  import("./ScmFileDiff").then((module) => ({ default: module.ScmFileDiff })),
);

export function ScmDiffHost({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const selection = useGitPanelStore((state) => state.diffs[scopedThreadKey(threadRef)]);
  if (selection === undefined) return null;
  return <ActiveScmDiff key={scopedThreadKey(threadRef)} threadRef={threadRef} />;
}

export function ScmChatContent({
  threadRef,
  children,
  className,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const diffOpen = useGitPanelStore(
    (state) => threadRef !== null && state.diffs[scopedThreadKey(threadRef)] !== undefined,
  );
  return (
    <div className={className ?? "contents"} inert={diffOpen} aria-hidden={diffOpen || undefined}>
      {children}
    </div>
  );
}

function ActiveScmDiff({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const ref = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Sync DOM focus with the mounted diff surface and restore it when the chat becomes interactive again.
  useLayoutEffect(() => {
    const surface = ref.current;
    const previous = document.activeElement;
    surface?.focus();
    return () => {
      if (!surface?.contains(document.activeElement)) return;
      queueMicrotask(() => {
        if (previous instanceof HTMLElement && previous.isConnected && !previous.closest("[inert]"))
          previous.focus();
      });
    };
  }, []);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="region"
      aria-label="Изменения Git"
      className="absolute inset-x-0 bottom-0 top-[var(--workspace-topbar-height)] z-20 flex flex-col bg-background outline-none"
    >
      <Suspense
        fallback={
          <div className="p-4 text-sm text-muted-foreground" role="status">
            Загрузка diff…
          </div>
        }
      >
        <ScmFileDiff threadRef={threadRef} />
      </Suspense>
    </div>
  );
}
