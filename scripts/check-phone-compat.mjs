import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// weixin-cloud-sync 是 TS 且依赖浏览器侧模块，注册一个即时转译 + 桩件的加载器跑起来。
const hooks = `
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import ts from ${JSON.stringify(pathToFileURL(path.join(root, "node_modules/typescript/lib/typescript.js")).href)};

const ROOT = ${JSON.stringify(root)};
const EXTS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx", ".mjs", ".js"];
// Dexie 是 CJS，ESM 具名导入拿不到 default；这里只需要它能被 import 而已。
const STUBS = { dexie: "export default class Dexie { version(){return{stores(){return{upgrade(){}}}}} table(){return{}} open(){return Promise.resolve()} }" };

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) {
    return { url: "data:text/javascript;base64," + Buffer.from(STUBS[specifier]).toString("base64"), shortCircuit: true, format: "module" };
  }
  let spec = specifier;
  if (spec.startsWith("@/")) spec = pathToFileURL(resolvePath(ROOT, spec.slice(2))).href;
  else if (spec.startsWith(".") && context.parentURL?.startsWith("file:")) {
    spec = pathToFileURL(resolvePath(dirname(fileURLToPath(context.parentURL)), spec)).href;
  } else return next(specifier, context);
  for (const ext of EXTS) {
    try { readFileSync(fileURLToPath(spec + ext)); return { url: spec + ext, shortCircuit: true, format: "module" }; } catch {}
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (!url.endsWith(".ts") && !url.endsWith(".tsx")) return next(url, context);
  const out = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve },
    fileName: fileURLToPath(url),
  }).outputText;
  return { format: "module", shortCircuit: true, source: out };
}
`;
register("data:text/javascript;base64," + Buffer.from(hooks).toString("base64"), pathToFileURL(root + "/"));

const assert = (await import('node:assert/strict')).default;
const { parseCharacterFromJson, parseCharacterFromPng } = await import('../lib/character-storage.ts');
const { parseWorldBookFromJson, parseWorldBookEntry } = await import('../lib/settings-storage.ts');
const { isWorldBookEntryActivated, assemblePromptPayload } = await import('../lib/llm-prompt-assembler.ts');
const { buildProviderRequest, parseProviderResponse, parseProviderStreamDelta } = await import('../lib/llm-provider-adapter.ts');
const { buildRequestHeaders, determineBaseUrl, simpleLLMCall } = await import('../lib/api-helpers.ts');
const { decodeMinimaxAudio, minimaxSpeechUrl } = await import('../lib/minimax-audio.ts');
const { synthesizeSpeech } = await import('../lib/tts-service.ts');
let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`✓ ${name}`); }

