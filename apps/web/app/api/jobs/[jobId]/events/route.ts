import { runtime } from "../../../../../lib/runtime";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const current = await runtime.jobService.get(jobId);
      if (current) controller.enqueue(encoder.encode(`event: progress\ndata: ${JSON.stringify(current)}\n\n`));
      const unsubscribe = runtime.jobService.subscribe(jobId, (job) => {
        controller.enqueue(encoder.encode(`event: progress\ndata: ${JSON.stringify(job)}\n\n`));
        if (["success", "failed", "cancelled"].includes(job.status)) {
          unsubscribe();
          controller.close();
        }
      });
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
