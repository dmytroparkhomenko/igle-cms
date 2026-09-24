import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonStateStore } from "@igle/core";

describe("JsonStateStore concurrency", () => {
  it("loses no updates when two separate store instances race on the same file", async () => {
    // Two instances (not two calls on one instance) is what actually matches production: the web
    // and worker containers are separate Node processes, each with their own JsonStateStore, both
    // pointed at the same shared state.json over a Docker volume. The lock is file-based
    // (fs.open with "wx"), so it has to work across independent instances, not just within one.
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "igle-state-race-"));
    const storeA = new JsonStateStore(dataDir);
    const storeB = new JsonStateStore(dataDir);
    await storeA.update((state) => {
      (state as unknown as { counter: number }).counter = 0;
    });

    const increments = 40;
    await Promise.all(
      Array.from({ length: increments }, (_, index) => {
        const store = index % 2 === 0 ? storeA : storeB;
        return store.update((state) => {
          (state as unknown as { counter: number }).counter += 1;
        });
      })
    );

    const finalState = await storeA.read();
    expect((finalState as unknown as { counter: number }).counter).toBe(increments);
  });

  it("never leaves a corrupt file behind under concurrent writes, even with large payloads", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "igle-state-corrupt-"));
    const store = new JsonStateStore(dataDir);
    const bigString = "x".repeat(200_000);

    await Promise.all(
      Array.from({ length: 15 }, (_, index) =>
        store.update((state) => {
          (state as unknown as { blobs: Record<string, string> }).blobs ??= {};
          (state as unknown as { blobs: Record<string, string> }).blobs[`entry-${index}`] = bigString;
        })
      )
    );

    // Read the raw bytes directly (bypassing JsonStateStore.read's own parsing) to prove the file
    // on disk is valid JSON, not just that the in-process view looks fine.
    const raw = await fs.readFile(path.join(dataDir, "state.json"), "utf8");
    const parsed = JSON.parse(raw) as { blobs: Record<string, string> };
    expect(Object.keys(parsed.blobs)).toHaveLength(15);
    for (let index = 0; index < 15; index += 1) {
      expect(parsed.blobs[`entry-${index}`]).toBe(bigString);
    }
  });

  it("steals a stale lock rather than hanging forever", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "igle-state-stale-lock-"));
    const store = new JsonStateStore(dataDir);
    await store.update((state) => {
      (state as unknown as { touched: boolean }).touched = false;
    });

    // Simulate a process that died while holding the lock: create the lock file and backdate its
    // mtime well past the staleness window, then confirm a fresh update() still succeeds instead
    // of waiting out the full timeout (or hanging forever).
    const lockPath = path.join(dataDir, "state.json.lock");
    await fs.writeFile(lockPath, "");
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, old, old);

    await store.update((state) => {
      (state as unknown as { touched: boolean }).touched = true;
    });
    const finalState = await store.read();
    expect((finalState as unknown as { touched: boolean }).touched).toBe(true);
  });
});
