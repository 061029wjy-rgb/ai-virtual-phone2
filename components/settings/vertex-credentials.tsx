"use client";

import { useRef, useState } from "react";
import { parseVertexServiceAccount } from "@/lib/vertex-config";

/** The file picker is deliberately unfiltered: iOS file providers may not label JSON as application/json. */
export function VertexCredentials({ value, onImport, onRemove }: {
    value?: string;
    onImport: (json: string, project: string) => void;
    onRemove: () => void;
}) {
    const fileInput = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState("");
    const [showPaste, setShowPaste] = useState(false);
    const [message, setMessage] = useState("");
    const [failed, setFailed] = useState(false);
    const [reading, setReading] = useState(false);
    const generation = useRef(0);
    const apply = (text: string, source: string) => {
        try {
            if (text.length > 65536) throw new Error("服务账号 JSON 过大，请选择 Google Cloud 导出的密钥文件");
            const account = parseVertexServiceAccount(text);
            onImport(JSON.stringify(account), account.project_id);
            setDraft(""); setShowPaste(false); setFailed(false);
            setMessage(`已导入${source}，项目：${account.project_id}`);
        } catch (error) {
            setFailed(true);
            setMessage(error instanceof Error ? error.message : "导入失败，请重新选择文件或粘贴 JSON");
        }
    };
    return <div className="flex flex-col gap-2">
        <span className="menu-desc">服务账号 JSON（必填）</span>
        <div className="flex flex-wrap gap-2">
            <button type="button" className="ui-btn ui-btn-outline min-h-11" disabled={reading} onClick={() => fileInput.current?.click()}>
                {reading ? "正在读取文件…" : "选择服务账号文件"}
            </button>
            <button type="button" className="ui-btn ui-btn-outline min-h-11" disabled={reading} onClick={() => setShowPaste(v => !v)}>粘贴 JSON</button>
        </div>
        <input ref={fileInput} aria-label="导入服务账号 JSON" type="file" className="hidden" onChange={async e => {
            const input = e.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            const run = ++generation.current;
            setReading(true); setMessage("");
            try {
                if (file.size > 65536) throw new Error("文件过大，请选择 Google Cloud 导出的服务账号 JSON");
                const text = await file.text();
                if (run === generation.current) apply(text, `文件「${file.name}」`);
            } catch (error) {
                if (run === generation.current) { setFailed(true); setMessage(error instanceof Error ? error.message : "文件读取失败，请使用粘贴 JSON"); }
            } finally {
                input.value = "";
                if (run === generation.current) setReading(false);
            }
        }} />
        {showPaste && <>
            <textarea aria-label="服务账号 JSON 内容" className="ui-textarea min-h-40 font-mono" value={draft}
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                placeholder="在此粘贴完整的服务账号 JSON，包含 type、project_id、client_email 和 private_key"
                onChange={e => setDraft(e.target.value)} />
            <button type="button" className="ui-btn ui-btn-primary" disabled={reading || !draft.trim()} onClick={() => apply(draft, "粘贴的 JSON")}>校验并保存 JSON</button>
        </>}
        <p className="menu-desc">{value ? "已保存服务账号。可以填写模型 ID 并测试连接。" : "尚未导入服务账号。只填写项目 ID 或模型名称无法连接完整模式。"}</p>
        {message && <p role={failed ? "alert" : "status"} className="menu-desc" style={failed ? { color: "var(--c-danger, #c62828)" } : undefined}>{message}</p>}
        {value && <button type="button" disabled={reading} className="menu-desc text-left" onClick={() => {
            ++generation.current; onRemove(); setMessage(""); setDraft("");
        }}>移除已保存的服务账号</button>}
    </div>;
}
