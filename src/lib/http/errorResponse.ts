import { NextResponse } from "next/server";

type ErrorResponseOptions = {
  details?: unknown;
  headers?: HeadersInit;
};

export function errorResponse(
  error: string,
  status = 400,
  options: ErrorResponseOptions = {}
) {
  const payload: { error: string; details?: unknown } = { error };
  if (options.details !== undefined) {
    payload.details = options.details;
  }

  return NextResponse.json(payload, {
    status,
    headers: options.headers,
  });
}
