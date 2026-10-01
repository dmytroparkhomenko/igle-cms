import { describe, expect, it } from "vitest";
import { DeployQueueService } from "@igle/core";

const siteA = { id: "site_a", metadata: { name: "Site A" } };
const siteB = { id: "site_b", metadata: { name: "Site B" } };
const actor = { email: "a@example.com" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("DeployQueueService", () => {
  it("runs a single task immediately and reports it as running then empties out", async () => {
    const service = new DeployQueueService();
    const task = deferred<void>();
    const runPromise = service.run(siteA, actor, () => task.promise);
    // run() queues synchronously but only flips to "running" after awaiting the (already-resolved)
    // internal chain — flush a microtask so that transition has actually happened before asserting.
    await Promise.resolve();

    const snapshot = service.snapshot();
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toMatchObject({ siteId: "site_a", status: "running" });

    task.resolve();
    await runPromise;

    const after = service.snapshot();
    expect(after.entries[0]?.status).toBe("done");
  });

  it("serializes two concurrent deploys — the second stays queued until the first finishes", async () => {
    const service = new DeployQueueService();
    const first = deferred<void>();
    const second = deferred<void>();

    const firstRun = service.run(siteA, actor, () => first.promise);
    const secondRun = service.run(siteB, actor, () => second.promise);
    await Promise.resolve();

    const snapshot = service.snapshot();
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.entries[0]).toMatchObject({ siteId: "site_a", status: "running" });
    expect(snapshot.entries[1]).toMatchObject({ siteId: "site_b", status: "queued", position: 1 });

    let secondStarted = false;
    void secondRun.then(() => {
      secondStarted = true;
    });

    first.resolve();
    await firstRun;
    // Flush microtasks so the queue's internal chain actually advances to the second entry.
    await Promise.resolve();
    await Promise.resolve();

    expect(service.snapshot().entries[1]).toMatchObject({ siteId: "site_b", status: "running" });
    expect(secondStarted).toBe(false);

    second.resolve();
    await secondRun;
  });

  it("marks a failed task as failed without blocking entries queued behind it", async () => {
    const service = new DeployQueueService();
    const failing = deferred<void>();
    const next = deferred<void>();

    const failingRun = service.run(siteA, actor, () => failing.promise.then(() => Promise.reject(new Error("boom"))));
    const nextRun = service.run(siteB, actor, () => next.promise);

    failing.resolve();
    await expect(failingRun).rejects.toThrow("boom");
    await Promise.resolve();
    await Promise.resolve();

    expect(service.snapshot().entries[1]).toMatchObject({ siteId: "site_b", status: "running" });
    next.resolve();
    await nextRun;
  });
});
