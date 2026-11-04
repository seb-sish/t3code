import {
  ScmError,
  type ScmDiscoverInput,
  type ScmDiscoverySnapshot,
  type ScmDiffInput,
  type ScmDiffResult,
  type ScmMutationInput,
  type ScmRepositoryStatus,
  type ScmRepositoryTarget,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { isWithinRoot } from "../workspace/KnownWorkspaces.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsStatusBroadcaster from "./VcsStatusBroadcaster.ts";
import { parseScmStatus } from "./scmStatus.ts";

export class ScmService extends Context.Service<
  ScmService,
  {
    readonly discover: (input: ScmDiscoverInput) => Stream.Stream<ScmDiscoverySnapshot, ScmError>;
    readonly status: (input: ScmRepositoryTarget) => Effect.Effect<ScmRepositoryStatus, ScmError>;
    readonly diff: (input: ScmDiffInput) => Effect.Effect<ScmDiffResult, ScmError>;
    readonly mutate: (input: ScmMutationInput) => Effect.Effect<ScmRepositoryStatus, ScmError>;
  }
>()("t3/vcs/ScmService") {}

const scanExcluded = new Set([
  ".git",
  "node_modules",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  ".pnpm-store",
  ".next",
  ".repos",
]);
const PATCH_LIMIT = 256 * 1024;

const isScmError = Schema.is(ScmError);
const failure = (message: string) => (cause: unknown) =>
  isScmError(cause) ? cause : new ScmError({ message, cause });

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const digest = yield* Digest.Digest;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const broadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
  const locks = new Map<string, { semaphore: Semaphore.Semaphore; users: number }>();
  const hash = (value: string) => digest.digestHex(Digest.sha256, new TextEncoder().encode(value));

  const execute = Effect.fn("ScmService.execute")(function* (
    cwd: string,
    args: readonly string[],
    options?: { allowNonZeroExit?: boolean; maxOutputBytes?: number },
  ) {
    let diagnostic = "";
    const result = yield* git
      .execute({
        cwd,
        args: ["--literal-pathspecs", ...args],
        operation: "ScmService.execute",
        env: { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
        timeoutMs:
          args[0] === "fetch" || args[0] === "pull" || args[0] === "push" || args[0] === "commit"
            ? 300_000
            : 30_000,
        ...options,
        progress: {
          onStderrLine: (line) =>
            Effect.sync(() => {
              if (diagnostic.length < 4096)
                diagnostic += `${line.slice(0, 4096 - diagnostic.length)}\n`;
            }),
        },
      })
      .pipe(
        Effect.mapError((cause) => {
          const detail = diagnostic
            .trim()
            .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s]+/gi, "<remote URL>")
            .replace(
              /\bauthorization\s*[:=]\s*(?:bearer|basic)\s+\S+/gi,
              "authorization=<redacted>",
            )
            .replace(
              /\b(authorization|password|token|access_token|secret)\s*[:=]\s*\S+/gi,
              "$1=<redacted>",
            );
          return new ScmError({
            message: `Git ${args[0] ?? "operation"} failed. ${detail || cause.detail}`,
            cause,
          });
        }),
      );
    return result;
  });

  const roots = Effect.fn("ScmService.roots")(function* (input: ScmDiscoverInput) {
    const project = yield* projects.getShell(input.projectId);
    if (Option.isNone(project))
      return yield* new ScmError({ message: "The selected project is unavailable." });
    const root = yield* fs.realPath(project.value.workspaceRoot);
    let worktree: string | null = null;
    if (input.threadId !== undefined) {
      const thread = yield* projections.getThreadShell(input.threadId);
      if (thread !== null && thread.projectId !== input.projectId) {
        return yield* new ScmError({
          message: "The thread does not belong to the selected project.",
        });
      }
      if (thread !== null && thread.worktreePath !== null) {
        const candidate = yield* fs.realPath(thread.worktreePath);
        if (!isWithinRoot(path, candidate, root)) {
          const listed = yield* git.listWorktreePaths(root);
          const realListed = yield* Effect.forEach(listed, (entry) =>
            fs.realPath(entry).pipe(Effect.orElseSucceed(() => null)),
          );
          if (!realListed.includes(candidate))
            return yield* new ScmError({
              message: "The thread worktree is not registered with the project repository.",
            });
          worktree = candidate;
        }
      }
    }
    return { root, worktree };
  });

  const authorize = Effect.fn("ScmService.authorize")(function* (input: ScmRepositoryTarget) {
    const allowed = yield* roots(input);
    const cwd = yield* fs.realPath(input.repositoryPath);
    if (
      (!isWithinRoot(path, cwd, allowed.root) && cwd !== allowed.worktree) ||
      path.relative(allowed.root, cwd).split(path.sep).includes(".git")
    ) {
      return yield* new ScmError({ message: "The repository is outside the selected project." });
    }
    if (!(yield* fs.exists(path.join(cwd, ".git"))))
      return yield* new ScmError({ message: "The selected path is not a Git working-tree root." });
    const top = yield* execute(cwd, ["rev-parse", "--show-toplevel"]);
    if ((yield* fs.realPath(top.stdout.trimEnd())) !== cwd)
      return yield* new ScmError({ message: "The selected path is not a Git working-tree root." });
    return cwd;
  });

  const readStatus = Effect.fn("ScmService.readStatus")(function* (cwd: string) {
    const output = yield* execute(
      cwd,
      ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all", "--renames"],
      { maxOutputBytes: 16 * 1024 * 1024 },
    );
    if (output.stdoutTruncated)
      return yield* new ScmError({
        message:
          "Git status is too large to read safely. Narrow the project or reduce untracked files.",
      });
    const parsed = yield* Effect.try({
      try: () => parseScmStatus(output.stdout),
      catch: failure("Git returned incomplete status data."),
    });
    const index = yield* execute(cwd, ["ls-files", "--stage", "-z"], {
      maxOutputBytes: 32 * 1024 * 1024,
    });
    if (index.stdoutTruncated)
      return yield* new ScmError({ message: "Git index is too large to validate safely." });
    const metadata = yield* Effect.forEach(
      parsed.files,
      (file) =>
        fs.lstat(path.join(cwd, file.path)).pipe(
          Effect.map(
            (info) =>
              `${file.path.length}:${file.path}:${info.size}:${Option.getOrUndefined(info.mtime)?.getTime()}:${Option.getOrUndefined(info.ino)}:${info.mode}`,
          ),
          Effect.catchTags({
            PlatformError: (error) =>
              error.reason._tag === "NotFound"
                ? Effect.succeed(`${file.path.length}:${file.path}:deleted`)
                : Effect.fail(error),
          }),
        ),
      { concurrency: 8 },
    );
    const revision = yield* hash(
      [parsed.head ?? "", output.stdout, index.stdout, ...metadata]
        .map((value) => `${value.length}:${value}`)
        .join(""),
    );
    const remotes = yield* execute(cwd, ["remote"]);
    return {
      rootPath: cwd,
      ...parsed,
      revision,
      hasRemote: remotes.stdout.trim().length > 0,
    } satisfies ScmRepositoryStatus;
  });

  const status: ScmService["Service"]["status"] = Effect.fn("ScmService.status")((input) =>
    authorize(input).pipe(
      Effect.flatMap(readStatus),
      Effect.mapError(failure("Could not read Git status.")),
    ),
  );

  const discover: ScmService["Service"]["discover"] = (input) =>
    Stream.unwrap(
      roots(input).pipe(
        Effect.map(({ root, worktree }) => {
          const queue = [root];
          if (worktree !== null) queue.push(worktree);
          const seen = new Set<string>();
          const repositories: Array<ScmDiscoverySnapshot["repositories"][number]> = [];
          const errors: Array<ScmDiscoverySnapshot["errors"][number]> = [];
          const initial: ScmDiscoverySnapshot = { repositories: [], scanning: true, errors: [] };
          const scan = Effect.fn("ScmService.scanBatch")(function* () {
            if (queue.length === 0) return undefined;
            const batch = queue.splice(0, 32);
            for (const directory of batch) {
              if (seen.has(directory)) continue;
              seen.add(directory);
              const outcome = yield* Effect.result(
                Effect.gen(function* () {
                  const info = yield* fs.lstat(directory);
                  if (info.type !== "Directory") return;
                  const real = yield* fs.realPath(directory);
                  if ((!isWithinRoot(path, real, root) && real !== worktree) || real !== directory)
                    return;
                  if (yield* fs.exists(path.join(directory, ".git"))) {
                    const state = yield* readStatus(directory).pipe(Effect.result);
                    const relativePath =
                      real === worktree ? "" : path.relative(root, real).split(path.sep).join("/");
                    if (state._tag === "Success") {
                      repositories.push({
                        rootPath: real,
                        relativePath,
                        branch: state.success.branch,
                        changedFiles: new Set(state.success.files.map((file) => file.path)).size,
                        activeWorktree: real === worktree,
                      });
                    } else {
                      repositories.push({
                        rootPath: real,
                        relativePath,
                        branch: null,
                        changedFiles: 0,
                        activeWorktree: real === worktree,
                        error: "Could not read this repository.",
                      });
                    }
                  }
                  if (directory === worktree) return;
                  const children = yield* fs.readDirectory(directory);
                  for (const child of children.sort()) {
                    if (scanExcluded.has(child)) continue;
                    const entry = path.join(directory, child);
                    const childInfo = yield* fs.lstat(entry).pipe(Effect.result);
                    if (childInfo._tag === "Success") {
                      if (childInfo.success.type === "Directory") queue.push(entry);
                    } else {
                      errors.push({
                        path: path.relative(root, entry),
                        message: "Could not inspect this path.",
                      });
                    }
                  }
                }),
              );
              if (outcome._tag === "Failure")
                errors.push({
                  path: path.relative(root, directory),
                  message: "Could not scan this directory.",
                });
            }
            return [
              {
                repositories: repositories.slice(),
                errors: errors.slice(),
                scanning: queue.length > 0,
              },
              undefined,
            ] as const;
          });
          return Stream.concat(
            Stream.succeed(initial),
            Stream.unfold(undefined, () => scan()),
          );
        }),
        Effect.mapError(failure("Could not discover project repositories.")),
      ),
    ).pipe(Stream.mapError(failure("Could not discover project repositories.")));

  const validateFile = Effect.fn("ScmService.validateFile")(function* (
    cwd: string,
    filePath: string,
  ) {
    if (
      path.isAbsolute(filePath) ||
      filePath.includes("\0") ||
      filePath.split(/[\\/]/).includes(".git")
    )
      return yield* new ScmError({ message: "Invalid repository file path." });
    const absolute = path.resolve(cwd, filePath);
    if (absolute === cwd || !isWithinRoot(path, absolute, cwd))
      return yield* new ScmError({ message: "The file is outside the repository." });
    const parent = yield* fs
      .realPath(path.dirname(absolute))
      .pipe(Effect.orElseSucceed(() => null));
    // Deleted directories have no parent to resolve; Git still needs their literal index paths.
    if (parent !== null && !isWithinRoot(path, parent, cwd))
      return yield* new ScmError({ message: "The file parent is outside the repository." });
    return filePath;
  });

  const diff: ScmService["Service"]["diff"] = Effect.fn("ScmService.diff")(
    function* (input) {
      const cwd = yield* authorize(input);
      const state = yield* readStatus(cwd);
      const file = state.files.find(
        (entry) =>
          entry.path === input.path &&
          (input.side === "index" ? entry.indexStatus !== "." : entry.worktreeStatus !== "."),
      );
      if (file === undefined)
        return yield* new ScmError({
          message: "The file has changed. Refresh Git status and select it again.",
        });
      yield* validateFile(cwd, file.path);
      const prefix = [
        "-c",
        "diff.suppressBlankEmpty=false",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--src-prefix=a/",
        "--dst-prefix=b/",
      ];
      let args: string[];
      if (input.side === "index") {
        args = [
          ...prefix,
          "--cached",
          "--",
          file.path,
          ...(file.originalPath !== undefined && file.indexStatus === "R"
            ? [file.originalPath]
            : []),
        ];
      } else if (file.indexStatus === "." && file.worktreeStatus === "U" && !file.conflict) {
        args = [...prefix, "--no-index", "--", "/dev/null", file.path];
      } else {
        args = [
          ...prefix,
          "--",
          file.path,
          ...(file.originalPath !== undefined && file.worktreeStatus === "R"
            ? [file.originalPath]
            : []),
        ];
      }
      const result = yield* execute(cwd, args, {
        allowNonZeroExit: true,
        maxOutputBytes: PATCH_LIMIT,
      });
      if (result.exitCode !== 0 && result.exitCode !== 1)
        return yield* new ScmError({ message: "Could not load this file's Git diff." });
      return {
        patch: result.stdout,
        binary: /(?:Binary files .* differ|GIT binary patch)/.test(result.stdout),
        truncated: result.stdoutTruncated,
        revision: state.revision,
      };
    },
    Effect.mapError(failure("Could not load Git diff.")),
  );

  const mutate: ScmService["Service"]["mutate"] = Effect.fn("ScmService.mutate")(
    function* (input) {
      const cwd = yield* authorize(input);
      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          let entry = locks.get(cwd);
          if (entry === undefined) {
            entry = { semaphore: Semaphore.makeUnsafe(1), users: 0 };
            locks.set(cwd, entry);
          }
          entry.users++;
          return entry;
        }),
        ({ semaphore }) =>
          semaphore.withPermits(1)(
            Effect.gen(function* () {
              const before = yield* readStatus(cwd);
              if (before.revision !== input.expectedRevision)
                return yield* new ScmError({
                  message: "The repository changed. Refresh Git status before trying again.",
                });
              if (input.action === "stage" || input.action === "unstage") {
                const file = before.files.find(
                  (entry) =>
                    entry.path === input.path &&
                    (input.action === "stage"
                      ? entry.worktreeStatus !== "."
                      : entry.indexStatus !== "."),
                );
                if (file === undefined)
                  return yield* new ScmError({
                    message: "The selected file is no longer in Git status.",
                  });
                if (file.conflict)
                  return yield* new ScmError({
                    message: "Resolve the file's merge conflict before staging it.",
                  });
                const paths = [yield* validateFile(cwd, file.path)];
                if (
                  file.originalPath !== undefined &&
                  (input.action === "stage" ? file.worktreeStatus : file.indexStatus) === "R"
                )
                  paths.push(yield* validateFile(cwd, file.originalPath));
                if (input.action === "stage") yield* execute(cwd, ["add", "--", ...paths]);
                else if (before.head === null)
                  yield* execute(cwd, [
                    "rm",
                    "--cached",
                    "--ignore-unmatch",
                    "--force",
                    "--",
                    ...paths,
                  ]);
                else yield* execute(cwd, ["restore", "--staged", "--", ...paths]);
              } else if (input.action === "commit") {
                if (!input.message?.trim())
                  return yield* new ScmError({ message: "Enter a commit message." });
                if (before.files.some((file) => file.conflict))
                  return yield* new ScmError({
                    message: "Resolve merge conflicts before committing.",
                  });
                if (!before.files.some((file) => file.indexStatus !== "."))
                  return yield* new ScmError({
                    message: "Prepare at least one file before committing.",
                  });
                yield* execute(cwd, ["commit", "-m", input.message]);
              } else if (input.action === "fetch") {
                if (!before.hasRemote)
                  return yield* new ScmError({ message: "Configure a remote before fetching." });
                yield* execute(cwd, ["fetch", "--prune"]);
              } else if (input.action === "pull") {
                if (before.upstream === null)
                  return yield* new ScmError({
                    message: "Configure an upstream branch before pulling.",
                  });
                yield* execute(cwd, ["pull", "--ff-only"]);
              } else {
                if (before.upstream === null || before.branch === null)
                  return yield* new ScmError({
                    message: "Configure an upstream branch before pushing.",
                  });
                yield* execute(cwd, ["push"]);
              }
              yield* broadcaster
                .refreshStatus(cwd, { refreshUpstream: false })
                .pipe(Effect.ignore({ log: true }));
              return yield* readStatus(cwd);
            }),
          ),
        (entry) =>
          Effect.sync(() => {
            entry.users--;
            if (entry.users === 0) locks.delete(cwd);
          }),
      );
    },
    Effect.mapError(
      failure(
        "Git operation failed. Check Git hooks, signing and remote configuration before trying again.",
      ),
    ),
  );

  return ScmService.of({ discover, status, diff, mutate });
});

export const layer = Layer.effect(ScmService, make);
