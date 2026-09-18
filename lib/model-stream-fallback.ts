/** Switching wire formats cannot fix auth, capacity or gateway failures.
 * Keep the original error instead of immediately repeating the same generation.
 * Existing engines wrap HTTP errors in their own Error classes, so accept their
 * shared API error prefix as well as a structured status.
 */
export function shouldFallbackToNonStreaming(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const status = Number((error as { status?: unknown } | null)?.status)
        || Number(message.match(/\bAPI(?:\s+[A-Za-z]+)*\s+(\d{3})\s*:/)?.[1]);
    if (status) return [400, 404, 405, 406, 415, 422, 501].includes(status);
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return false;
    return !/超时|中断|连接失败|连接失效|API Key 为空|尚未导入|配置已失效|fetch failed|failed to fetch|network error|networkerror|load failed/i.test(message);
}
