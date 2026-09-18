// Only transport metadata is logged: never credentials, prompts, or response text.
export function traceVertexBody(
    body: ReadableStream<Uint8Array> | null,
    emit: (event: string, fields: Record<string, string | number>) => void,
): ReadableStream<Uint8Array> | null {
    if (!body) { emit("body_end", { bytes: 0 }); return null; }
    const reader = body.getReader();
    let bytes = 0;
    let ended = false;
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const chunk = await reader.read();
                if (ended) return;
                if (chunk.done) {
                    ended = true;
                    emit("body_end", { bytes });
                    reader.releaseLock();
                    controller.close();
                } else {
                    bytes += chunk.value.byteLength;
                    controller.enqueue(chunk.value);
                }
            } catch (error) {
                if (ended) return;
                ended = true;
                emit("body_error", { bytes, ...vertexTransportError(error) });
                reader.releaseLock();
                controller.error(error);
            }
        },
        async cancel(reason) {
            ended = true;
            emit("body_cancel", { bytes });
            try { await reader.cancel(reason); } finally { reader.releaseLock(); }
        },
    });
}

export function vertexTransportError(error: unknown): Record<string, string> {
    const safeToken = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : "unknown";
    const err = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
    return { errorName: safeToken(err?.name), errorCode: safeToken(err?.cause?.code ?? err?.code) };
}
