import type { ApiConfig } from "./settings-types";
import { buildProviderRequest, parseProviderResponse, type LlmRequestMessage } from "./llm-provider-adapter";
import { fetchLlmPayload } from "./llm-http";

/** Exercise the same non-streaming transport as chat, with an inert test tool. */
export async function testModelTools(config: ApiConfig, fetcher = fetchLlmPayload): Promise<string> {
    const started = Date.now();
    const tools = [{ name: "phone_connection_probe", description: "Return the connection test result. This is a diagnostic tool with no side effects.", parameters: { type: "object", properties: {}, required: [] } }];
    const messages: LlmRequestMessage[] = [{ role: "user", content: "请调用 phone_connection_probe 一次。收到工具结果后，仅回复工具返回的 status，不要再次调用工具。" }];
    const signal = AbortSignal.timeout(240_000);
    const request = async () => {
        const payload = buildProviderRequest(config, null, messages, { tools, maxTokens: 4096 });
        const response = await fetcher(payload, { signal });
        if (!response.ok) throw new Error(`API Tool Error ${response.status}: ${await response.text()}`);
        return parseProviderResponse(payload.providerKind, await response.json());
    };
    const first = await request();
    const firstSeconds = ((Date.now() - started) / 1000).toFixed(1);
    if (first.toolCalls.length !== 1 || first.toolCalls[0].name !== tools[0].name) throw new Error(`首轮请求已返回（${firstSeconds}秒），但模型未按要求调用测试工具，工具链尚未验证。`);
    messages.push({ role: "assistant", content: first.content, toolCalls: first.toolCalls });
    messages.push({ role: "tool", name: tools[0].name, toolCallId: first.toolCalls[0].id, content: JSON.stringify({status:"PHONE_TOOL_OK"}) });
    const second = await request();
    if (second.toolCalls.length || !second.content.includes("PHONE_TOOL_OK")) throw new Error("工具调用成功，但回传结果后的最终回复不符合预期。");
    return `工具测试成功：首轮 ${firstSeconds}秒，两轮合计 ${((Date.now() - started) / 1000).toFixed(1)}秒；非流式工具调用与结果回传均正常。`;
}
