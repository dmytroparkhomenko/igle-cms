import path from "node:path";
import { AuthService } from "../../../packages/core/src/auth-service";
import { DeployService } from "../../../packages/core/src/deploy-service";
import { DraftService } from "../../../packages/core/src/draft-service";
import { ImportService } from "../../../packages/core/src/import-service";
import { JobService } from "../../../packages/core/src/job-service";
import { MediaService } from "../../../packages/core/src/media-service";
import { PageService } from "../../../packages/core/src/page-service";
import { RedirectService } from "../../../packages/core/src/redirect-service";
import { RevisionService } from "../../../packages/core/src/revision-service";
import { ScriptService } from "../../../packages/core/src/script-service";
import { SEOService } from "../../../packages/core/src/seo-service";
import { ServerService } from "../../../packages/core/src/server-service";
import { SiteService } from "../../../packages/core/src/site-service";
import { JsonStateStore } from "../../../packages/core/src/state-store";
import { TemplateService } from "../../../packages/core/src/template-service";
import { TicketService } from "../../../packages/core/src/ticket-service";
import { VerificationService } from "../../../packages/core/src/verification-service";

const dataDir = process.env.IGLE_DATA_DIR ?? path.resolve(process.cwd(), "data");
const templatesDir = process.env.IGLE_TEMPLATES_DIR ?? path.resolve(process.cwd(), "../../templates");
const customTemplatesDir = path.join(dataDir, "custom-templates");
const stateStore = new JsonStateStore(dataDir);
const revisionService = new RevisionService(stateStore);
const siteService = new SiteService(dataDir, stateStore, revisionService);
const importService = new ImportService(stateStore, revisionService);
const seoService = new SEOService(stateStore, revisionService);
const authService = new AuthService(stateStore);
const draftService = new DraftService(stateStore);
const jobService = new JobService(stateStore);
const mediaService = new MediaService();
const pageService = new PageService(stateStore, revisionService);
const ticketService = new TicketService(stateStore);
const serverService = new ServerService(stateStore);
const deployService = new DeployService(dataDir, stateStore, revisionService, serverService);
const redirectService = new RedirectService(revisionService);
const scriptService = new ScriptService(revisionService);
const templateService = new TemplateService(templatesDir, customTemplatesDir, dataDir, stateStore, revisionService);
const verificationService = new VerificationService(revisionService);

// First-run bootstrap: with no users yet, ADMIN_EMAIL/ADMIN_PASSWORD (set once in .env) creates
// the first administrator and seeds the shared team password. A no-op on every run after that.
const bootstrapAdminEmail = process.env.ADMIN_EMAIL?.trim();
const bootstrapAdminPassword = process.env.ADMIN_PASSWORD;
if (bootstrapAdminEmail && bootstrapAdminPassword) {
  void authService.bootstrapFirstAdminIfNeeded(bootstrapAdminEmail, bootstrapAdminPassword).catch((error: unknown) => {
    console.error("Failed to bootstrap first administrator:", error);
  });
}

// Legacy single-server config (pre-multi-server): if AAPANEL_BASE_URL/AAPANEL_API_KEY are set in
// .env, register them as an (unrestricted) ServerRecord on first run and backfill any site that
// was already deploying to it. New servers going forward are registered through /servers instead.
const legacyAapanelBaseUrl = process.env.AAPANEL_BASE_URL?.trim();
const legacyAapanelApiKey = process.env.AAPANEL_API_KEY?.trim();
if (legacyAapanelBaseUrl && legacyAapanelApiKey) {
  void serverService.ensureLegacyServer("Primary server", legacyAapanelBaseUrl, legacyAapanelApiKey).catch((error: unknown) => {
    console.error("Failed to register the legacy aaPanel server:", error);
  });
}

export const runtime = {
  dataDir,
  stateStore,
  revisionService,
  siteService,
  importService,
  seoService,
  authService,
  draftService,
  jobService,
  mediaService,
  pageService,
  ticketService,
  deployService,
  redirectService,
  scriptService,
  templateService,
  verificationService,
  serverService
};
