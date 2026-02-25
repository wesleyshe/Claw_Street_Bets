import { NextResponse } from "next/server";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function fail(error: string, hint: string, status: number) {
  return NextResponse.json({ success: false, error, hint }, { status });
}
