import { NextResponse } from "next/server";
import { apiError } from "@igle/shared";
import { runtime } from "../../../lib/runtime";

export async function POST() {
  try {
    const job = await runtime.jobService.demoJob();
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const formatted = apiError(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
