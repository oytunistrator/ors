/**
 * Gerçekçi kod-geliştirme e2e testi: ajan mevcut bir projeye erişip kaynağı
 * OKUR, DÜZENLER ve `node` ile ÇALIŞTIRIR — tıpkı bir kodlama asistanı gibi.
 */
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { OllamaClient } from "../src/llm/ollamaClient";
import { ToolRegistry, defaultTools } from "../src/tools/registry";
import { makeResolvePath } from "../src/tools/paths";
import { Agent } from "../src/agent/agent";
import type { AgentConfig, AgentEvents, ApprovalGate } from "../src/agent/types";
import type { ToolContext } from "../src/tools/types";

const MODEL = process.env.ORS_MODEL || "qwen2.5-coder:3b";

const fakeToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
} as any;

const events: AgentEvents = {
  status: () => {},
  assistantStart: () => process.stdout.write("\n[asistan] "),
  assistantToken: (t) => process.stdout.write(t),
  assistantEnd: () => process.stdout.write("\n"),
  assistantDiscard: () => process.stdout.write(" [fallback]\n"),
  toolStart: (_i, name, s) => console.log(`\n[araç→] ${name} :: ${s}`),
  toolEnd: (_i, ok, d) => console.log(`[araç←] ${ok ? "OK" : "HATA"} :: ${d}`),
  info: (t) => console.log(`[bilgi] ${t}`),
  error: (t) => console.log(`[HATA] ${t}`),
};
const approval: ApprovalGate = { async request() { return true; } };

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ors-proj-"));
  // Mevcut bir "proje" kur.
  fs.writeFileSync(
    path.join(root, "index.js"),
    'function greet(name) {\n  return "Hello " + name;\n}\nconsole.log(greet("world"));\n'
  );
  console.log(`Proje: ${root}`);
  console.log("Başlangıç index.js:\n" + fs.readFileSync(path.join(root, "index.js"), "utf8"));

  const llm = new OllamaClient(() => "http://localhost:11434");
  const registry = new ToolRegistry(defaultTools());
  const ctx: ToolContext = {
    workspaceRoot: root,
    resolvePath: makeResolvePath(root),
    recordCheckpoint: () => {},
  };
  const cfg: AgentConfig = {
    model: MODEL, temperature: 0.1, numCtx: 8192, maxIterations: 15,
    autoApprove: { read: true, search: true, list: true, write: true, command: true },
    mode: "act", commandAllowlist: [], commandDenylist: [],
  };
  const agent = new Agent(llm, registry, ctx, events, approval, () => cfg, {
    platform: process.platform, shell: "powershell",
  });

  const task =
    "Bu projede index.js var. Onu oku. greet fonksiyonunu, İngilizce 'Hello' yerine " +
    "Türkçe 'Merhaba' diyecek şekilde düzenle (edit_file kullan). Sonra `node index.js` " +
    "komutunu çalıştırıp çıktıyı göster.";
  console.log(`\n=== GÖREV: ${task} ===`);
  await agent.run(task, fakeToken);

  console.log("\n\n=== DOĞRULAMA ===");
  const final = fs.readFileSync(path.join(root, "index.js"), "utf8");
  console.log("Son index.js:\n" + final);
  const edited = final.includes("Merhaba");
  console.log(edited ? "✅ KOD DÜZENLENDİ (Merhaba var)" : "❌ kod düzenlenmedi");
}

main().catch((e) => { console.error("TEST HATASI:", e); process.exit(1); });
