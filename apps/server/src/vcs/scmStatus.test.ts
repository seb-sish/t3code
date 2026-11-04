import { describe, expect, it } from "@effect/vitest";

import { parseScmStatus } from "./scmStatus.ts";

describe("parseScmStatus", () => {
  it("keeps index and working-tree changes, literal paths and tracking metadata", () => {
    const path = "src/имя с пробелом\n-new.py";
    const result = parseScmStatus(
      [
        "# branch.oid abc123",
        "# branch.head main",
        "# branch.upstream origin/main",
        "# branch.ab +2 -1",
        `1 MM N... 100644 100644 100644 aaaa bbbb ${path}`,
        "? -new.txt",
        "",
      ].join("\0"),
    );
    expect(result).toMatchObject({
      branch: "main",
      head: "abc123",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    });
    expect(result.files).toEqual([
      { path, indexStatus: "M", worktreeStatus: "M", conflict: false },
      { path: "-new.txt", indexStatus: ".", worktreeStatus: "U", conflict: false },
    ]);
  });

  it("preserves rename source records and unmerged paths without treating them as filenames", () => {
    const result = parseScmStatus(
      [
        "2 R. N... 100644 100644 100644 aaaa bbbb R100 new name.ts",
        "old\nname.ts",
        "u UU N... 100644 100644 100644 100644 aaaa bbbb cccc conflict.ts",
        "1 .D N... 100644 100644 000000 aaaa aaaa deleted.ts",
        "",
      ].join("\0"),
    );
    expect(result.files).toEqual([
      {
        path: "new name.ts",
        originalPath: "old\nname.ts",
        indexStatus: "R",
        worktreeStatus: ".",
        conflict: false,
      },
      { path: "conflict.ts", indexStatus: "U", worktreeStatus: "U", conflict: true },
      { path: "deleted.ts", indexStatus: ".", worktreeStatus: "D", conflict: false },
    ]);
  });

  it("distinguishes unborn and detached HEAD and rejects incomplete output", () => {
    expect(parseScmStatus("# branch.oid (initial)\0# branch.head main\0")).toMatchObject({
      head: null,
      branch: "main",
      upstream: null,
    });
    expect(parseScmStatus("# branch.oid abc123\0# branch.head (detached)\0")).toMatchObject({
      head: "abc123",
      branch: null,
    });
    expect(() => parseScmStatus("1 MM N... 100644\0")).toThrow();
    expect(() => parseScmStatus("2 R. N... 100644 100644 100644 a b R100 new\0")).toThrow();
    expect(() => parseScmStatus("? missing terminator")).toThrow();
  });
});
