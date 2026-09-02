import { NextResponse } from "next/server";

import { readStreamStatus } from "@/lib/status";

/** Polled by the ledger tick and the live surface. */
export async function GET() {
  const status = await readStreamStatus();
  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45",
    },
  });
}
