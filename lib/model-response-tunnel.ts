/** Internal text-response framing: keep the deployment connection active while Google thinks. */
export function keepAliveModelResponse(run: (signal: AbortSignal) => Promise<Response>, signal: AbortSignal, intervalMs = 10_000): Response {
    const abort = new AbortController();
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setInterval>;
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            const write = (event: unknown) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
            // Flush headers immediately, including while OAuth and upstream response headers are pending.
            controller.enqueue(encoder.encode("\n"));
            timer = setInterval(() => controller.enqueue(encoder.encode("\n")), intervalMs);
            void (async () => {
                let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
                try {
                    const response = await run(AbortSignal.any([signal, abort.signal]));
                    write({ type: "head", status: response.status, contentType: response.headers.get("content-type"), retryAfter: response.headers.get("retry-after") });
                    reader = response.body?.getReader();
                    const decoder = new TextDecoder();
                    if (reader) while (true) {
                        const part = await reader.read();
                        if (part.done) break;
                        const text = decoder.decode(part.value, { stream: true });
                        if (text) write({ type: "data", text });
                    }
                    const tail = decoder.decode();
                    if (tail) write({ type: "data", text: tail });
                    write({ type: "end" });
                } catch {
                    if (!abort.signal.aborted) write({ type: "error", message: "模型连接中断或超时，请检查部署平台时限和到 Google 的网络" });
                } finally {
                    clearInterval(timer);
                    await reader?.cancel().catch(() => undefined);
                    if (!abort.signal.aborted) controller.close();
                }
            })();
        },
        cancel(reason) { clearInterval(timer); abort.abort(reason); },
    });
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no", "X-Phone-Response-Tunnel": "1" } });
}

export async function unwrapModelResponse(response: Response): Promise<Response> {
    if (response.headers.get("x-phone-response-tunnel") !== "1") {
        if (response.status === 504 && !response.headers.get("content-type")?.includes("application/json")) {
            void response.body?.cancel().catch(() => undefined);
            return Response.json({ error: { code: "vertex_relay_unframed_504", message: "Vertex 请求链路返回 504。请结合部署日志检查上游、托管平台和代理；仅凭此错误不能确认 Google 是否已收到请求。" } }, { status: 504 });
        }
        return response;
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("模型转发响应为空");
    const decoder = new TextDecoder();
    let buffer = "";
    const started = Date.now();
    let receivedBytes = 0;
    let receivedHead = false;
    const next = async (): Promise<any> => {
        while (true) {
            const boundary = buffer.indexOf("\n");
            if (boundary >= 0) {
                const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
                if (line.trim()) return JSON.parse(line);
                continue;
            }
            const chunk = await reader.read();
            if (chunk.done) throw new Error(`模型保活连接提前中断（${Math.round((Date.now() - started) / 1000)}秒，收到 ${receivedBytes} 字节，${receivedHead ? "已收到上游状态" : "未收到上游状态"}）。未收到完整结束标记；可能是传输兼容性或连接被终止，请先关闭部署端 VERTEX_RESPONSE_TUNNEL 后重试。`);
            receivedBytes += chunk.value.byteLength;
            buffer += decoder.decode(chunk.value, { stream: true });
        }
    };
    try {
        const head = await next();
        if (head.type === "error") throw new Error(head.message);
        if (head.type !== "head" || !Number.isInteger(head.status) || head.status < 200 || head.status > 599) throw new Error("模型转发响应格式错误");
        receivedHead = true;
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
                try {
                    const event = await next();
                    if (event.type === "end") { controller.close(); await reader.cancel(); }
                    else if (event.type === "data" && typeof event.text === "string") controller.enqueue(encoder.encode(event.text));
                    else throw new Error(event.message || "模型转发响应格式错误");
                } catch (error) { controller.error(error); await reader.cancel().catch(() => undefined); }
            },
            cancel(reason) { return reader.cancel(reason); },
        });
        if ([204, 205, 304].includes(head.status)) { await reader.cancel(); return new Response(null, {status:head.status}); }
        return new Response(body, { status: head.status, headers: { "Content-Type": head.contentType || "application/json", ...(typeof head.retryAfter === "string" ? { "Retry-After": head.retryAfter } : {}) } });
    } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
}
