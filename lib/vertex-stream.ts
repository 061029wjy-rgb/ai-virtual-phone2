import { createSseJsonParser } from "./sse-json";

/** An HTTP 200/EOF is not proof that Vertex finished generating. Hosting
 * adapters can close SSE cleanly at their execution limit, even mid-reply.
 */
export function validateVertexStream(response: Response, started = Date.now()): Response {
    if (!response.ok || !response.body) return response;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = createSseJsonParser();
    let buffer = "";
    let finished = false;
    const inspect = (values: unknown[]) => {
        for (const value of values) {
            const data = value as { error?: { code?: number }; candidates?: { finishReason?: string }[]; promptFeedback?: { blockReason?: string } } | null;
            if (data?.error) {
                const status = Number(data.error.code) || 502;
                throw new Error(`API Stream ${status}: Vertex 在流中返回错误，生成未完成`);
            }
            const reason = data?.candidates?.[0]?.finishReason;
            if ((reason && reason !== "FINISH_REASON_UNSPECIFIED") || data?.promptFeedback?.blockReason) finished = true;
        }
    };
    const drain = () => {
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
            inspect(parser.pushEvent(buffer.slice(0, boundary.index)));
            buffer = buffer.slice(boundary.index + boundary[0].length);
        }
        if (buffer.length > 8_000_000) throw new Error("Vertex 流式响应单条事件过大，连接中断");
    };
    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    buffer += decoder.decode();
                    drain();
                    if (buffer.trim()) inspect(parser.pushEvent(buffer));
                    inspect(parser.flush());
                    if (!finished) throw new Error(`Vertex 流式连接提前中断（${Math.round((Date.now() - started) / 1000)}秒，未收到生成结束标记）。已收到的文字可能不完整，请检查部署平台执行时限及上游连接。`);
                    controller.close();
                    reader.releaseLock();
                } else {
                    buffer += decoder.decode(value, { stream: true });
                    drain();
                    controller.enqueue(value);
                }
            } catch (error) {
                controller.error(error);
                await reader.cancel().catch(() => undefined);
            }
        },
        cancel(reason) { return reader.cancel(reason); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
