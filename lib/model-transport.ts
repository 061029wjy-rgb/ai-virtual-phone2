/** Shared transport for model discovery and generation. Local servers should use direct mode. */
export function fetchModel(url: string, init: RequestInit, serverProxy = false): Promise<Response> {
    if (!serverProxy) return fetch(url, init);
    return fetch("/api/model-request", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: init.signal,
        body: JSON.stringify({ url, method: init.method || "POST", headers: Object.fromEntries(new Headers(init.headers)), body: init.body }),
    });
}
