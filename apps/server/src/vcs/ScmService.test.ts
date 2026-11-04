import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { IsoDateTime, ProjectId, ThreadId } from "@t3tools/contracts";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as ScmService from "./ScmService.ts";
import * as VcsStatusBroadcaster from "./VcsStatusBroadcaster.ts";

const runtime = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-scm-test-config-" })),
  Layer.provideMerge(Layer.merge(NodeServices.layer, NodeCrypto.layer)),
);

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const driver = yield* GitVcsDriver.GitVcsDriver;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-scm-service-" });
  const projectId = ProjectId.make("project:scm");
  const timestamp = IsoDateTime.make("2026-11-04T00:00:00.000Z");
  const project = {
    id: projectId,
    title: "SCM",
    workspaceRoot: root,
    defaultModelSelection: null,
    scripts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const service = yield* ScmService.ScmService.pipe(
    Effect.provide(
      ScmService.layer.pipe(
        Layer.provide(
          Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
            refreshStatus: (cwd) => driver.status({ cwd }),
          }),
        ),
        Layer.provide(
          Layer.mock(ProjectStore.ProjectStoreV2)({
            getShell: (id) =>
              Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
          }),
        ),
        Layer.provide(
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getThreadShell: () => Effect.succeed(null),
          }),
        ),
      ),
    ),
  );
  const git = (cwd: string, args: readonly string[]) =>
    driver.execute({ cwd, args, operation: "ScmService.test" });
  const init = Effect.fn("ScmService.test.init")(function* (relative: string) {
    const cwd = path.join(root, relative);
    yield* fs.makeDirectory(cwd, { recursive: true });
    yield* git(cwd, ["init", "--initial-branch=main"]);
    yield* git(cwd, ["config", "user.name", "SCM Test"]);
    yield* git(cwd, ["config", "user.email", "scm@example.invalid"]);
    yield* git(cwd, ["config", "commit.gpgsign", "false"]);
    yield* git(cwd, ["config", "core.hooksPath", path.join(root, "empty-hooks")]);
    return cwd;
  });
  return { fs, path, root, projectId, service, git, init };
});

