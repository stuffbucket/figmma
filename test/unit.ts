/**
 * Unit tests for pure/testable functions.
 *
 * Usage:  npx tsx test/unit.ts
 */
import { parseFigmaUrl } from "../src/figma.js";
import { strict as assert } from "node:assert";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✘\x1b[0m ${name}`);
    console.log(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// parseFigmaUrl
// ---------------------------------------------------------------------------
console.log("\nparseFigmaUrl:");

test("parses /file/ URL with name", () => {
  const r = parseFigmaUrl("https://www.figma.com/file/ABC123/My-File");
  assert.ok(r);
  assert.equal(r.fileKey, "ABC123");
  assert.equal(r.fileName, "My File");
  assert.equal(r.nodeId, undefined);
});

test("parses /design/ URL with node-id", () => {
  const r = parseFigmaUrl("https://www.figma.com/design/XYZ/Cool-Design?node-id=1-23");
  assert.ok(r);
  assert.equal(r.fileKey, "XYZ");
  assert.equal(r.fileName, "Cool Design");
  assert.equal(r.nodeId, "1-23");
});

test("parses /proto/ URL", () => {
  const r = parseFigmaUrl("https://figma.com/proto/KEY99/Proto-Name");
  assert.ok(r);
  assert.equal(r.fileKey, "KEY99");
});

test("parses /board/ URL", () => {
  const r = parseFigmaUrl("https://www.figma.com/board/B0ARD/Board-Name");
  assert.ok(r);
  assert.equal(r.fileKey, "B0ARD");
});

test("parses URL without file name segment", () => {
  const r = parseFigmaUrl("https://www.figma.com/file/ABC123");
  assert.ok(r);
  assert.equal(r.fileKey, "ABC123");
  assert.equal(r.fileName, undefined);
});

test("returns null for non-figma URL", () => {
  const r = parseFigmaUrl("https://example.com/file/ABC123/Test");
  assert.equal(r, null);
});

test("returns null for invalid URL", () => {
  const r = parseFigmaUrl("not-a-url");
  assert.equal(r, null);
});

test("returns null for figma URL with wrong path", () => {
  const r = parseFigmaUrl("https://figma.com/community/plugin/12345");
  assert.equal(r, null);
});

test("handles encoded characters in file name", () => {
  const r = parseFigmaUrl("https://www.figma.com/file/KEY/Hello%20World");
  assert.ok(r);
  assert.equal(r.fileName, "Hello World");
});

test("handles multiple query params", () => {
  const r = parseFigmaUrl("https://www.figma.com/design/K/N?node-id=5-10&t=abc");
  assert.ok(r);
  assert.equal(r.nodeId, "5-10");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
