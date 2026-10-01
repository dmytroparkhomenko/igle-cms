import { runtime } from "../../../../lib/runtime";
import { requireActor } from "../../../../lib/session";

/**
 * Live feed of the process-wide deploy queue (see DeployQueueService) — every connected viewer sees
 * the same global queue, not one scoped to a single site, so this has no per-site permission check
 * beyond being signed in. Same text/event-stream shape as the existing jobs/collab feeds — no new
 * transport, no new auth.
 */
export async function GET() {
  await requireActor();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(runtime.deployQueueService.snapshot())}\n\n`));
      unsubscribe = runtime.deployQueueService.subscribe((snapshot) => {
        controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
      });
    },
    cancel() {
      unsubscribe?.();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
