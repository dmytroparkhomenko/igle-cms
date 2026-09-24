import { IgleError } from "@igle/shared";
import type { SiteRecord } from "./types.js";

/**
 * Refuses any content-mutating action on a locked site — a dynamic/database-driven install
 * (WordPress, MODX, other PHP apps) Igle CMS only ever sees a stale file snapshot of. Deploying
 * that snapshot would overwrite or, on CloudPanel, entirely delete the real live install (see
 * CloudPanelProvider.deployBuild's `rm -rf <documentRoot>/*`). Called at every service-layer
 * entry point that writes to a site's repo, deploys it, or imports over it — never at read paths.
 */
export function assertSiteEditable(site: SiteRecord): void {
  if (site.metadata.contentLocked) {
    throw new IgleError("SITE_CONTENT_LOCKED", site.metadata.contentLockReason ?? "This site is locked and cannot be edited or deployed.", 409, {
      siteId: site.id,
      platform: site.metadata.platform
    });
  }
}