describe("ScmService", () => {
  it.effect("reads merged history and all branch refs without changing the checkout", () =>
    Effect.gen(function* () {
      const { fs, path, projectId, service, git, init } = yield* fixture;
      const cwd = yield* init("history");
      const target = { projectId, repositoryPath: cwd };
      expect((yield* service.history({ ...target, limit: 2 })).commits).toEqual([]);
      yield* fs.writeFileString(path.join(cwd, "base"), "base");
      yield* git(cwd, ["add", "."]);
      yield* git(cwd, ["commit", "-m", "base"]);
      yield* git(cwd, ["checkout", "-b", "feature"]);
      yield* fs.writeFileString(path.join(cwd, "feature"), "feature");
      yield* git(cwd, ["add", "."]);
      yield* git(cwd, ["commit", "-m", "feature subject | unicode ✓"]);
      yield* git(cwd, ["checkout", "main"]);
      yield* git(cwd, ["commit", "--allow-empty", "-m", "main change"]);
      yield* git(cwd, ["merge", "--no-ff", "feature", "-m", "merge"]);
      yield* git(cwd, ["update-ref", "refs/remotes/origin/feature", "feature"]);
      yield* git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/feature"]);
      const history = yield* service.history({ ...target, limit: 2 });
      expect(history.commits).toHaveLength(2);
      expect(history.hasMore).toBe(true);
      expect(history.commits[0]?.parents).toHaveLength(2);
      expect(history.branches.some((branch) => branch.ref === "refs/remotes/origin/HEAD")).toBe(
        false,
      );
      expect(history.branches.map((branch) => branch.ref)).toEqual(
        expect.arrayContaining([
          "refs/heads/main",
          "refs/heads/feature",
          "refs/remotes/origin/feature",
        ]),
      );
      const branch = yield* service.history({
        ...target,
        ref: "refs/remotes/origin/feature",
        limit: 100,
      });
      expect(branch.commits[0]?.subject).toBe("feature subject | unicode ✓");
      expect(branch.hasMore).toBe(false);
      expect((yield* git(cwd, ["branch", "--show-current"])).stdout.trim()).toBe("main");
      yield* service.history({ ...target, ref: "--all", limit: 100 }).pipe(Effect.flip);
      yield* git(cwd, ["checkout", "--detach", "feature"]);
      const detached = yield* service.history({ ...target, limit: 100 });
      expect(detached.commits[0]?.subject).toBe("feature subject | unicode ✓");
      expect(detached.branches.some((branch) => branch.current)).toBe(false);
    }).pipe(Effect.provide(runtime), Effect.scoped),
  );

  it.effect("stages a renamed destination without capturing a restored source", () =>
    Effect.gen(function* () {
      const { fs, path, projectId, service, git, init } = yield* fixture;
      const cwd = yield* init("rename-isolation");
      const target = { projectId, repositoryPath: cwd };
      const original = "original content\n".repeat(100);
      yield* fs.writeFileString(path.join(cwd, "old.txt"), original);
      yield* git(cwd, ["add", "--", "old.txt"]);
      yield* git(cwd, ["commit", "-m", "initial"]);
      yield* git(cwd, ["mv", "--", "old.txt", "new.txt"]);
      yield* fs.writeFileString(path.join(cwd, "new.txt"), `${original}destination edit\n`);
      yield* fs.writeFileString(path.join(cwd, "old.txt"), "independent restored file\n");
      const before = yield* service.status(target);
      expect(before.files.find((file) => file.path === "new.txt")?.indexStatus).toBe("R");
      expect(
        (yield* service.diff({ ...target, path: "new.txt", side: "working" })).patch,
      ).not.toContain("independent restored file");
      const after = yield* service.mutate({
        ...target,
        action: "stage",
        path: "new.txt",
        expectedRevision: before.revision,
      });
      expect(after.files.find((file) => file.path === "old.txt")).toEqual({
        path: "old.txt",
        indexStatus: ".",
        worktreeStatus: "U",
        conflict: false,
      });
      expect((yield* git(cwd, ["ls-files", "-z"])).stdout).toBe("new.txt\0");
    }).pipe(Effect.provide(runtime), Effect.scoped),
  );

  it.effect("selects the working replacement when a path is also deleted from the index", () =>
    Effect.gen(function* () {
      const { fs, path, projectId, service, git, init } = yield* fixture;
      const cwd = yield* init("replacement");
      const target = { projectId, repositoryPath: cwd };
      yield* fs.writeFileString(path.join(cwd, "file.txt"), "replacement content\n");
      yield* git(cwd, ["add", "--", "file.txt"]);
      yield* git(cwd, ["commit", "-m", "initial"]);
      yield* git(cwd, ["rm", "--cached", "--", "file.txt"]);
      const diff = yield* service.diff({ ...target, path: "file.txt", side: "working" });
      expect(diff.patch).toContain("+replacement content");
    }).pipe(Effect.provide(runtime), Effect.scoped),
  );

  it.effect("reports a rejected commit's hook diagnostic and preserves the index", () =>
    Effect.gen(function* () {
      const { fs, path, projectId, service, git, init } = yield* fixture;
      const cwd = yield* init("hook-failure");
      const target = { projectId, repositoryPath: cwd };
      const hooks = path.join(cwd, "hooks");
      yield* fs.makeDirectory(hooks);
      yield* fs.writeFileString(
        path.join(hooks, "pre-commit"),
        "#!/bin/sh\necho 'SCM hook rejected this commit' >&2\necho 'Authorization: Bearer scm-test-credential' >&2\necho 'ssh://test:scm-test-password@example.invalid/repo' >&2\nexit 1\n",
      );
      yield* fs.chmod(path.join(hooks, "pre-commit"), 0o755);
      yield* git(cwd, ["config", "core.hooksPath", hooks]);
      yield* fs.writeFileString(path.join(cwd, "file.txt"), "prepared content\n");
      yield* git(cwd, ["add", "--", "file.txt"]);
      const before = yield* service.status(target);
      const result = yield* service
        .mutate({
          ...target,
          action: "commit",
          message: "blocked",
          expectedRevision: before.revision,
        })
        .pipe(Effect.flip);
      expect(result.message).toContain("SCM hook rejected this commit");
      expect(result.message).not.toContain("scm-test-credential");
      expect(result.message).not.toContain("scm-test-password");
      expect((yield* git(cwd, ["show", ":file.txt"])).stdout).toBe("prepared content\n");
      expect(yield* fs.readFileString(path.join(cwd, "file.txt"))).toBe("prepared content\n");
    }).pipe(Effect.provide(runtime), Effect.scoped),
  );

  it.effect("rejects fetching a repository without a remote", () =>
    Effect.gen(function* () {
      const { projectId, service, init } = yield* fixture;
      const cwd = yield* init("no-remote");
      const target = { projectId, repositoryPath: cwd };
      const before = yield* service.status(target);
      expect(before.hasRemote).toBe(false);
      const error = yield* service
        .mutate({ ...target, action: "fetch", expectedRevision: before.revision })
        .pipe(Effect.flip);
      expect(error.message).toContain("remote");
    }).pipe(Effect.provide(runtime), Effect.scoped),
  );

  it.effect("supports a project without a root repository or a persisted chat", () =>
    Effect.gen(function* () {
      const { projectId, service, init } = yield* fixture;
      const first = yield* init("first");
      const second = yield* init("deep/second");
      const threadId = ThreadId.make("draft:scm");
      const snapshots = yield* Stream.runCollect(service.discover({ projectId, threadId }));
      expect(
        snapshots
          .at(-1)
          ?.repositories.map((repo) => repo.rootPath)
          .sort(),
      ).toEqual([first, second].sort());
      expect(
        (yield* service.status({ projectId, threadId, repositoryPath: first })).head,
      ).toBeNull();
    }).pipe(Effect.provide(runtime), Effect.scoped),
  );
  it.effect("unstages an unborn index without deleting the working file", () =>
    Effect.gen(function* () {
      const { fs, path, projectId, service, init } = yield* fixture;
      const cwd = yield* init("unborn");
      const target = { projectId, repositoryPath: cwd };
      yield* fs.writeFileString(path.join(cwd, "new.txt"), "staged\n");
      let state = yield* service.status(target);
      state = yield* service.mutate({
        ...target,
        action: "stage",
        path: "new.txt",
        expectedRevision: state.revision,
      });
      yield* fs.writeFileString(path.join(cwd, "new.txt"), "working\n");
      state = yield* service.status(target);
      state = yield* service.mutate({
        ...target,
        action: "unstage",
        path: "new.txt",
        expectedRevision: state.revision,
      });
      expect(state.files).toEqual([
        { path: "new.txt", indexStatus: ".", worktreeStatus: "U", conflict: false },
      ]);
      expect(yield* fs.readFileString(path.join(cwd, "new.txt"))).toBe("working\n");
    }).pipe(Effect.provide(runtime), Effect.scoped),
  );

  it.effect("shows renamed, deleted and binary files on their correct sides", () =>
    Effect.gen(function* () {
      const { fs, path, projectId, service, git, init } = yield* fixture;
      const cwd = yield* init("formats");
      const target = { projectId, repositoryPath: cwd };
      yield* fs.writeFileString(path.join(cwd, "old name.txt"), "original\n");
      yield* fs.writeFileString(path.join(cwd, "deleted.txt"), "delete\n");
      yield* git(cwd, ["add", "--", "old name.txt", "deleted.txt"]);
      yield* git(cwd, ["commit", "-m", "initial"]);
      yield* fs.rename(path.join(cwd, "old name.txt"), path.join(cwd, "new name.txt"));
      yield* fs.remove(path.join(cwd, "deleted.txt"));
      yield* git(cwd, ["add", "--", "old name.txt", "new name.txt"]);
      yield* fs.writeFile(path.join(cwd, "binary.dat"), new Uint8Array([0, 1, 255, 0]));
      let state = yield* service.status(target);
      expect(state.files.find((file) => file.path === "new name.txt")).toMatchObject({
        indexStatus: "R",
        originalPath: "old name.txt",
      });
      expect(
        (yield* service.diff({ ...target, path: "new name.txt", side: "index" })).patch,
      ).toContain("rename from old name.txt");
      expect(
        (yield* service.diff({ ...target, path: "deleted.txt", side: "working" })).patch,
      ).toContain("-delete");
      expect((yield* service.diff({ ...target, path: "binary.dat", side: "working" })).binary).toBe(
        true,
      );
      state = yield* service.mutate({
        ...target,
        action: "unstage",
        path: "new name.txt",
        expectedRevision: state.revision,
      });
      expect(state.files.some((file) => file.indexStatus !== ".")).toBe(false);
      expect(yield* fs.readFileString(path.join(cwd, "new name.txt"))).toBe("original\n");
    }).pipe(Effect.provide(runtime), Effect.scoped),
  );

  it.effect("refuses commits and staging when a merge conflict is unresolved", () =>
    Effect.gen(function* () {
      const { fs, path, projectId, service, git, init } = yield* fixture;
      const driver = yield* GitVcsDriver.GitVcsDriver;
      const cwd = yield* init("conflict");
      const target = { projectId, repositoryPath: cwd };
      yield* fs.writeFileString(path.join(cwd, "conflict.txt"), "initial\n");
      yield* git(cwd, ["add", "--", "conflict.txt"]);
      yield* git(cwd, ["commit", "-m", "initial"]);
      yield* git(cwd, ["switch", "-c", "other"]);
      yield* fs.writeFileString(path.join(cwd, "conflict.txt"), "other\n");
      yield* git(cwd, ["commit", "-am", "other"]);
      yield* git(cwd, ["switch", "main"]);
      yield* fs.writeFileString(path.join(cwd, "conflict.txt"), "main\n");
      yield* git(cwd, ["commit", "-am", "main"]);
      yield* driver.execute({
        cwd,
        args: ["merge", "other"],
        operation: "ScmService.test",
        allowNonZeroExit: true,
      });
      const state = yield* service.status(target);
      expect(state.files[0]?.conflict).toBe(true);
      const before = yield* fs.readFileString(path.join(cwd, "conflict.txt"));
      const commitError = yield* service
        .mutate({
          ...target,
          action: "commit",
          message: "blocked",
          expectedRevision: state.revision,
        })
        .pipe(Effect.flip);
      expect(commitError.message).toContain("conflicts");
      yield* service
        .mutate({
          ...target,
          action: "stage",
          path: "conflict.txt",
          expectedRevision: state.revision,
        })
        .pipe(Effect.flip);
      expect(yield* fs.readFileString(path.join(cwd, "conflict.txt"))).toBe(before);
    }).pipe(Effect.provide(runtime), Effect.scoped),
  );
  it.effect(
    "discovers nested repositories and git-file worktrees without traversing external symlinks",
    () =>
      Effect.gen(function* () {
        const { fs, path, root, projectId, service, git, init } = yield* fixture;
        const outer = yield* init(".");
        yield* fs.writeFileString(path.join(outer, "README.md"), "initial\n");
        yield* git(outer, ["add", "--", "README.md"]);
        yield* git(outer, ["commit", "-m", "initial"]);
        const child = yield* init("nested/child");
        const worktree = path.join(root, "nested/worktree");
        yield* git(outer, ["worktree", "add", "-b", "worktree-test", worktree]);
        const external = yield* fs.makeTempDirectoryScoped({ prefix: "t3-scm-external-" });
        if (symlinksSupported) yield* fs.symlink(external, path.join(root, "outside-link"));
        const snapshots = yield* Stream.runCollect(service.discover({ projectId }));
        const last = snapshots.at(-1)!;
        expect(last.scanning).toBe(false);
        expect(last.repositories.map((repo) => repo.rootPath).sort()).toEqual(
          [outer, child, worktree].sort(),
        );
        expect(last.repositories.some((repo) => repo.rootPath.includes("outside-link"))).toBe(
          false,
        );
        const error = yield* service
          .status({ projectId, repositoryPath: external })
          .pipe(Effect.flip);
        expect(error.message).toContain("project");
      }).pipe(Effect.provide(runtime), Effect.scoped),
  );

  it.effect("stages literal files, commits only the index and refuses stale revisions", () =>
    Effect.gen(function* () {
      const { fs, path, projectId, service, git, init } = yield* fixture;
      const cwd = yield* init("repo");
      const target = { projectId, repositoryPath: cwd };
      const name = "-имя с пробелом\nfile.txt";
      yield* fs.writeFileString(path.join(cwd, name), "first\n");
      yield* fs.writeFileString(path.join(cwd, "unrelated.txt"), "keep\n");
      let status = yield* service.status(target);
      status = yield* service.mutate({
        ...target,
        action: "stage",
        path: name,
        expectedRevision: status.revision,
      });
      expect(status.files.find((file) => file.path === name)?.indexStatus).toBe("A");
      const prepared = yield* service.diff({ ...target, path: name, side: "index" });
      expect(prepared.patch).toContain("+first");
      yield* fs.writeFileString(path.join(cwd, name), "second\n");
      const stale = yield* service
        .mutate({
          ...target,
          action: "commit",
          message: "stale",
          expectedRevision: status.revision,
        })
        .pipe(Effect.flip);
      expect(stale.message).toContain("changed");
      status = yield* service.status(target);
      expect(status.files.find((file) => file.path === name)).toMatchObject({
        indexStatus: "A",
        worktreeStatus: "M",
      });
      const working = yield* service.diff({ ...target, path: name, side: "working" });
      expect(working.patch).toContain("+second");
      status = yield* service.mutate({
        ...target,
        action: "commit",
        message: "first commit",
        expectedRevision: status.revision,
      });
      expect((yield* git(cwd, ["ls-tree", "--name-only", "-z", "HEAD"])).stdout).toBe(name + "\0");
      expect(yield* fs.readFileString(path.join(cwd, name))).toBe("second\n");
      expect(status.files.map((file) => file.path)).toContain("unrelated.txt");
      status = yield* service.mutate({
        ...target,
        action: "stage",
        path: name,
        expectedRevision: status.revision,
      });
      status = yield* service.mutate({
        ...target,
        action: "unstage",
        path: name,
        expectedRevision: status.revision,
      });
      expect(status.files.find((file) => file.path === name)).toMatchObject({
        indexStatus: ".",
        worktreeStatus: "M",
      });
      expect(yield* fs.readFileString(path.join(cwd, name))).toBe("second\n");
    }).pipe(Effect.provide(runtime), Effect.scoped),
  );
});
