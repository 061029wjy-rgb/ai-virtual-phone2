import { proxyFetch } from "@/lib/proxy-fetch";

export const runtime = "nodejs";
export const maxDuration = 300;

// Restrict the relay to known services or explicit administrator opt-in targets.
const DEFAULT_HOSTS = ["api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com", "api.deepseek.com", "api.groq.com", "openrouter.ai", "api.moonshot.cn", "open.bigmodel.cn", "api.siliconflow.cn", "api.together.xyz", "api.mistral.ai", "api.x.ai", "api.minimax.io", "api.minimaxi.com", "api-uw.minimax.io"];

export async function POST(request: Request) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: { message: "不允许跨站调用" } }, { status: 403 });
    try {
        const input = await request.json();
        const url = new URL(input.url);
        const allowed = new Set([...DEFAULT_HOSTS, ...(process.env.MODEL_PROXY_ALLOWED_HOSTS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)]);
        if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !allowed.has(url.hostname)) {
            return Response.json({ error: { message: "此地址未启用服务端转发，请使用浏览器直连，或由部署者设置 MODEL_PROXY_ALLOWED_HOSTS。" } }, { status: 400 });
        }
        if (input.method !== "GET" && input.method !== "POST") return Response.json({ error: { message: "不支持的请求方法" } }, { status: 400 });
        const headers = new Headers(input.headers);
        for (const key of [...headers.keys()]) {
            if (["host", "cookie", "connection", "content-length", "transfer-encoding", "origin", "referer"].includes(key) || key.startsWith("proxy-") || key.startsWith("sec-")) headers.delete(key);
        }
        const upstream = await proxyFetch(url.href, {
            method: input.method, headers, body: input.method === "GET" ? undefined : input.body,
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(240_000)]), redirect: "error",
        });
        return new Response(upstream.body, { status: upstream.status, headers: {
            "Content-Type": upstream.headers.get("content-type") || "application/json",
            "Cache-Control": "no-store", "X-Accel-Buffering": "no",
        } });
    } catch (error) {
        const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
        return Response.json({ error: { message: timeout ? "上游请求超时或已取消" : "服务端连接失败，请检查地址、网络和请求格式" } }, { status: timeout ? 504 : 502 });
    }
}
