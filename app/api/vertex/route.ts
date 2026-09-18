import { randomUUID } from "node:crypto";
import { traceVertexBody, vertexTransportError } from "@/lib/vertex-response-trace";
import { keepAliveModelResponse } from "@/lib/model-response-tunnel";
import { isSameOriginRequest } from "@/lib/same-origin-request";
import { sendVertexRequest, VertexError } from "@/lib/vertex-server";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
    const url = new URL(request.url);
    if (!isSameOriginRequest(request)) return Response.json({ error: { message: "不允许跨站调用" } }, { status: 403 });
    const traceId = randomUUID();
    const started = Date.now();
    const emit = (event: string, fields: Record<string, string | number> = {}) => {
        console.info(JSON.stringify({ scope: "vertex_transport", traceId, event, elapsedMs: Date.now() - started, ...fields }));
    };
    const execute = async (signal: AbortSignal) => {
        try {
            const input = await request.json();
            if (!input || typeof input !== "object" || Array.isArray(input)) throw new VertexError("请求格式不正确");
            emit("request_start", { stream: url.searchParams.get("stream") === "true" ? 1 : 0 });
            const response = await sendVertexRequest(url.searchParams, input, AbortSignal.any([signal, AbortSignal.timeout(240_000)]));
            emit("upstream_headers", { status: response.status });
            return new Response(traceVertexBody(response.body, emit), { status: response.status, headers: {
                "X-Vertex-Trace-Id": traceId,
                "Content-Type": response.headers.get("content-type") || "application/json", "Cache-Control": "no-store", "X-Accel-Buffering": "no",
                ...(response.headers.has("retry-after") ? { "Retry-After": response.headers.get("retry-after")! } : {}),
            } });
        } catch (error) {
            emit("request_error", vertexTransportError(error));
            const timeout = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
            return Response.json({ error: { code: error instanceof VertexError ? error.code : undefined, message: error instanceof VertexError ? error.message : timeout ? "Vertex 请求超时或已取消" : "Vertex 连接失败，请检查服务器到 Google 的网络连接" } }, { status: error instanceof VertexError ? error.status : timeout ? 504 : 502, headers: { "Cache-Control": "no-store", "X-Vertex-Trace-Id": traceId } });
        }
    };
    // The client header advertises decoding support, not deployment support.
    // Early streaming can be cut off by hosting adapters even while heartbeats
    // are flowing. Keep the original JSON/SSE relay as the safe default.
    return process.env.VERTEX_RESPONSE_TUNNEL === "true" && request.headers.get("x-phone-stream") === "1"
        ? keepAliveModelResponse(execute, request.signal)
        : execute(request.signal);
}
