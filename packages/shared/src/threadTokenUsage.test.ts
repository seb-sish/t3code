import { describe, expect, it } from "vite-plus/test";
import { NodeId, ProviderThreadId, ProviderTurnId, RunAttemptId, RunId } from "@t3tools/contracts";
import type { OrchestrationV2ProviderTurn, TurnTokenUsage } from "@t3tools/contracts";
import { summarizeThreadTokenUsage } from "./threadTokenUsage.ts";

const attempt = (id: string, run: string) => ({
  id: RunAttemptId.make(id),
  runId: RunId.make(run),
});
const turn = (
  id: string,
  attemptId: string | null,
  usage?: TurnTokenUsage,
): OrchestrationV2ProviderTurn => ({
  id: ProviderTurnId.make(id),
  providerThreadId: ProviderThreadId.make("provider"),
  nodeId: NodeId.make("node"),
  runAttemptId: attemptId === null ? null : RunAttemptId.make(attemptId),
  nativeTurnRef: null,
  ordinal: 1,
  status: "completed",
  startedAt: null,
  completedAt: null,
  ...(usage === undefined ? {} : { turnTokenUsage: usage }),
});
const usage = (
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number,
): TurnTokenUsage => ({
  usageScope: "main_agent",
  usageStatus: "complete",
  inputTokens,
  outputTokens,
  cachedInputTokens,
  hasSubagents: false,
});

describe("thread token usage", () => {
  it("counts all attempts of a request and all history without adding cached or cumulative tokens twice", () => {
    const result = summarizeThreadTokenUsage({
      attempts: [attempt("a", "first"), attempt("b", "first"), attempt("c", "second")],
      providerTurns: [
        {
          ...turn("one", "a", { ...usage(100, 20, 80), reasoningTokens: 8 }),
          status: "running",
          tokenUsage: {
            usedTokens: 9000,
            inputTokens: 8000,
            outputTokens: 1000,
            updatedAt: "2026-11-04T00:00:00Z",
          },
        },
        turn("two", "b", { ...usage(40, 5, 10), reasoningTokens: 2 }),
        turn("three", "c", { ...usage(60, 15, 0), reasoningTokens: 6 }),
      ],
    });
    expect(result.total).toEqual({
      inputTokens: 200,
      outputTokens: 40,
      totalTokens: 240,
      cachedInputTokens: 90,
      reasoningTokens: 16,
      recordedTurns: 3,
      unavailableTurns: 0,
      hasSubagents: false,
    });
    expect(result.runs.map(({ runId, usage }) => [runId, usage.totalTokens])).toEqual([
      ["first", 165],
      ["second", 75],
    ]);
  });

  it("distinguishes unavailable usage from a reported zero and ignores live and synthetic turns", () => {
    const result = summarizeThreadTokenUsage({
      attempts: [attempt("a", "first")],
      providerTurns: [
        turn("zero", "a", usage(0, 0, 0)),
        turn("unknown", "a"),
        { ...turn("live", "a"), status: "running" },
        turn("command", "a", { ...usage(100, 50, 0), localCommand: true }),
        turn("child", null, usage(100, 50, 0)),
      ],
    });
    expect(result.total.totalTokens).toBe(0);
    expect(result.total.recordedTurns).toBe(1);
    expect(result.total.unavailableTurns).toBe(1);
    expect(summarizeThreadTokenUsage({ attempts: [], providerTurns: [] }).total.recordedTurns).toBe(
      0,
    );
    expect(
      summarizeThreadTokenUsage({
        attempts: [attempt("a", "first")],
        providerTurns: [
          turn("unavailable", "a", { ...usage(0, 0, 0), usageStatus: "unavailable" }),
        ],
      }).total.recordedTurns,
    ).toBe(0);
  });

  it("does not turn missing categories into known zeroes or discard failed work", () => {
    const result = summarizeThreadTokenUsage({
      attempts: [attempt("a", "first")],
      providerTurns: [
        {
          ...turn("failed", "a", {
            usageScope: "main_agent",
            usageStatus: "partial",
            outputTokens: 7,
            hasSubagents: true,
          }),
          status: "failed",
        },
        turn("complete", "a", usage(100, 20, 80)),
      ],
    });
    expect(result.total.totalTokens).toBe(127);
    expect(result.total.inputTokens).toBeUndefined();
    expect(result.total.unavailableTurns).toBe(1);
    expect(result.total.cachedInputTokens).toBeUndefined();
    expect(result.total.hasSubagents).toBe(true);
  });

  it("includes additional provider-reported work without treating its missing breakdown as zero", () => {
    const result = summarizeThreadTokenUsage({
      attempts: [attempt("a", "first")],
      providerTurns: [
        turn("native", "a", {
          ...usage(100, 20, 80),
          hasSubagents: true,
          otherUsage: { inputTokens: 30, outputTokens: 10 },
        }),
      ],
    });
    expect(result.total.totalTokens).toBe(160);
    expect(result.total.inputTokens).toBe(130);
    expect(result.total.outputTokens).toBe(30);
    expect(result.total.cachedInputTokens).toBeUndefined();
    const partial = summarizeThreadTokenUsage({
      attempts: [attempt("a", "first")],
      providerTurns: [
        turn("partial-native", "a", {
          usageScope: "main_agent",
          usageStatus: "partial",
          hasSubagents: true,
          otherUsage: { inputTokens: 30, outputTokens: 10 },
        }),
      ],
    });
    expect(partial.total.recordedTurns).toBe(1);
    expect(partial.total.totalTokens).toBe(40);
  });
});
