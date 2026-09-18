import { IgleError } from "./errors.js";

export const roles = ["administrator", "editor"] as const;
export type Role = (typeof roles)[number];

export const capabilities = [
  "users.manage",
  "templates.manage",
  "sites.create",
  "sites.delete",
  "sites.read",
  "sites.edit",
  "sites.code",
  "sites.preview",
  "sites.deploy",
  "sites.integrations",
  "servers.manage",
  "domains.manage",
  "ai.configure",
  "ai.use",
  "integrations.configure",
  "revisions.restore"
] as const;

export type Capability = (typeof capabilities)[number];

export interface Actor {
  id: string;
  email: string;
  role: Role;
  /** Independent of role — gates deploying/moving a site onto a server flagged `restricted`. */
  canDeployRestricted?: boolean;
}

const adminCapabilities = new Set<Capability>(capabilities);

/**
 * An editor gets every site-level feature on every site — there's no per-site grant system (one
 * existed in the types before this, but nothing ever populated it, so every editor silently saw
 * zero sites; removed rather than wired up, since the actual requirement is flat access). The
 * only two restrictions an editor has: deploying to a server flagged `restricted` (gated
 * separately by canDeployRestricted, checked directly where a deploy target is resolved — not a
 * capability), and the tool-wide management surfaces below that aren't in this set at all
 * (Team, Servers, Domains/Cloudflare, template library management, global integrations).
 */
const editorCapabilities = new Set<Capability>([
  "sites.create",
  "sites.delete",
  "sites.read",
  "sites.edit",
  "sites.code",
  "sites.preview",
  "sites.deploy",
  "sites.integrations",
  "ai.use",
  "revisions.restore"
]);

export function can(actor: Actor, capability: Capability): boolean {
  if (actor.role === "administrator") return adminCapabilities.has(capability);
  return editorCapabilities.has(capability);
}

export function assertCan(actor: Actor, capability: Capability, siteId?: string): void {
  if (!can(actor, capability)) {
    throw new IgleError("FORBIDDEN", "You do not have permission to perform this action.", 403, {
      capability,
      siteId
    });
  }
}
