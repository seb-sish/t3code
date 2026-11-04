import type { ScmFile, ScmRepositoryStatus } from "@t3tools/contracts";

type ParsedStatus = Omit<ScmRepositoryStatus, "rootPath" | "revision" | "hasRemote">;
const statuses = new Set([".", "M", "A", "D", "R", "C", "U", "T"]);

function fieldsAndPath(record: string, count: number): { fields: string[]; path: string } {
  const fields: string[] = [];
  let offset = 0;
  for (let index = 0; index < count; index++) {
    const next = record.indexOf(" ", offset);
    if (next < 0) throw new Error("Incomplete Git status record.");
    fields.push(record.slice(offset, next));
    offset = next + 1;
  }
  const path = record.slice(offset);
  if (!path) throw new Error("Missing Git status path.");
  return { fields, path };
}

export function parseScmStatus(output: string): ParsedStatus {
  if (output && !output.endsWith("\0")) throw new Error("Incomplete Git status output.");
  const records = output.split("\0");
  let branch: string | null = null;
  let head: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: ScmFile[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    if (!record || record.startsWith("! ")) continue;
    if (record.startsWith("# branch.head ")) {
      const value = record.slice(14);
      branch = value === "(detached)" ? null : value;
    } else if (record.startsWith("# branch.oid ")) {
      const value = record.slice(13);
      head = value === "(initial)" ? null : value;
    } else if (record.startsWith("# branch.upstream ")) {
      upstream = record.slice(18);
    } else if (record.startsWith("# branch.ab ")) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
      if (!match) throw new Error("Invalid Git tracking status.");
      ahead = Number(match[1]);
      behind = Number(match[2]);
    } else if (record.startsWith("# ")) {
      continue;
    } else if (record.startsWith("? ")) {
      const path = record.slice(2);
      if (!path) throw new Error("Missing untracked Git path.");
      files.push({ path, indexStatus: ".", worktreeStatus: "U", conflict: false });
    } else {
      const kind = record[0];
      if (kind !== "1" && kind !== "2" && kind !== "u")
        throw new Error("Unknown Git status record.");
      const { fields, path } = fieldsAndPath(record, kind === "1" ? 8 : kind === "2" ? 9 : 10);
      const xy = fields[1] ?? "";
      if (xy.length !== 2 || !statuses.has(xy[0]!) || !statuses.has(xy[1]!)) {
        throw new Error("Invalid Git file status.");
      }
      const originalPath = kind === "2" ? records[++index] : undefined;
      if (kind === "2" && !originalPath) throw new Error("Missing Git rename source.");
      files.push({
        path,
        ...(originalPath === undefined ? {} : { originalPath }),
        indexStatus: xy[0] as ScmFile["indexStatus"],
        worktreeStatus: xy[1] as ScmFile["worktreeStatus"],
        conflict: kind === "u",
      });
    }
  }
  return { branch, head, upstream, ahead, behind, files };
}
