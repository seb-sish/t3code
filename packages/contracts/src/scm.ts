import * as Schema from "effect/Schema";

import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

const ScmPath = Schema.String.check(Schema.isNonEmpty());
export const ScmFileStatus = Schema.Literals([".", "M", "A", "D", "R", "C", "U", "T"]);
export const ScmFile = Schema.Struct({
  path: ScmPath,
  originalPath: Schema.optional(ScmPath),
  indexStatus: ScmFileStatus,
  worktreeStatus: ScmFileStatus,
  conflict: Schema.Boolean,
});
export type ScmFile = typeof ScmFile.Type;

export const ScmRepositoryTarget = Schema.Struct({
  projectId: ProjectId,
  repositoryPath: ScmPath,
  threadId: Schema.optional(ThreadId),
});
export type ScmRepositoryTarget = typeof ScmRepositoryTarget.Type;

export const ScmHistoryInput = Schema.Struct({
  ...ScmRepositoryTarget.fields,
  ref: Schema.optional(ScmPath),
  limit: NonNegativeInt.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
});
export type ScmHistoryInput = typeof ScmHistoryInput.Type;
export const ScmHistoryResult = Schema.Struct({
  branches: Schema.Array(
    Schema.Struct({
      ref: Schema.String,
      name: Schema.String,
      remote: Schema.Boolean,
      current: Schema.Boolean,
      hash: Schema.String,
      subject: Schema.String,
      author: Schema.String,
      date: Schema.String,
    }),
  ),
  commits: Schema.Array(
    Schema.Struct({
      hash: Schema.String,
      parents: Schema.Array(Schema.String),
      author: Schema.String,
      date: Schema.String,
      subject: Schema.String,
    }),
  ),
  hasMore: Schema.Boolean,
});
export type ScmHistoryResult = typeof ScmHistoryResult.Type;

export const ScmRepositoryStatus = Schema.Struct({
  rootPath: ScmPath,
  branch: Schema.NullOr(Schema.String),
  head: Schema.NullOr(Schema.String),
  upstream: Schema.NullOr(Schema.String),
  hasRemote: Schema.Boolean,
  ahead: NonNegativeInt,
  behind: NonNegativeInt,
  revision: Schema.String,
  files: Schema.Array(ScmFile),
});
export type ScmRepositoryStatus = typeof ScmRepositoryStatus.Type;

export const ScmDiscoverInput = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.optional(ThreadId),
});
export type ScmDiscoverInput = typeof ScmDiscoverInput.Type;
export const ScmDiscoverySnapshot = Schema.Struct({
  repositories: Schema.Array(
    Schema.Struct({
      rootPath: ScmPath,
      relativePath: Schema.String,
      branch: Schema.NullOr(Schema.String),
      changedFiles: NonNegativeInt,
      activeWorktree: Schema.Boolean,
      error: Schema.optional(Schema.String),
    }),
  ),
  scanning: Schema.Boolean,
  errors: Schema.Array(Schema.Struct({ path: Schema.String, message: Schema.String })),
});
export type ScmDiscoverySnapshot = typeof ScmDiscoverySnapshot.Type;

export const ScmDiffInput = Schema.Struct({
  ...ScmRepositoryTarget.fields,
  path: ScmPath,
  side: Schema.Literals(["index", "working"]),
});
export type ScmDiffInput = typeof ScmDiffInput.Type;
export const ScmDiffResult = Schema.Struct({
  patch: Schema.String,
  binary: Schema.Boolean,
  truncated: Schema.Boolean,
  revision: Schema.String,
});
export type ScmDiffResult = typeof ScmDiffResult.Type;

export const ScmMutationInput = Schema.Struct({
  ...ScmRepositoryTarget.fields,
  action: Schema.Literals(["stage", "unstage", "commit", "fetch", "pull", "push"]),
  expectedRevision: Schema.String,
  path: Schema.optional(ScmPath),
  message: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(10_000))),
});
export type ScmMutationInput = typeof ScmMutationInput.Type;

export class ScmError extends Schema.TaggedError<ScmError>()("ScmError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
