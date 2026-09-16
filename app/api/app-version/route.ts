import { PHONE_BUILD_SHA } from "@/lib/phone-update";
export const dynamic = "force-dynamic";
export function GET() {
    return Response.json({ sha: PHONE_BUILD_SHA }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
