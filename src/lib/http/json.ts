import { NextResponse } from "next/server";

export function okItem<T>(item: T, status = 200) {
  return NextResponse.json({ item }, { status });
}

export function okItems<T>(items: T[], status = 200) {
  return NextResponse.json({ items }, { status });
}

export function okSuccess(status = 200) {
  return NextResponse.json({ success: true }, { status });
}
