import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../../../lib/runtime";

export async function POST(_request: Request, context: { params: Promise<{ siteId: string; revisionNumber: string }> }) {
  try {
    const { siteId, revisionNumber } = await context.params;
    const site = await runtime.siteService.get(siteId, runtime.systemActor);
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);
    const revision = await runtime.revisionService.restore(site, Number(revisionNumber), {
      id: runtime.systemActor.id,
      name: runtime.systemActor.email,
      email: runtime.systemActor.email
    });
    return NextResponse.json({ revision });
  } catch (error) {
    const formatted = apiError(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
