import { keepAliveModelResponse } from "@/lib/model-response-tunnel";
import { isSameOriginRequest } from "@/lib/same-origin-request";
import { sendVertexRequest, VertexError } from "@/lib/vertex-server";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
    const url = new URL(request.url);
    if (!isSameOriginRequest(request)) return Response.json({ error: { message: "不允许跨站调用" } }, { status: 403 });
    const execute = async (signal: AbortSignal) => {
        try {
            const input = await request.json();
            if (!input || typeof input !== "object" || Array.isArray(input)) throw new VertexError("请求格式不正确");
            const response = await sendVertexRequest(url.searchParams, input, AbortSignal.any([signal, AbortSignal.timeout(240_000)]));
            return new Response(response.body, { status: response.status, headers: {
                "Content-Type": response.headers.get("content-type") || "application/json", "Cache-Control": "no-store", "X-Accel-Buffering": "no",
            } });
        } catch (error) {
            const timeout = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
            return Response.json({ error: { code: error instanceof VertexError ? error.code : undefined, message: error instanceof VertexError ? error.message : timeout ? "Vertex 请求超时或已取消" : "Vertex 连接失败，请检查服务器到 Google 的网络连接" } }, { status: error instanceof VertexError ? error.status : timeout ? 504 : 502, headers: { "Cache-Control": "no-store" } });
        }
    };
    // The client header advertises decoding support, not deployment support.
    // Early streaming can be cut off by hosting adapters even while heartbeats
    // are flowing. Keep the original JSON/SSE relay as the safe default.
    return process.env.VERTEX_RESPONSE_TUNNEL === "true" && request.headers.get("x-phone-stream") === "1"
        ? keepAliveModelResponse(execute, request.signal)
        : execute(request.signal);
}