await test('V2/V3 角色卡保留背景、示例、原始开场白和内嵌世界书', () => {
    for (const spec of ['chara_card_v2', 'chara_card_v3']) {
        const card = { spec, data: { name: '小雨', description: '人设', personality: '友善', scenario: '书店', first_mes: '你好', mes_example: '示例', character_book: { entries: [] }, extensions: { untouched: true } } };
        const result = parseCharacterFromJson(JSON.stringify(card));
        assert.equal(result.name, '小雨'); assert.match(result.persona, /书店/); assert.match(result.persona, /示例/);
        assert.deepEqual(result.importedCard, card);
    }
    assert.equal(parseCharacterFromJson('null'), null);
    assert.equal(parseCharacterFromJson('{}'), null);
});
await test('原生角色卡往返不会重复拼接酒馆背景', () => {
    const c = parseCharacterFromJson(JSON.stringify({ name: 'A', persona: '背景', importedCard: { spec: 'chara_card_v2' }, schema: 'ai_phone_character' }));
    assert.equal(c.persona, '背景'); assert.equal(c.importedCard.spec, 'chara_card_v2');
});
await test('PNG chara/ccv3 数据读取与截断校验', () => {
    for (const keyword of ['chara', 'ccv3', 'ai_phone_character']) {
        const data = Buffer.from(keyword + '\0' + Buffer.from(JSON.stringify({ name: '雨', description: '中文' })).toString('base64'));
        const png = Buffer.alloc(8 + 12 + data.length);
        Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.writeUInt32BE(data.length, 8); png.write('tEXt', 12); data.copy(png, 16);
        assert.equal(parseCharacterFromPng(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)).name, '雨');
        assert.equal(parseCharacterFromPng(png.buffer.slice(png.byteOffset, png.byteOffset + 20)), null);
    }
});
await test('字典世界书保留 ID、零概率和正则中的逗号', () => {
    const b = parseWorldBookFromJson(JSON.stringify({ entries: { '0': { key: ['/a,b/i'], content: '背景', probability: 0, useProbability: true }, '2': { keys: ['foo'], secondary_keys: ['bar'], extensions: { selectiveLogic: 3 } } } }));
    assert.equal(b.entries[0].uid, '0'); assert.equal(b.entries[0].probability, 0);
    assert.deepEqual(b.entries[0].keys, ['/a,b/i']); assert.equal(b.entries[1].selectiveLogic, 3);
    assert.equal(parseWorldBookFromJson('{}'), null);
});
await test('常驻条目也遵守 0% 概率；关键词和次关键词逻辑有效', () => {
    assert.equal(isWorldBookEntryActivated(parseWorldBookEntry({ constant: true, probability: 0, useProbability: true }), ''), false);
    const e = parseWorldBookEntry({ key: ['/a,b/i'], keysecondary: ['yes', 'ok'], selectiveLogic: 3 });
    assert.equal(isWorldBookEntryActivated(e, 'A,B yes ok'), true);
    assert.equal(isWorldBookEntryActivated(e, 'A,B yes'), false);
    assert.equal(isWorldBookEntryActivated({ ...e, selectiveLogic: 2 }, 'A,B'), true);
    assert.equal(isWorldBookEntryActivated({ ...e, selectiveLogic: 2 }, 'A,B yes'), false);
    assert.equal(isWorldBookEntryActivated(parseWorldBookEntry({ key: ['cat'], matchWholeWords: true }), 'concatenate'), false);
    assert.equal(isWorldBookEntryActivated(parseWorldBookEntry({ key: ['cat'], matchWholeWords: true }), 'a cat!'), true);
});
const base = { id: 'api', provider: 'Custom', baseUrl: 'https://relay.example/v1', apiKey: ' key ', defaultModel: 'some-model', enableImageRecognition: false, enableImageGeneration: false };
const messages = [{ role: 'user', content: '你好' }];
await test('原生小手机请求不因兼容设置缺省而改变协议', () => {
    const r = buildProviderRequest(base, null, messages);
    assert.equal(r.providerKind, 'openai-compatible'); assert.equal(r.url, 'https://relay.example/v1/chat/completions');
    assert.deepEqual(r.body.messages, messages);
    assert.equal(buildProviderRequest({ ...base, provider: 'Anthropic' }, null, messages).providerKind, 'openai-compatible');
});
await test('原生 Claude 中转、无 Key 本地服务及自定义请求头', () => {
    const r = buildProviderRequest({ ...base, protocol: 'anthropic', customHeaders: { 'x-test': 'ok' }, serverProxy: true }, null, messages);
    assert.equal(r.url, 'https://relay.example/v1/messages'); assert.equal(r.headers['x-api-key'], 'key');
    assert.equal(r.headers['x-test'], 'ok'); assert.equal(r.serverProxy, true);
    const local = buildProviderRequest({ ...base, provider: 'Ollama', baseUrl: '', apiKey: '', authMode: 'none' }, null, messages);
    assert.equal(local.url, 'http://localhost:11434/v1/chat/completions'); assert.equal(local.headers.Authorization, undefined);
    assert.throws(() => buildProviderRequest({ ...base, apiKey: '' }, null, messages), /API Key/);
});
await test('MiniMax 地址归一化、业务错误、无效音频和 hex 解码', async () => {
    assert.equal(minimaxSpeechUrl('https://api.minimax.io'), 'https://api.minimax.io/v1/t2a_v2');
    assert.equal(minimaxSpeechUrl('https://api.minimax.io/v1/t2a_v2?GroupId=123'), 'https://api.minimax.io/v1/t2a_v2?GroupId=123');
    assert.throws(() => decodeMinimaxAudio({ base_resp: { status_code: 1004, status_msg: 'invalid key' }, data: { audio: 'ffee' } }), /1004/);
    assert.throws(() => decodeMinimaxAudio({ data: { audio: 'https://example.com/audio' } }), /hex/);
    assert.deepEqual([...new Uint8Array(await decodeMinimaxAudio({ data: { audio: '494433ff' } }).arrayBuffer())], [73,68,51,255]);
});
await test('MiniMax 官方请求经服务端且显式请求 hex；自定义直连不会重复路径', async () => {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ base_resp: { status_code: 0 }, data: { audio: '494433ff' } }); };
    try {
        const v = { id: 'v', provider: 'Minimax', apiKey: 'test', defaultVoice: 'voice', model: 'speech-2.8-hd' };
        const blob = await synthesizeSpeech('test', v); assert.equal(blob.size, 4);
        assert.equal(calls[0].url, '/api/model-request');
        const envelope = JSON.parse(calls[0].init.body);
        assert.equal(envelope.url, 'https://api.minimaxi.com/v1/t2a_v2');
        assert.equal(JSON.parse(envelope.body).output_format, 'hex');
        await synthesizeSpeech('test', { ...v, baseUrl: 'https://relay.example/v1/t2a_v2', transport: 'direct' });
        assert.equal(calls[1].url, 'https://relay.example/v1/t2a_v2');
    } finally { globalThis.fetch = original; }
});
await test('模型转发拒绝非授权地址和跨站请求，并保留流式响应', async () => {
    const { POST } = await import('../app/api/model-request/route.ts');
    const req = (input, origin = 'https://phone.example') => new Request('https://phone.example/api/model-request', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(input) });
    assert.equal((await POST(req({ url: 'http://127.0.0.1/private', method: 'GET' }))).status, 400);
    assert.equal((await POST(req({ url: 'https://untrusted.example/v1', method: 'GET' }))).status, 400);
    assert.equal((await POST(req({ url: 'https://api.minimax.io/v1', method: 'POST' }, 'https://other.example'))).status, 403);
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        assert.equal(init.redirect, 'error');
        assert.equal(init.headers.has('cookie'), false);
        assert.equal(init.headers.get('authorization'), 'Bearer test');
        return new Response('data: {"ok":true}\n\n', { headers: { 'content-type': 'text/event-stream' } });
    };
    try {
        const response = await POST(req({ url: 'https://api.openai.com/v1/chat/completions', method: 'POST', headers: { cookie: 'private', authorization: 'Bearer test' }, body: '{}' }));
        assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /event-stream/);
        assert.equal(await response.text(), 'data: {"ok":true}\n\n');
    } finally { globalThis.fetch = original; }
});
console.log(`\n${passed} compatibility checks passed (mock APIs; no paid requests).`);
