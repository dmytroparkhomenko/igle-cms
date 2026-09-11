import fs from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import { JsonStateStore } from "@igle/core";
import { IgleError, resolveInside } from "@igle/shared";

const dataDir = process.env.IGLE_DATA_DIR ?? path.resolve(process.cwd(), "data");
const stateStore = new JsonStateStore(dataDir);
const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true }));

app.get("/:siteId/*", async (request, reply) => {
  const params = request.params as { siteId: string; "*": string };
  const state = await stateStore.read();
  const site = state.sites.find((item) => item.id === params.siteId || item.slug === params.siteId);
  if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);
  const requested = params["*"] || "index.html";
  if (requested === ".igle" || requested.startsWith(".igle/")) throw new IgleError("NOT_FOUND", "File was not found.", 404);
  const filePath = requested.endsWith("/") ? `${requested}index.html` : requested;
  const absolutePath = resolveInside(site.repoPath, filePath);
  const content = await fs.readFile(absolutePath);
  reply.header("Cache-Control", "no-store");
  return reply.send(content);
});

const port = Number(process.env.PREVIEW_PORT ?? 3001);
await app.listen({ host: "0.0.0.0", port });
