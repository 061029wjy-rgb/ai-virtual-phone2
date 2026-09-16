/** Browser-generated Fetch Metadata survives reverse proxies that rewrite request.url.
 * Do not trust arbitrary forwarded-host headers or allow sibling subdomains.
 */
export function isSameOriginRequest(request: Request): boolean {
    const site = request.headers.get("sec-fetch-site");
    if (site === "cross-site" || site === "same-site") return false;
    const origin = request.headers.get("origin");
    if (origin === "null") return false;
    if (site === "same-origin") return true;
    // Older clients and non-browser integrations retain the original origin check.
    if (!origin) return true;
    try {
        const parsed = new URL(origin);
        return parsed.origin === origin && origin === new URL(request.url).origin;
    } catch { return false; }
}
