import { createHash, createSign } from "node:crypto";
import { proxyFetch } from "./proxy-fetch";
import { parseVertexServiceAccount, type VertexServiceAccount } from "./vertex-config";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const tokens = new Map<string, { token: string; expires: number }>();
export class VertexError extends Error {
    constructor(message: string, public status = 400, public code?: string) { super(message); }
}

async function fetchVertexStage(stage: "oauth" | "model", url: string, init: RequestInit, fetcher: typeof proxyFetch): Promise<Response> {
    const started = Date.now();
    const label = stage === "oauth" ? "Google 鉴权" : "Google 模型";
    let response: Response;
    try { response = await fetcher(url, init); }
    catch (error) {
        if (init.signal?.aborted && init.signal.reason?.name === "AbortError") throw error;
        const timedOut = init.signal?.reason?.name === "TimeoutError" || (error instanceof Error && error.name === "TimeoutError");
        throw new VertexError(`${label}阶段${timedOut ? "等待超时" : "连接失败"}（${Math.round((Date.now() - started) / 1000)}秒）。请检查部署服务器到 Google 的网络与代理。`, timedOut ? 504 : 502, `vertex_${stage}_${timedOut ? "timeout" : "network"}`);
    }
    if (response.status === 504 || (stage === "oauth" && response.status >= 500)) {
        // Do not echo upstream HTML, URLs with keys, or OAuth response bodies.
        void response.body?.cancel().catch(() => undefined);
        throw new VertexError(`${label}上游返回 HTTP ${response.status}（${Math.round((Date.now() - started) / 1000)}秒）。错误来自服务器到 Google 的请求链路，请检查上游服务或出网代理；浏览器侧保活无法消除这一段超时。`, response.status, `vertex_${stage}_upstream_${response.status}`);
    }
    return response;
}

export async function vertexAccessToken(account: VertexServiceAccount, signal: AbortSignal, fetcher = proxyFetch): Promise<string> {
    const cacheKey = createHash("sha256").update(account.client_email).update(account.private_key).digest("hex");
    const cached = tokens.get(cacheKey);
    if (cached && cached.expires > Date.now() + 60_000) return cached.token;
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${encode({ alg: "RS256", typ: "JWT", ...(account.private_key_id ? { kid: account.private_key_id } : {}) })}.${encode({ iss: account.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: TOKEN_URL, iat: now, exp: now + 3600 })}`;
    let signature: string;
    try { signature = createSign("RSA-SHA256").update(input).sign(account.private_key, "base64url"); }
    catch { throw new VertexError("服务账号私钥无效，请重新导入原始 JSON 文件"); }
    const response = await fetchVertexStage("oauth", TOKEN_URL, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, redirect: "error", signal,
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${input}.${signature}` }),
    }, fetcher);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result.access_token !== "string") {
        throw new VertexError("Google 服务账号鉴权失败，请检查密钥是否有效、账号是否启用以及服务器时间", 401);
    }
    // Bounded per-process cache, separated by credential. Tokens never return to the browser.
    if (tokens.size >= 100) tokens.delete(tokens.keys().next().value!);
    tokens.set(cacheKey, { token: result.access_token, expires: Date.now() + Math.min(3600, Math.max(0, Number(result.expires_in) || 0)) * 1000 });
    return result.access_token;
}

export async function sendVertexRequest(query: URLSearchParams, input: Record<string, unknown>, signal: AbortSignal, fetcher = proxyFetch): Promise<Response> {
    const mode = query.get("mode") || "full";
    const location = query.get("location") || "global";
    const model = query.get("model") || "";
    const project = query.get("project") || "";
    if (!["full", "express"].includes(mode) || !/^(global|[a-z]+(?:-[a-z0-9]+)+[0-9])$/.test(location) || !/^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,199}$/.test(model)) throw new VertexError("Vertex 模式、区域或模型 ID 格式不正确");
    if (mode === "full" && !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(project)) throw new VertexError("请填写有效的 Google Cloud 项目 ID");
    if (!input.request || typeof input.request !== "object" || Array.isArray(input.request)) throw new VertexError("请求内容无效");
    const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
    const resource = mode === "full" ? `projects/${encodeURIComponent(project)}/locations/${location}/publishers/google` : "publishers/google";
    const stream = query.get("stream") === "true";
    const url = new URL(`https://${host}/v1/${resource}/models/${encodeURIComponent(model)}:${stream ? "streamGenerateContent" : "generateContent"}`);
    if (stream) url.searchParams.set("alt", "sse");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (mode === "full") {
        let account: VertexServiceAccount;
        try { account = parseVertexServiceAccount(JSON.stringify(input.serviceAccount)); }
        catch { throw new VertexError("缺少有效的服务账号 JSON，请在模型设置中重新导入"); }
        headers.Authorization = `Bearer ${await vertexAccessToken(account, signal, fetcher)}`;
    } else {
        if (typeof input.apiKey !== "string" || !input.apiKey.trim()) throw new VertexError("Vertex Express 需要 API Key");
        url.searchParams.set("key", input.apiKey.trim());
    }
    return fetchVertexStage("model", url.href, { method: "POST", headers, body: JSON.stringify(input.request), signal, redirect: "error" }, fetcher);
}
