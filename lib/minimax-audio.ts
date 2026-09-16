/** Accept the service root, /v1 base, or full T2A endpoint without duplicating paths. */
export function minimaxSpeechUrl(base = "https://api.minimaxi.com/v1"): string {
    const url = new URL(base.trim() || "https://api.minimaxi.com/v1");
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("MiniMax 地址必须是 HTTP 或 HTTPS");
    let pathname = url.pathname.replace(/\/+$/, "") || "/v1";
    if (!pathname.endsWith("/t2a_v2")) pathname += "/t2a_v2";
    url.pathname = pathname;
    return url.href;
}

export function decodeMinimaxAudio(data: { base_resp?: { status_code?: number | string; status_msg?: string }; data?: { audio?: unknown } }): Blob {
    const status = data.base_resp?.status_code;
    if (status !== undefined && String(status) !== "0") {
        throw new Error(`MiniMax (${status}): ${data.base_resp?.status_msg || "语音合成失败"}`);
    }
    const hex = data.data?.audio;
    if (typeof hex !== "string" || !hex.length) throw new Error("MiniMax 未返回音频，请检查模型、音色及账户权限");
    if (hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) throw new Error("MiniMax 返回的音频不是有效的 hex 数据，请检查中转协议");
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    return new Blob([bytes], { type: "audio/mpeg" });
}
