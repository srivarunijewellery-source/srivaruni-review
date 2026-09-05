import test from "node:test";
import assert from "node:assert/strict";
import { laplacianVariance, sharpnessScore, frameDiff, countCuts, median } from "./metrics.mjs";

test("flat frame has zero sharpness, checkerboard is sharp", () => {
  const w = 8, h = 8;
  const flat = new Uint8Array(w * h).fill(128);
  const checker = new Uint8Array(w * h).map((_, i) => ((i % w) + Math.floor(i / w)) % 2 ? 255 : 0);
  assert.equal(laplacianVariance(flat, w, h), 0);
  assert.ok(laplacianVariance(checker, w, h) > 10000);
  assert.ok(sharpnessScore(500) > sharpnessScore(30));
});

test("cuts are counted from diff spikes only", () => {
  const a = new Uint8Array(16).fill(0), b = new Uint8Array(16).fill(255);
  assert.equal(frameDiff(a, b), 255);
  assert.equal(countCuts([2, 3, 200, 4, 180, 1]), 2);
  assert.equal(median([3, 1, 2]), 2);
});
