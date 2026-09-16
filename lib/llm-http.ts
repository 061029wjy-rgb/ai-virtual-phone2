import { fetchModel } from "./model-transport";
// Unified transport for streaming and non-streaming LLM requests.

import type { LlmRequestPayload } from "./llm-provider-adapter";

export type FetchLlmPayloadOptions = {
    signal?: AbortSignal;
};

export function fetchLlmPayload(
    payload: LlmRequestPayload,
    options: FetchLlmPayloadOptions = {},
): Promise<Response> {
    return fetchModel(payload.url, {
        method: "POST", headers: payload.headers, body: JSON.stringify(payload.body), signal: options.signal,
    }, payload.serverProxy);
}
