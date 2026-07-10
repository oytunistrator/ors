/**
 * Uçtan uca canlı test: gerçek Ollama + Örs ajan çekirdeği (webview'siz).
 * Geçici bir workspace'te ajanı çalıştırıp araçların gerçekten dosya yazıp
 * okuduğunu ve tool-calling döngüsünün çalıştığını doğrular.
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
  status: (s) => process.stdout.write(`\n[durum:${s}] `),
  assistantStart: () => process.stdout.write("\n[asistan] "),
  assistantToken: (t) => process.stdout.write(t),
  assistantEnd: () => process.stdout.write("\n"),
  assistantDiscard: () => process.stdout.write("\n[fallback: metin JSON ayrıştırıldı]\n"),
  toolStart: (_id, name, summary) => console.log(`\n[araç→] ${name} :: ${summary}`),
  toolEnd: (_id, ok, detail) => console.log(`[araç←] ${ok ? "OK" : "HATA"} :: ${detail}`),
  info: (t) => console.log(`[bilgi] ${t}`),
  error: (t) => console.log(`[HATA] ${t}`),
};

const approval: ApprovalGate = {
  async request(tool) {
    console.log(`[onay] otomatik onaylandı: ${tool}`);
    return true;
  },
};

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ors-e2e-"));
  console.log(`Workspace: ${root}`);

  const llm = new OllamaClient(() => "http://localhost:11434");
  const registry = new ToolRegistry(defaultTools());
  const ctx: ToolContext = {
    workspaceRoot: root,
    resolvePath: makeResolvePath(root),
    recordCheckpoint: () => {},
    onTodos: (items) => console.log(`[todos] ${items.map((t) => `${t.status}:${t.content}`).join(" | ")}`),
  };
  const cfg: AgentConfig = {
    model: MODEL,
    temperature: 0.2,
    numCtx: 8192,
    maxIterations: 12,
    autoApprove: { read: true, search: true, list: true, write: true, command: true },
    mode: "act",
    commandAllowlist: [],
    commandDenylist: [],
  };
  const agent = new Agent(
    llm,
    registry,
    ctx,
    events,
    approval,
    () => cfg,
    { platform: process.platform, shell: "powershell" }
  );

  console.log(`\n=== Tool desteği: ${await llm.supportsTools(MODEL)} ===`);

  const task =
    "notlar.txt adında bir dosya oluştur ve içine tam olarak 'Örs çalışıyor' yaz. " +
    "Sonra dosyayı okuyup içeriğini bana göster.";
  console.log(`\n=== GÖREV: ${task} ===`);

  await agent.run(task, fakeToken);

  // Doğrulama
  const target = path.join(root, "notlar.txt");
  console.log("\n\n=== DOĞRULAMA ===");
  if (fs.existsSync(target)) {
    const content = fs.readFileSync(target, "utf8");
    console.log(`notlar.txt VAR, içerik: "${content}"`);
    console.log(content.includes("Örs çalışıyor") ? "✅ İÇERİK DOĞRU" : "⚠️ içerik beklenenden farklı (model varyasyonu)");
  } else {
    console.log("❌ notlar.txt OLUŞTURULMADI — ajan write_file çağırmadı");
  }
}

main().catch((e) => {
  console.error("TEST HATASI:", e);
  process.exit(1);
});
