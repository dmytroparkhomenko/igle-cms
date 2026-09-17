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
  "servers.manage",
  "ai.configure",
  "ai.use",
  "integrations.configure",
  "revisions.restore"
] as const;

export type Capability = (typeof capabilities)[number];

export interface SiteGrant {
  siteId: string;
  canEditCode: boolean;
  canDeploy: boolean;
}

export interface Actor {
  id: string;
  email: string;
  role: Role;
  siteGrants?: SiteGrant[];
  /** Independent of role — gates deploying/moving a site onto a server flagged `restricted`. */
  canDeployRestricted?: boolean;
}

const adminCapabilities = new Set<Capability>(capabilities);

const editorBaseCapabilities = new Set<Capability>([
  "sites.read",
  "sites.edit",
  "sites.preview",
  "ai.use",
  "revisions.restore"
]);

export function can(actor: Actor, capability: Capability, siteId?: string): boolean {
  if (actor.role === "administrator") return adminCapabilities.has(capability);

  if (!editorBaseCapabilities.has(capability) && capability !== "sites.code" && capability !== "sites.deploy") {
    return false;
  }

  if (!siteId) return editorBaseCapabilities.has(capability);

  const grant = actor.siteGrants?.find((item) => item.siteId === siteId);
  if (!grant) return false;

  if (capability === "sites.code") return grant.canEditCode;
  if (capability === "sites.deploy") return grant.canDeploy;

  return editorBaseCapabilities.has(capability);
}

export function assertCan(actor: Actor, capability: Capability, siteId?: string): void {
  if (!can(actor, capability, siteId)) {
    throw new IgleError("FORBIDDEN", "You do not have permission to perform this action.", 403, {
      capability,
      siteId
    });
  }
}
