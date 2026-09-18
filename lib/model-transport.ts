import { unwrapModelResponse } from "./model-response-tunnel";
import { getVertexCredentials } from "./vertex-config";
import { validateVertexStream } from "./vertex-stream";
/** Shared transport for model discovery and generation. Local servers should use direct mode. */
export function fetchModel(url: string, init: RequestInit, serverProxy = false): Promise<Response> {
    if (url.startsWith("/api/vertex?")) {
        const started = Date.now();
        const id = new URL(url, "http://local").searchParams.get("config") || "";
        const credential = getVertexCredentials(id);
        if (!credential) return Promise.reject(new Error("Vertex 配置已失效，请重新发起请求"));
        return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Phone-Stream": "1" }, signal: init.signal,
            body: JSON.stringify({ ...credential, request: JSON.parse(String(init.body || "{}")) }),
        }).then(unwrapModelResponse).then(response => new URL(url, "http://local").searchParams.get("stream") === "true" ? validateVertexStream(response, started) : response);
    }
    if (!serverProxy) return fetch(url, init);
    return fetch("/api/model-request", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: init.signal,
        body: JSON.stringify({ url, method: init.method || "POST", headers: Object.fromEntries(new Headers(init.headers)), body: init.body }),
    });
}
