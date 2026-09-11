import { NextResponse } from "next/server";
import { apiError } from "@igle/shared";
import { runtime } from "../../../lib/runtime";

export async function GET() {
  try {
    return NextResponse.json({ sites: await runtime.siteService.list(runtime.systemActor) });
  } catch (error) {
    const formatted = apiError(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name: string; slug: string; language?: string; locale?: string };
    const site = await runtime.siteService.createBlankSite(body, runtime.systemActor);
    return NextResponse.json({ site }, { status: 201 });
  } catch (error) {
    const formatted = apiError(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
