import * as vscode from "vscode";
import { OllamaClient } from "./llm/ollamaClient";
import {
  ToolRegistry,
  defaultTools,
  buildDynamicTools,
} from "./tools/registry";
import { ChatViewProvider } from "./webview/chatViewProvider";
import { NativeDiffService } from "./webview/nativeDiff";
import { ProcessManager } from "./services/processManager";
import { MemoryStore } from "./services/memoryStore";
import { ProjectMemoryStore } from "./services/projectMemoryStore";
import { TaskScheduler } from "./services/taskScheduler";
import { ServerMonitor } from "./services/serverMonitor";
import type { MCPClient } from "./services/mcpClient";

export function activate(context: vscode.ExtensionContext): void {
  const getBaseUrl = () =>
    vscode.workspace
      .getConfiguration("ors")
      .get<string>("baseUrl", "http://localhost:11434");

  const llm = new OllamaClient(getBaseUrl);
  const monitor = new ServerMonitor(getBaseUrl);

  const scheduler = new TaskScheduler();
  const mcpClients = new Map<string, MCPClient>();

  const registry = new ToolRegistry([
    ...defaultTools(),
    ...buildDynamicTools(mcpClients, scheduler),
  ]);
  const diff = new NativeDiffService();
  const processes = new ProcessManager();
  const memory = new MemoryStore(context.globalState);
  memory.seedIfEmpty([
    "ROADMAP.md bu projenin tek gerçek kaynağıdır. Her değişiklikten önce okunmalı; fazlar sırayla (0→7) tamamlanmalı; tamamlanmış maddeler değiştirilmemeli; ROADMAP'te olmayan hiçbir özellik uygulanmamalı.",
    "Güvenlik kuralları geriletilemez: command injection koruması (/[;|`]|\\$\\(|&&|\\|\\|/), symlink bypass koruması (realpathSync), ApprovalGate 60s timeout, buildSafeEnv() — bunlar hiçbir koşulda zayıflatılamaz.",
    "Mimari ilke değişmez: yeni yetenek = yeni Tool + (gerekiyorsa) servis; ajan çekirdeği dokunulmaz. Yukarı bağımlılık yasak: Tool Agent'ı, servis webview'i import edemez.",
    "ROADMAP'e yeni madde eklemek veya mevcut maddeyi değiştirmek için kullanıcı onayı gerekir. Tamamlanan maddeler [ ] → [x] işaretlenir; açıklama metni değiştirilmez.",
  ]);

  const projectMemory = new ProjectMemoryStore(context.globalState);

  const provider = new ChatViewProvider(
    context.extensionUri,
    llm,
    registry,
    context.workspaceState,
    diff,
    processes,
    memory,
    projectMemory,
    monitor,
    scheduler,
  );

  context.subscriptions.push(
    diff.register(),
    monitor,
    { dispose: () => processes.disposeAll() },
    { dispose: () => scheduler.disposeAll() },
    {
      dispose: () => {
        for (const c of mcpClients.values()) c.disconnect();
      },
    },
    vscode.commands.registerCommand("ors.setHost", () =>
      provider.setHostCommand(),
    ),
    vscode.commands.registerCommand("ors.manageHosts", () =>
      provider.manageHostsCommand(),
    ),
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewId,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
    vscode.commands.registerCommand("ors.newChat", () =>
      provider.newChatCommand(),
    ),
    vscode.commands.registerCommand("ors.undo", () => provider.undoCommand()),
    vscode.commands.registerCommand("ors.focus", () =>
      vscode.commands.executeCommand("ors.chat.focus"),
    ),
  );
}

export function deactivate(): void {}
