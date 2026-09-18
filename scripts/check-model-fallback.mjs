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
const STUBS = { dexie: "export default class Dexie { entries={put(){return Promise.resolve()},delete(){return Promise.resolve()}}; version(){return{stores(){return{upgrade(){}}}}} table(){return{}} open(){return Promise.resolve()} }" };

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
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, useDefineForClassFields: false },
    fileName: fileURLToPath(url),
  }).outputText;
  return { format: "module", shortCircuit: true, source: out };
}
`;
register("data:text/javascript;base64," + Buffer.from(hooks).toString("base64"), pathToFileURL(root + "/"));

const assert = (await import('node:assert/strict')).default;
const { mascotChatWithTools } = await import('../lib/mascot-engine.ts');
const { saveApiConfigs, loadBindingConfig, saveBindingConfig } = await import('../lib/settings-storage.ts');
const previousWindow = globalThis.window;
const previousFetch = globalThis.fetch;
globalThis.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
const config = {id:'vertex-regression', name:'test', provider:'VertexAI', protocol:'vertex', vertexMode:'express', apiKey:'fake-test-key', defaultModel:'gemini-test', enableNativeTools:true};
saveApiConfigs([config]);
const binding = loadBindingConfig();
binding.globalDefaults.apiConfigId=config.id;
saveBindingConfig(binding,false);
const context = {page:'desktop',mode:'idle',label:'test',fields:{}};
const history = [{role:'user',text:'Reply hello'}];
try {
  for(const status of [429,504]) {
    let calls=0, fallbacks=0;
    globalThis.fetch=async()=>{calls++;return Response.json({error:{message:'upstream failure'}},{status});};
    await assert.rejects(mascotChatWithTools(context,history,[],{callbacks:{onStreamFallback(){fallbacks++;}}}), new RegExp(String(status)));
    assert.equal(calls,1); assert.equal(fallbacks,0);
    console.log(`PASS: mascot HTTP ${status} keeps original failure, no duplicate generation`);
  }
  let truncatedCalls=0;
  globalThis.fetch=async()=>{truncatedCalls++;return new Response('data: {"candidates":[{"content":{"parts":[{"text":"incomplete"}]}}]}\n\n',{headers:{'content-type':'text/event-stream'}});};
  await assert.rejects(mascotChatWithTools(context,history,[]),/未收到生成结束标记/);
  assert.equal(truncatedCalls,1);
  console.log('PASS: mascot rejects clean HTTP 200 EOF without Vertex finish marker, no fallback');
  let calls=0;
  globalThis.fetch=async(url,init)=>{
    calls++;
    const body=JSON.parse(init.body);
    assert.equal(body.apiKey,'fake-test-key');
    assert.ok(body.request.contents.length);
    if(calls===1) return Response.json({error:{message:'stream unsupported'}},{status:400});
    assert.equal(new URL(url,'http://local').searchParams.get('stream'),'false');
    return Response.json({candidates:[{content:{parts:[{text:'hello'}]},finishReason:'STOP'}]});
  };
  const response = await mascotChatWithTools(context,history,[]);
  assert.equal(calls,2); assert.ok(response.rawAssistant.includes('hello'));
  console.log('PASS: mascot stream incompatibility fallback preserves Vertex credential envelope');
} finally { globalThis.fetch=previousFetch; if(previousWindow===undefined) delete globalThis.window; else globalThis.window=previousWindow; }
