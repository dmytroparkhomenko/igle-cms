import { assertCan, IgleError } from "@igle/shared";
import { runtime } from "../../../../../../../../lib/runtime";
import { requireActor } from "../../../../../../../../lib/session";

/**
 * Real-time co-editing feed for one page's visual editor — see CollabService. Each connected tab
 * is one "participant"; this stream tells it who else is in the room and what each of them has
 * currently queued (not yet saved), live, so nobody's unsaved work is ever invisible to — or
 * discarded by — anyone else's Save. Same `text/event-stream` shape as the existing job-progress
 * feed (apps/web/app/api/jobs/[jobId]/events/route.ts) — no new transport, no new auth.
 */
export async function GET(request: Request, context: { params: Promise<{ siteId: string; pageId: string }> }) {
  const { siteId, pageId } = await context.params;
  const actor = await requireActor();
  const site = await runtime.siteService.get(siteId, actor);
  if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);
  assertCan(actor, "sites.edit", site.id);

  const { connectionId, color } = runtime.collabService.join(site.id, pageId, actor);
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ connectionId, color })}\n\n`));
      controller.enqueue(
        encoder.encode(`event: snapshot\ndata: ${JSON.stringify(runtime.collabService.snapshot(site.id, pageId))}\n\n`)
      );
      unsubscribe = runtime.collabService.subscribe(site.id, pageId, (snapshot) => {
        controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
      });
    }
  });

  request.signal.addEventListener("abort", () => {
    unsubscribe?.();
    runtime.collabService.leave(site.id, pageId, connectionId);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
