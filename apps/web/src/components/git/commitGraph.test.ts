import { expect, it } from "vite-plus/test";
import { commitGraph } from "./commitGraph";

it("keeps both merge paths connected until their common ancestor", () => {
  const rows = commitGraph([
    { hash: "merge", parents: ["left", "right"] },
    { hash: "left", parents: ["base"] },
    { hash: "right", parents: ["base"] },
    { hash: "base", parents: [] },
  ]);
  expect(rows[0]?.edges.map(({ from, to }) => [from, to])).toEqual([
    [0, 0],
    [0, 1],
  ]);
  expect(rows[1]?.edges.map(({ from, to }) => [from, to])).toEqual([
    [1, 1],
    [0, 0],
  ]);
  expect(rows[2]?.edges.map(({ from, to }) => [from, to])).toEqual([
    [0, 0],
    [1, 0],
  ]);
  expect(rows[3]?.edges).toEqual([]);
  expect(rows[2]?.color).toBe(rows[0]?.edges[1]?.color);
});
