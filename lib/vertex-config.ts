import type { ApiConfig } from "./settings-types";

export function isVertexConfig(config: ApiConfig): boolean {
    return config.protocol === "vertex" || ((!config.protocol || config.protocol === "auto") && config.provider === "VertexAI");
}

export type VertexServiceAccount = { type: "service_account"; project_id: string; client_email: string; private_key: string; private_key_id?: string };
export function parseVertexServiceAccount(text: string): VertexServiceAccount {
    const normalized = text.replace(/^\uFEFF/, "").trim();
    if (!normalized) throw new Error("尚未导入服务账号：请选择 JSON 文件，或粘贴完整 JSON 后保存。仅填写模型名称无法连接 Vertex 完整模式");
    let value;
    try { value = JSON.parse(normalized); } catch { throw new Error("服务账号 JSON 格式不正确"); }
    if (!value || value.type !== "service_account" || typeof value.project_id !== "string" || typeof value.client_email !== "string" || !value.client_email.includes("@") || typeof value.private_key !== "string" || !value.private_key.includes("PRIVATE KEY")) {
        throw new Error("请选择 Google Cloud 服务账号 JSON（需要 project_id、client_email 和 private_key）");
    }
    // Never use token_uri or other destinations supplied by an imported file.
    return { type: "service_account", project_id: value.project_id, client_email: value.client_email, private_key: value.private_key, ...(typeof value.private_key_id === "string" ? { private_key_id: value.private_key_id } : {}) };
}

// Credentials only enter transport at send time; prompt/debug/offline request snapshots contain no private key.
const credentials = new Map<string, { serviceAccount?: VertexServiceAccount; apiKey?: string }>();
export function vertexRequestUrl(config: ApiConfig, stream = false): string {
    const mode = config.vertexMode || "full";
    const serviceAccount = mode === "full" ? parseVertexServiceAccount(config.vertexServiceAccount || "") : undefined;
    if (mode === "express" && !config.apiKey.trim()) throw new Error("Vertex Express 需要 API Key");
    const project = config.vertexProject?.trim() || serviceAccount?.project_id || "";
    const location = config.vertexLocation?.trim() || "global";
    credentials.set(config.id, serviceAccount ? { serviceAccount } : { apiKey: config.apiKey.trim() });
    const query = new URLSearchParams({ config: config.id, mode, project, location, model: config.defaultModel.trim(), stream: String(stream) });
    return `/api/vertex?${query}`;
}
export function getVertexCredentials(id: string) { return credentials.get(id); }
