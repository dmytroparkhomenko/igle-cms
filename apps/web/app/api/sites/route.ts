import { NextResponse } from "next/server";
import { apiError } from "@igle/shared";
import { runtime } from "../../../lib/runtime";
import { requireActor } from "../../../lib/session";

export async function GET() {
  try {
    return NextResponse.json({ sites: await runtime.siteService.list((await requireActor())) });
  } catch (error) {
    const formatted = apiError(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name: string; slug: string; language?: string; locale?: string };
    const site = await runtime.siteService.createBlankSite(body, (await requireActor()));
    return NextResponse.json({ site }, { status: 201 });
  } catch (error) {
    const formatted = apiError(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
