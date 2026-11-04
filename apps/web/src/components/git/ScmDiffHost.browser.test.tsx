import { EnvironmentId, ProjectId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { ScmChatContent, ScmDiffHost } from "./ScmDiffHost";
import { useGitPanelStore } from "./gitPanelStore";

vi.mock("./ScmFileDiff", () => ({
  ScmFileDiff: ({ threadRef }: { threadRef: ScopedThreadRef }) => (
    <button onClick={() => useGitPanelStore.getState().closeDiff(threadRef)}>Close diff</button>
  ),
}));

it("keeps Tab on visible content and restores the mounted chat draft and focus", async () => {
  useGitPanelStore.setState({ diffs: {} });
  const threadRef = {
    environmentId: EnvironmentId.make("scm-focus"),
    threadId: ThreadId.make("thread:focus"),
  };
  await using screen = await render(
    <div>
      <ScmDiffHost threadRef={threadRef} />
      <ScmChatContent threadRef={threadRef}>
        <textarea aria-label="Chat draft" defaultValue="draft kept" />
        <button>Send chat</button>
      </ScmChatContent>
      <button>Visible outside</button>
    </div>,
    // The focus boundary has no routing behavior.
    { router: false },
  );
  await userEvent.click(screen.getByRole("textbox", { name: "Chat draft" }));
  await act(() =>
    useGitPanelStore.getState().openDiff(threadRef, {
      projectId: ProjectId.make("project:focus"),
      repositoryPath: "/project",
      path: "file.txt",
      side: "working",
    }),
  );
  await expect.element(screen.getByRole("region", { name: "Изменения Git" })).toHaveFocus();
  await expect.element(screen.getByRole("button", { name: "Close diff" })).toBeVisible();
  await userEvent.tab();
  await expect.element(screen.getByRole("button", { name: "Close diff" })).toHaveFocus();
  await userEvent.tab();
  await expect.element(screen.getByRole("button", { name: "Visible outside" })).toHaveFocus();
  await userEvent.click(screen.getByRole("button", { name: "Close diff" }));
  await expect.element(screen.getByRole("textbox", { name: "Chat draft" })).toHaveFocus();
  await expect
    .element(screen.getByRole("textbox", { name: "Chat draft" }))
    .toHaveValue("draft kept");
});
