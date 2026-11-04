export function commitGraph(commits: readonly { hash: string; parents: readonly string[] }[]) {
  let lanes: Array<{ hash: string; color: number }> = [];
  let nextColor = 0;
  return commits.map((commit) => {
    let lane = lanes.findIndex((entry) => entry.hash === commit.hash);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push({ hash: commit.hash, color: nextColor++ });
    }
    const color = lanes[lane]!.color;
    const after = lanes.filter((_, index) => index !== lane);
    const parents = commit.parents.map((hash, index) => {
      const existing = after.find((entry) => entry.hash === hash);
      if (existing) return existing;
      const entry = { hash, color: index === 0 ? color : nextColor++ };
      after.splice(Math.min(lane + index, after.length), 0, entry);
      return entry;
    });
    const edges = lanes.flatMap((entry, from) =>
      from === lane
        ? []
        : [{ from, to: after.findIndex((next) => next.hash === entry.hash), color: entry.color }],
    );
    for (const parent of parents)
      edges.push({ from: lane, to: after.indexOf(parent), color: parent.color });
    const row = { lane, color, width: Math.max(lanes.length, after.length), edges };
    lanes = after;
    return row;
  });
}
