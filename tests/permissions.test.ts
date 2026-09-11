import { describe, expect, it } from "vitest";
import { can } from "@igle/shared";

describe("permission matrix", () => {
  it("allows administrators to manage global settings and deploy", () => {
    expect(can({ id: "1", email: "a@example.com", role: "administrator" }, "servers.manage")).toBe(true);
    expect(can({ id: "1", email: "a@example.com", role: "administrator" }, "sites.deploy", "site_1")).toBe(true);
  });

  it("blocks editors from unassigned sites", () => {
    expect(can({ id: "2", email: "e@example.com", role: "editor", siteGrants: [] }, "sites.read", "site_1")).toBe(false);
  });

  it("requires explicit grants for code editing and deployment", () => {
    const actor = {
      id: "2",
      email: "e@example.com",
      role: "editor" as const,
      siteGrants: [{ siteId: "site_1", canEditCode: true, canDeploy: false }]
    };
    expect(can(actor, "sites.edit", "site_1")).toBe(true);
    expect(can(actor, "sites.code", "site_1")).toBe(true);
    expect(can(actor, "sites.deploy", "site_1")).toBe(false);
  });
});
