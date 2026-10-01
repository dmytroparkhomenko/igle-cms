import { describe, expect, it } from "vitest";
import { CollabService } from "@igle/core";
import type { Actor } from "@igle/shared";

const userA: Actor = { id: "u1", email: "a@example.com", role: "editor" };
const userB: Actor = { id: "u2", email: "b@example.com", role: "editor" };

describe("CollabService", () => {
  it("join adds a participant and empty-patches snapshot", () => {
    const service = new CollabService();
    const { connectionId, color } = service.join("site_1", "page_1", userA);
    expect(connectionId).toBeTruthy();
    expect(color).toBeTruthy();
    const snapshot = service.snapshot("site_1", "page_1");
    expect(snapshot.participants).toHaveLength(1);
    expect(snapshot.participants[0]).toMatchObject({ connectionId, actorId: "u1", name: "a@example.com", patches: [] });
  });

  it("sync updates a participant's patches and notifies subscribers", () => {
    const service = new CollabService();
    const { connectionId } = service.join("site_1", "page_1", userA);
    const seen: unknown[] = [];
    const unsubscribe = service.subscribe("site_1", "page_1", (snapshot) => seen.push(snapshot));

    service.sync("site_1", "page_1", connectionId, [{ nodeId: 3, op: "setAttr", attrName: "src", value: "x.png" }], 3);

    expect(seen).toHaveLength(1);
    const snapshot = service.snapshot("site_1", "page_1");
    expect(snapshot.participants[0]?.patches).toHaveLength(1);
    expect(snapshot.participants[0]?.selectedNodeId).toBe(3);
    unsubscribe();
  });

  it("sync for an unknown connection is a harmless no-op", () => {
    const service = new CollabService();
    service.join("site_1", "page_1", userA);
    expect(() => service.sync("site_1", "page_1", "not-a-real-id", [], undefined)).not.toThrow();
    expect(service.snapshot("site_1", "page_1").participants[0]?.patches).toEqual([]);
  });

  it("leave removes the participant and deletes an empty room", () => {
    const service = new CollabService();
    const { connectionId: a } = service.join("site_1", "page_1", userA);
    const { connectionId: b } = service.join("site_1", "page_1", userB);
    expect(service.snapshot("site_1", "page_1").participants).toHaveLength(2);

    service.leave("site_1", "page_1", a);
    expect(service.snapshot("site_1", "page_1").participants).toHaveLength(1);

    service.leave("site_1", "page_1", b);
    expect(service.snapshot("site_1", "page_1").participants).toHaveLength(0);
  });

  it("assigns distinct colors to different participants in the same room", () => {
    const service = new CollabService();
    const first = service.join("site_1", "page_1", userA);
    const second = service.join("site_1", "page_1", userB);
    expect(first.color).not.toBe(second.color);
  });

  it("rooms for different sites/pages are independent", () => {
    const service = new CollabService();
    service.join("site_1", "page_1", userA);
    service.join("site_2", "page_1", userB);
    expect(service.snapshot("site_1", "page_1").participants).toHaveLength(1);
    expect(service.snapshot("site_2", "page_1").participants).toHaveLength(1);
    expect(service.snapshot("site_1", "page_2").participants).toHaveLength(0);
  });

  it("each participant keeps their own independent stack — syncing one never touches another's", () => {
    const service = new CollabService();
    const { connectionId: a } = service.join("site_1", "page_1", userA);
    const { connectionId: b } = service.join("site_1", "page_1", userB);
    service.sync("site_1", "page_1", a, [{ nodeId: 1, op: "setAttr", attrName: "src", value: "x" }], undefined);
    service.sync("site_1", "page_1", b, [{ nodeId: 2, op: "setAttr", attrName: "src", value: "y" }], undefined);

    // B clearing their own stack (e.g. after their own save) must leave A's completely untouched.
    service.sync("site_1", "page_1", b, [], undefined);

    const snapshot = service.snapshot("site_1", "page_1");
    const aEntry = snapshot.participants.find((p) => p.connectionId === a);
    const bEntry = snapshot.participants.find((p) => p.connectionId === b);
    expect(aEntry?.patches).toEqual([{ nodeId: 1, op: "setAttr", attrName: "src", value: "x" }]);
    expect(bEntry?.patches).toEqual([]);
  });
});
