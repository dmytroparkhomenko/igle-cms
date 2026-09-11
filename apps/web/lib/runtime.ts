import path from "node:path";
import { AuthService } from "../../../packages/core/src/auth-service";
import { DraftService } from "../../../packages/core/src/draft-service";
import { ImportService } from "../../../packages/core/src/import-service";
import { JobService } from "../../../packages/core/src/job-service";
import { RevisionService } from "../../../packages/core/src/revision-service";
import { SEOService } from "../../../packages/core/src/seo-service";
import { SiteService } from "../../../packages/core/src/site-service";
import { JsonStateStore } from "../../../packages/core/src/state-store";
import type { Actor } from "@igle/shared";

const dataDir = process.env.IGLE_DATA_DIR ?? path.resolve(process.cwd(), "data");
const stateStore = new JsonStateStore(dataDir);
const revisionService = new RevisionService(stateStore);
const siteService = new SiteService(dataDir, stateStore, revisionService);
const importService = new ImportService(stateStore, revisionService);
const seoService = new SEOService(stateStore, revisionService);
const authService = new AuthService(stateStore);
const draftService = new DraftService(stateStore);
const jobService = new JobService(stateStore);

const systemActor: Actor = {
  id: "system",
  email: "system@igle.local",
  role: "administrator"
};

async function createDemoSite() {
  "use server";
  await siteService.createBlankSite({ name: "Demo Site", slug: `demo-${Date.now()}` }, systemActor);
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
  systemActor,
  createDemoSite
};
