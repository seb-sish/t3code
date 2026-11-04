import type { EnvironmentId, ProjectId, ScmDiffInput, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

export const scmSelectionKey = (environmentId: EnvironmentId, projectId: ProjectId) =>
  `${environmentId.length}:${environmentId}${projectId}`;
export const scmMessageKey = (environmentId: EnvironmentId, repositoryPath: string) =>
  `${environmentId.length}:${environmentId}${repositoryPath}`;

interface GitPanelState {
  selected: Record<string, string>;
  messages: Record<string, string>;
  diffs: Record<string, ScmDiffInput>;
  select: (key: string, repositoryPath: string) => void;
  setMessage: (key: string, message: string) => void;
  openDiff: (thread: ScopedThreadRef, input: ScmDiffInput) => void;
  closeDiff: (thread: ScopedThreadRef) => void;
}

export const useGitPanelStore = create<GitPanelState>()(
  persist(
    (set) => ({
      selected: {},
      messages: {},
      diffs: {},
      select: (key, repositoryPath) =>
        set((state) => ({ selected: { ...state.selected, [key]: repositoryPath } })),
      setMessage: (key, message) =>
        set((state) => ({ messages: { ...state.messages, [key]: message } })),
      openDiff: (thread, input) =>
        set((state) => ({ diffs: { ...state.diffs, [scopedThreadKey(thread)]: input } })),
      closeDiff: (thread) =>
        set((state) => {
          const diffs = { ...state.diffs };
          delete diffs[scopedThreadKey(thread)];
          return { diffs };
        }),
    }),
    {
      name: "t3code:git-panel",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ selected: state.selected, messages: state.messages }),
    },
  ),
);
