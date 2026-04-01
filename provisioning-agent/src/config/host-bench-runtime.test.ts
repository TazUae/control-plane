import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateHostBenchPaths, HostBenchRuntimeError } from "./host-bench-runtime.js";

test("validateHostBenchPaths accepts existing directory and bare bench executable name", () => {
  const dir = mkdtempSync(join(tmpdir(), "hb-bench-"));
  try {
    validateHostBenchPaths(dir, "bench");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateHostBenchPaths rejects missing bench path", () => {
  assert.throws(
    () => validateHostBenchPaths(join(tmpdir(), "nonexistent-bench-xyz"), "bench"),
    (e: unknown) => e instanceof HostBenchRuntimeError && e.message.includes("does not exist")
  );
});

test("validateHostBenchPaths rejects file used as bench path", () => {
  const dir = mkdtempSync(join(tmpdir(), "hb-bench-"));
  const file = join(dir, "not-a-dir");
  writeFileSync(file, "");
  try {
    assert.throws(
      () => validateHostBenchPaths(file, "bench"),
      (e: unknown) => e instanceof HostBenchRuntimeError && e.message.includes("not a directory")
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateHostBenchPaths rejects missing absolute executable", () => {
  const dir = mkdtempSync(join(tmpdir(), "hb-bench-"));
  try {
    assert.throws(
      () => validateHostBenchPaths(dir, join(dir, "no-such-bench-bin")),
      (e: unknown) => e instanceof HostBenchRuntimeError && e.message.includes("ERP_BENCH_EXECUTABLE")
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateHostBenchPaths accepts existing executable path", () => {
  const dir = mkdtempSync(join(tmpdir(), "hb-bench-"));
  const exe = join(dir, "bench-mock");
  writeFileSync(exe, "#!/usr/bin/env sh\necho ok\n");
  try {
    chmodSync(exe, 0o755);
  } catch {
    // Windows may ignore mode; R_OK check still passes if file exists
  }
  try {
    validateHostBenchPaths(dir, exe);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
