import * as vscode from "vscode";
import * as os from "os";
import type {
  AgentMode,
  HostBoundMessage,
  SessionMeta,
  TodoItem,
  TranscriptItem,
  WebviewBoundMessage,
} from "../shared/protocol";
import type { LLMClient } from "../llm/types";
import type {
  ApprovalPreview,
  DiagnosticEntry,
  ToolContext,
} from "../tools/types";
import { ToolRegistry } from "../tools/registry";
import { makeResolvePath } from "../tools/paths";
import { Agent } from "../agent/agent";
import type { AgentConfig, AgentEvents, ApprovalGate } from "../agent/types";
import { getHtml } from "./html";
import { collectContext } from "./editorContext";
import { expandSlash } from "./slashCommands";
import { NativeDiffService } from "./nativeDiff";
import { CheckpointManager } from "../edit/checkpoints";
import type { ProcessManager } from "../services/processManager";
import type { MemoryStore } from "../services/memoryStore";
import type { ProjectMemoryStore } from "../services/projectMemoryStore";
import { ToolStats } from "../services/toolStats";
import type { TaskScheduler } from "../services/taskScheduler";
import { ServerMonitor } from "../services/serverMonitor";

function toDiagnosticEntry(
  d: vscode.Diagnostic,
  uri: vscode.Uri,
): DiagnosticEntry {
  return {
    severity:
      d.severity === vscode.DiagnosticSeverity.Error
        ? "error"
        : d.severity === vscode.DiagnosticSeverity.Warning
          ? "warning"
          : "info",
    source: d.source ?? undefined,
    message: d.message,
    file: vscode.workspace.asRelativePath(uri),
    line: d.range.start.line + 1,
  };
}

interface SessionRuntime {
  id: string;
  agent?: Agent;
  taskSource?: vscode.CancellationTokenSource;
  busy: boolean;
  queue: Array<{ text: string; images?: string[] }>;
  transcript: TranscriptItem[];
  todos: TodoItem[];
  streamingItem?: { kind: "assistant"; text: string };
  currentTool: string;
  checkpoints: CheckpointManager;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  savedSnapshot?: any;
  pendingPrompts: WebviewBoundMessage[];
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "ors.chat";

  private view?: vscode.WebviewView;
  private readonly sessions = new Map<string, SessionRuntime>();
  private currentSessionId = "default";
  private pendingApprovals = new Map<
    string,
    (approved: boolean, remember?: boolean) => void
  >();
  private approvalSeq = 0;
  private pendingAsks = new Map<string, (answer: string) => void>();
  private askSeq = 0;
  private worktreeOverride?: string;

  private readonly visionCapCache = new Map<string, boolean>();
  private selectedModel = "";
  private mode: AgentMode = "manual";
  private effort: import("../shared/protocol").EffortLevel = "medium";
  private readonly toolStats = new ToolStats();
  private orsTerminal?: vscode.Terminal;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly llm: LLMClient,
    private readonly registry: ToolRegistry,
    private readonly memento: vscode.Memento,
    private readonly diff: NativeDiffService,
    private readonly processes: ProcessManager,
    private readonly memory: MemoryStore,
    private readonly projectMemory: ProjectMemoryStore,
    private readonly monitor: ServerMonitor,
    private readonly scheduler?: TaskScheduler,
  ) {
    if (scheduler) {
      scheduler.setRunCallback(async (prompt) => {
        await this.handlePrompt(`[Zamanlanmış görev] ${prompt}`);
      });
    }

    monitor.onStatusChange((info) => {
      this.post({
        type: "serverStatus",
        status: info.status,
        host: info.host,
        error: info.error,
      });
    });

    monitor.onServerOffline((host) => {
      this.post({
        type: "error",
        text: `⚠️ Ollama sunucusu çevrimdışı: ${host}`,
      });
    });

    monitor.onServerOnline((host) => {
      if (this.view) {
        this.post({
          type: "info",
          text: `✅ Ollama sunucusu çevrimiçi: ${host}`,
        });
        this.sendModels();
      }
    });

    monitor.start();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = getHtml(view.webview, this.extensionUri);
    view.webview.onDidReceiveMessage((m: HostBoundMessage) =>
      this.onMessage(m),
    );
    view.onDidDispose(() => {
      for (const s of this.sessions.values()) this.cancelSession(s);
      this.view = undefined;
    });
  }

  newChatCommand(): void {
    this.persist(this.active);
    const newId = `sess_${Date.now()}`;
    const index = this.memento.get<SessionMeta[]>(this.sessionIndexKey(), []);
    index.push({
      id: newId,
      name: "Yeni sohbet",
      active: false,
      autoName: true,
    });
    void this.memento.update(this.sessionIndexKey(), index);
    this.currentSessionId = newId;
    const s = this.getSession(newId);
    this.persist(s);
    this.renderSession(s);
    this.post({ type: "sessions", sessions: this.listSessions() });
  }

  undoCommand(): void {
    void this.handleUndo();
  }

  private createSession(id: string): SessionRuntime {
    return {
      id,
      busy: false,
      queue: [],
      transcript: [],
      todos: [],
      currentTool: "",
      checkpoints: new CheckpointManager(),
      pendingPrompts: [],
    };
  }

  private getSession(id: string): SessionRuntime {
    let s = this.sessions.get(id);
    if (!s) {
      s = this.createSession(id);
      this.sessions.set(id, s);
      this.loadSession(s);
    }
    return s;
  }

  private get active(): SessionRuntime {
    return this.getSession(this.currentSessionId);
  }

  private loadSession(s: SessionRuntime): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let saved = this.memento.get<{ transcript: TranscriptItem[]; agent: any }>(
      this.sessionKey(s.id),
    );
    if (!saved && s.id === "default") {
      const root =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "global";
      saved = this.memento.get(`session:${root}`);
    }
    if (saved) {
      s.transcript = saved.transcript ?? [];
      s.savedSnapshot = saved.agent;
    }
  }

  private async onMessage(m: HostBoundMessage): Promise<void> {
    switch (m.type) {
      case "ready": {
        const s = this.active;
        this.renderSession(s);
        this.post({ type: "mode", mode: this.mode, effort: this.effort });
        this.post({ type: "sessions", sessions: this.listSessions() });
        this.post({ type: "stats", items: this.toolStats.list() });
        // Send current server status
        this.post({
          type: "serverStatus",
          status: this.monitor.status,
          host: this.monitor.currentHost,
          error: this.monitor.info.error,
        });
        await this.sendModels();
        break;
      }
      case "selectMode":
        this.mode = m.mode;
        if (m.effort) this.effort = m.effort;
        this.post({ type: "mode", mode: this.mode, effort: this.effort });
        break;
      case "sendPrompt":
        await this.handlePrompt(m.text, m.images);
        break;
      case "stop":
        this.cancelSession(this.active);
        break;
      case "newChat":
        this.newChatCommand();
        break;
      case "getModels":
        await this.sendModels();
        break;
      case "selectModel":
        this.selectedModel = m.model;
        try {
          await vscode.workspace
            .getConfiguration("ors")
            .update("model", m.model, vscode.ConfigurationTarget.Global);
        } catch (err) {
          this.error(`Model ayarı kaydedilemedi: ${(err as Error).message}`);
        }
        break;
      case "setHost":
        await this.setHostCommand();
        break;
      case "undo":
        await this.handleUndo();
        break;
      case "approvalResponse": {
        const resolve = this.pendingApprovals.get(m.id);
        if (resolve) {
          this.pendingApprovals.delete(m.id);
          resolve(m.approved, m.remember);
        }
        break;
      }
      case "askUserResponse": {
        const resolve = this.pendingAsks.get(m.id);
        if (resolve) {
          this.pendingAsks.delete(m.id);
          resolve(m.answer);
        }
        break;
      }
      case "switchSession":
        this.switchSession(m.id);
        break;
      case "deleteSession":
        this.deleteSession(m.id);
        break;
      case "renameSession":
        this.renameSession(m.id, m.name);
        break;
      case "openFilePicker":
        await this.handleFilePicker();
        break;
      case "getEditorContext":
        this.handleEditorContext();
        break;
      case "manageHosts":
        await this.manageHostsCommand();
        break;
      case "removeHost":
        await this.removeHostFromList(m.host);
        break;
    }
  }

  private async handlePrompt(text: string, images?: string[]): Promise<void> {
    if (!text.trim()) return;
    const s = this.active;

    this.postTo(s.id, { type: "userMessage", text });
    this.pushItem(s, { kind: "user", text });

    const slash = await expandSlash(text, this.rootDir());
    if (slash.info) {
      this.emitInfo(s, slash.info);
      return;
    }

    s.queue.push({ text, images });
    if (s.busy) {
      this.postTo(s.id, {
        type: "info",
        text: `Kuyruğa alındı (${s.queue.length} bekliyor). Sıradaki iş bitince çalışacak.`,
      });
      return;
    }
    s.busy = true;
    try {
      await this.drainQueue(s);
    } finally {
      s.busy = false;
      this.postTo(s.id, {
        type: "status",
        state: "idle",
        ctxPct: this.estimateCtxPct(s),
      });
    }
  }

  private async drainQueue(s: SessionRuntime): Promise<void> {
    while (s.queue.length > 0) {
      const item = s.queue.shift()!;
      await this.runOne(s, item.text, item.images);
    }
  }

  private async runOne(
    s: SessionRuntime,
    text: string,
    images?: string[],
  ): Promise<void> {
    const cfg = this.readConfig();
    if (!cfg.model) {
      this.emitError(
        s,
        "Model seçili değil. Üstteki menüden bir model seç (Ollama çalışıyor olmalı).",
      );
      return;
    }
    if (images?.length) {
      await this.warnIfNoVisionSupport(cfg.model, s);
    }

    const agent = this.ensureAgent(s);
    const slash = await expandSlash(text, this.rootDir());
    const context = await collectContext(this.rootDir(), slash.prompt);
    const augmented = context ? context + slash.prompt : slash.prompt;

    s.checkpoints.begin();
    s.taskSource = new vscode.CancellationTokenSource();
    try {
      await agent.run(augmented, s.taskSource.token, images);
    } finally {
      s.taskSource?.dispose();
      s.taskSource = undefined;
      this.postTo(s.id, {
        type: "undoAvailable",
        available: s.checkpoints.hasUndo(),
      });
      this.persist(s);
    }
  }

  private async handleUndo(): Promise<void> {
    const s = this.active;
    const n = await s.checkpoints.undoLast();
    if (n > 0) {
      this.info(`${n} dosya değişikliği geri alındı.`);
    } else {
      this.info("Geri alınacak değişiklik yok.");
    }
    this.post({ type: "undoAvailable", available: s.checkpoints.hasUndo() });
    this.persist(s);
  }

  private cancelSession(s: SessionRuntime): void {
    s.queue = [];
    s.taskSource?.cancel();
    for (const p of s.pendingPrompts) {
      if (p.type === "approvalRequest") {
        const r = this.pendingApprovals.get(p.id);
        if (r) {
          this.pendingApprovals.delete(p.id);
          r(false);
        }
      } else if (p.type === "askUser") {
        const r = this.pendingAsks.get(p.id);
        if (r) {
          this.pendingAsks.delete(p.id);
          r("");
        }
      }
    }
    s.pendingPrompts = [];
  }

  async setHostCommand(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ors");
    const hosts = cfg.get<string[]>("hosts", ["http://localhost:11434"]);
    const current = cfg.get<string>("baseUrl", "http://localhost:11434");
    const ADD = "➕ Yeni host ekle…";
    const REMOVE = "🗑️ Host sil…";
    const pick = await vscode.window.showQuickPick(
      [...hosts.map((h) => (h === current ? `● ${h}` : `  ${h}`)), ADD, REMOVE],
      { placeHolder: "Ollama host seç, ekle veya sil" },
    );
    if (!pick) return;
    if (pick === ADD) {
      const url = await this.addNewHost(hosts, cfg);
      if (!url) return;
      await cfg.update("baseUrl", url, vscode.ConfigurationTarget.Global);
      this.info(`Ollama host: ${url}`);
      this.monitor.restart();
      await this.sendModels();
      return;
    } else if (pick === REMOVE) {
      await this.removeHost(hosts, current, cfg);
      return;
    } else {
      const url = pick.replace(/^[●\s]+/, "");
      await cfg.update("baseUrl", url, vscode.ConfigurationTarget.Global);
      this.info(`Ollama host: ${url}`);
      this.monitor.restart();
      await this.sendModels();
    }
  }

  async manageHostsCommand(): Promise<void> {
    await this.setHostCommand();
  }

  private async addNewHost(
    hosts: string[],
    cfg: vscode.WorkspaceConfiguration,
  ): Promise<string | undefined> {
    const input = await vscode.window.showInputBox({
      prompt: "Ollama host URL (ör. http://192.168.1.50:11434)",
      value: "http://",
      validateInput: (v) =>
        /^https?:\/\/.+/.test(v) ? null : "http(s):// ile başlamalı",
    });
    if (!input) return undefined;
    const url = input.trim();
    if (!hosts.includes(url)) {
      await cfg.update(
        "hosts",
        [...hosts, url],
        vscode.ConfigurationTarget.Global,
      );
    }
    return url;
  }

  private async removeHostFromList(host: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ors");
    const hosts = cfg.get<string[]>("hosts", ["http://localhost:11434"]);
    const current = cfg.get<string>("baseUrl", "http://localhost:11434");
    const updated = hosts.filter((h) => h !== host);
    if (updated.length === 0) {
      this.error("En az bir host kalmalıdır.");
      return;
    }
    await cfg.update("hosts", updated, vscode.ConfigurationTarget.Global);
    if (current === host) {
      const fallback = updated[0];
      await cfg.update("baseUrl", fallback, vscode.ConfigurationTarget.Global);
      this.monitor.restart();
    }
    // Send updated hosts list to webview
    this.post({
      type: "hosts",
      hosts: updated,
      current: updated.includes(current) ? current : updated[0],
    });
    this.sendModels();
  }

  private async removeHost(
    hosts: string[],
    current: string,
    cfg: vscode.WorkspaceConfiguration,
  ): Promise<void> {
    if (hosts.length <= 1) {
      this.error("En az bir host kalmalıdır. Önce yeni bir host ekleyin.");
      return;
    }
    const toRemove = await vscode.window.showQuickPick(hosts, {
      placeHolder: "Silinecek host'u seç",
    });
    if (!toRemove) return;
    const updated = hosts.filter((h) => h !== toRemove);
    await cfg.update("hosts", updated, vscode.ConfigurationTarget.Global);
    if (current === toRemove) {
      const fallback = updated[0];
      await cfg.update("baseUrl", fallback, vscode.ConfigurationTarget.Global);
      this.info(`Aktif host silindi, ${fallback} olarak değiştirildi.`);
      this.monitor.restart();
      await this.sendModels();
    }
  }

  private async sendModels(): Promise<void> {
    try {
      const models = await this.llm.listModels();
      const c = vscode.workspace.getConfiguration("ors");
      const hosts = c.get<string[]>("hosts", ["http://localhost:11434"]);
      const currentHost = c.get<string>("baseUrl", "http://localhost:11434");
      const current = this.readConfig().model;
      this.post({ type: "models", models, current, currentHost });
      this.post({ type: "hosts", hosts, current: currentHost });
    } catch (err) {
      this.post({
        type: "error",
        text: `Modeller alınamadı: ${(err as Error).message}`,
      });
    }
  }

  private async warnIfNoVisionSupport(
    model: string,
    s: SessionRuntime,
  ): Promise<void> {
    if (!model) return;
    let supported = this.visionCapCache.get(model);
    if (supported === undefined) {
      try {
        supported = await this.llm.supportsVision(model);
      } catch {
        supported = true;
      }
      this.visionCapCache.set(model, supported);
    }
    if (!supported) {
      this.postTo(s.id, {
        type: "error",
        text:
          `Uyarı: '${model}' modeli görsel (vision) desteklemiyor. ` +
          `Görsel analiz için llava, gemma4, qwen2-vl gibi bir vision modeli seç.`,
      });
    }
  }

  private makeEvents(s: SessionRuntime): AgentEvents {
    return {
      status: (state) => this.emitStatus(s, state),
      assistantStart: () => this.emitAssistantStart(s),
      assistantToken: (t) => this.emitAssistantToken(s, t),
      assistantEnd: () => this.emitAssistantEnd(s),
      assistantDiscard: () => this.emitAssistantDiscard(s),
      toolStart: (id, name, summary) =>
        this.emitToolStart(s, id, name, summary),
      toolEnd: (id, ok, detail) => this.emitToolEnd(s, id, ok, detail),
      info: (t) => this.emitInfo(s, t),
      error: (t) => this.emitError(s, t),
    };
  }

  private emitStatus(
    s: SessionRuntime,
    state: "idle" | "thinking" | "running",
  ): void {
    const label =
      state === "running" && s.currentTool
        ? s.currentTool
        : state === "thinking"
          ? "düşünüyor"
          : undefined;
    this.postTo(s.id, {
      type: "status",
      state,
      label,
      ctxPct: this.estimateCtxPct(s),
    });
  }

  private estimateCtxPct(s: SessionRuntime): number | undefined {
    const numCtx = this.readConfig().numCtx;
    if (!numCtx) return undefined;

    // Transcript içeriği
    let totalChars = s.transcript.reduce((sum, item) => {
      if (item.kind === "user" || item.kind === "assistant")
        return sum + item.text.length;
      if (item.kind === "tool")
        return sum + item.summary.length + item.detail.length;
      return sum;
    }, 0);

    // Anlık streaming metni de ekle
    if (s.streamingItem) {
      totalChars += s.streamingItem.text.length;
    }

    // Sistem promptu (tool tanımları, kurallar, memory) — kesin hesap yoksa ~4000 varsay
    // Agent buildSystemPrompt tipik olarak 3000-8000 karakter arasıdır
    const SYSTEM_PROMPT_ESTIMATE = 4000;
    totalChars += SYSTEM_PROMPT_ESTIMATE;

    // Karakter → token dönüşümü (ASCII ağırlıklı kod için ~0.25 token/karakter)
    const estimatedTokens = totalChars * 0.25;

    return Math.min(100, Math.round((estimatedTokens / numCtx) * 100));
  }

  private emitAssistantStart(s: SessionRuntime): void {
    s.streamingItem = { kind: "assistant", text: "" };
    this.pushItem(s, s.streamingItem);
    this.postTo(s.id, { type: "assistantStart" });
  }

  private emitAssistantToken(s: SessionRuntime, text: string): void {
    if (s.streamingItem) s.streamingItem.text += text;
    this.postTo(s.id, { type: "assistantToken", text });
  }

  private emitAssistantEnd(s: SessionRuntime): void {
    s.streamingItem = undefined;
    this.postTo(s.id, { type: "assistantEnd" });
  }

  private emitAssistantDiscard(s: SessionRuntime): void {
    if (s.streamingItem) {
      const idx = s.transcript.lastIndexOf(s.streamingItem);
      if (idx >= 0) s.transcript.splice(idx, 1);
      s.streamingItem = undefined;
    }
    this.postTo(s.id, { type: "assistantDiscard" });
  }

  private emitToolStart(
    s: SessionRuntime,
    id: string,
    name: string,
    summary: string,
  ): void {
    s.currentTool = name;
    this.toolStats.begin(name);
    this.pushItem(s, { kind: "tool", name, summary, ok: false, detail: "…" });
    this.postTo(s.id, { type: "toolStart", id, name, summary });
  }

  private emitToolEnd(
    s: SessionRuntime,
    id: string,
    ok: boolean,
    detail: string,
  ): void {
    this.toolStats.end(s.currentTool, ok);
    this.postTo(s.id, { type: "stats", items: this.toolStats.list() });
    s.currentTool = "";
    for (let i = s.transcript.length - 1; i >= 0; i--) {
      const it = s.transcript[i];
      if (it.kind === "tool" && it.detail === "…") {
        it.ok = ok;
        it.detail = detail;
        break;
      }
    }
    this.postTo(s.id, { type: "toolEnd", id, ok, detail });
  }

  private emitInfo(s: SessionRuntime, text: string): void {
    this.pushItem(s, { kind: "notice", level: "info", text });
    this.postTo(s.id, { type: "info", text });
  }

  private emitError(s: SessionRuntime, text: string): void {
    this.pushItem(s, { kind: "notice", level: "error", text });
    this.postTo(s.id, { type: "error", text });
  }

  private info(text: string): void {
    this.emitInfo(this.active, text);
  }

  private error(text: string): void {
    this.emitError(this.active, text);
  }

  private makeApproval(s: SessionRuntime): ApprovalGate {
    return {
      request: (tool, args, preview) =>
        this.requestApproval(s, tool, args, preview),
    };
  }

  private async requestApproval(
    s: SessionRuntime,
    tool: string,
    args: Record<string, unknown>,
    preview: ApprovalPreview,
  ): Promise<boolean> {
    const t = this.registry.get(tool);
    if (t?.previewChange) {
      try {
        const change = await t.previewChange(args, this.toolContext(s));
        if (change) await this.diff.show(change);
      } catch {
        void 0;
      }
    }

    const id = `appr_${++this.approvalSeq}`;
    const payload: WebviewBoundMessage = {
      type: "approvalRequest",
      id,
      tool,
      title: preview.title,
      preview: preview.text,
      previewKind: preview.kind,
    };
    s.pendingPrompts.push(payload);
    this.postTo(s.id, payload);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingApprovals.has(id)) {
          this.pendingApprovals.delete(id);
          this.removePrompt(s, id);
          resolve(false);
        }
      }, 60_000);
      this.pendingApprovals.set(id, (approved, remember) => {
        clearTimeout(timer);
        this.removePrompt(s, id);
        if (approved && remember) void this.rememberCommandAllow(tool, args);
        resolve(approved);
      });
    });
  }

  private removePrompt(s: SessionRuntime, id: string): void {
    s.pendingPrompts = s.pendingPrompts.filter(
      (p) =>
        !(
          (p.type === "approvalRequest" || p.type === "askUser") &&
          p.id === id
        ),
    );
  }

  private async rememberCommandAllow(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    if (tool !== "run_command") return;
    const cmd = String(args.command ?? "").trim();
    const prefix = cmd.split(/\s+/)[0];
    if (!prefix) return;
    const cfg = vscode.workspace.getConfiguration("ors");
    const list = cfg.get<string[]>("commandAllowlist") ?? [];
    if (list.some((p) => p.trim().toLowerCase() === prefix.toLowerCase()))
      return;
    await cfg.update(
      "commandAllowlist",
      [...list, prefix],
      vscode.ConfigurationTarget.Global,
    );
  }

  private rootDir(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
  }

  private toolContext(s: SessionRuntime): ToolContext {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const cfg = vscode.workspace.getConfiguration("ors");
    const workspaceOnly = cfg.get<boolean>("workspaceOnly", false);
    const baseUrl = cfg.get<string>("baseUrl", "http://localhost:11434");
    const model = (cfg.get<string>("model") || this.selectedModel) ?? "";
    return {
      get workspaceRoot() {
        return self.worktreeOverride ?? self.rootDir();
      },
      resolvePath: (rel) =>
        makeResolvePath(
          self.worktreeOverride ?? self.rootDir(),
          workspaceOnly,
        )(rel),
      recordCheckpoint: (abs, before) => s.checkpoints.record(abs, before),
      onTodos: (items) => {
        s.todos = items;
        this.postTo(s.id, { type: "todos", items });
      },
      background: this.processes,
      memory: this.memory,
      projectMemory: this.projectMemory,
      ollamaBaseUrl: baseUrl,
      visionModel: model || undefined,
      getDiagnostics: (absPath) => {
        const uri = absPath ? vscode.Uri.file(absPath) : undefined;
        if (uri) {
          return vscode.languages
            .getDiagnostics(uri)
            .map((d) => toDiagnosticEntry(d, uri));
        }
        return vscode.languages
          .getDiagnostics()
          .flatMap(([u, diags]) => diags.map((d) => toDiagnosticEntry(d, u)));
      },
      runInTerminal: (command, terminalName) => {
        const name = terminalName ?? "Örs";
        if (!this.orsTerminal || this.orsTerminal.exitStatus !== undefined) {
          this.orsTerminal = vscode.window.createTerminal({ name });
        }
        this.orsTerminal.show(true);
        this.orsTerminal.sendText(command, true);
      },
      spawnSubAgent: async (task, toolNames, token) => {
        const agentCfg = this.readConfig();
        const tools =
          toolNames.length > 0
            ? toolNames
                .map((n) => this.registry.get(n))
                .filter((t): t is NonNullable<typeof t> => t !== undefined)
            : this.registry.all();
        const subRegistry = new ToolRegistry(tools);
        const output: string[] = [];
        const events: AgentEvents = {
          status: () => {},
          assistantStart: () => {},
          assistantToken: (t) => {
            output.push(t);
          },
          assistantEnd: () => {},
          assistantDiscard: () => {},
          toolStart: () => {},
          toolEnd: () => {},
          info: (t) => {
            output.push(`\n[bilgi] ${t}`);
          },
          error: (t) => {
            output.push(`\n[hata] ${t}`);
          },
        };
        const approval: ApprovalGate = {
          request: async () => true,
        };
        const sub = this.buildAgent(
          subRegistry,
          this.toolContext(s),
          events,
          approval,
          () => agentCfg,
        );
        await sub.run(task, token);
        return output.join("") || "(alt-ajan çıktı üretmedi)";
      },

      askUser: (title, options) =>
        new Promise<string>((resolve) => {
          const id = `ask_${++self.askSeq}`;
          const payload: WebviewBoundMessage = {
            type: "askUser",
            id,
            title,
            options,
          };
          s.pendingPrompts.push(payload);
          const timer = setTimeout(() => {
            if (self.pendingAsks.has(id)) {
              self.pendingAsks.delete(id);
              self.removePrompt(s, id);
              resolve("");
            }
          }, 60_000);
          self.pendingAsks.set(id, (answer) => {
            clearTimeout(timer);
            self.removePrompt(s, id);
            resolve(answer);
          });
          self.postTo(s.id, payload);
        }),

      setAgentMode: (mode) => {
        self.mode = mode;
        self.post({ type: "mode", mode, effort: self.effort });
        self.postTo(s.id, {
          type: "info",
          text:
            mode === "plan"
              ? "Ajan plan moduna geçti: yalnızca keşif yapacak."
              : "Ajan act moduna geçti: uygulama başlıyor.",
        });
      },

      lspExecute: (command, filePath, line, character, extra) => {
        const uri = vscode.Uri.file(filePath);
        const position = new vscode.Position(line, character);
        if (extra !== undefined) {
          return vscode.commands.executeCommand(
            command,
            uri,
            position,
            extra,
          ) as Promise<unknown>;
        }
        return vscode.commands.executeCommand(
          command,
          uri,
          position,
        ) as Promise<unknown>;
      },

      lspApplyRename: async (filePath, line, character, newName) => {
        const uri = vscode.Uri.file(filePath);
        const position = new vscode.Position(line, character);
        const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
          "vscode.executeDocumentRenameProvider",
          uri,
          position,
          newName,
        );
        if (!edit)
          return "Rename provider yanıt vermedi veya sembol bulunamadı.";
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) return "WorkspaceEdit uygulanamadı.";
        return `${edit.size} değişiklik uygulandı → '${newName}'`;
      },

      setWorktreeRoot: (path) => {
        self.worktreeOverride = path ?? undefined;
        self.postTo(s.id, {
          type: "info",
          text: path
            ? `Çalışma dizini worktree'ye yönlendirildi: ${path}`
            : "Çalışma dizini orijinal workspace'e döndürüldü.",
        });
      },
    };
  }

  private buildAgent(
    registry: ToolRegistry,
    ctx: ToolContext,
    events: AgentEvents,
    approval: ApprovalGate,
    cfg: () => AgentConfig,
  ): Agent {
    return new Agent(
      this.llm,
      registry,
      ctx,
      events,
      approval,
      cfg,
      {
        platform: process.platform,
        shell: process.platform === "win32" ? "powershell" : "sh",
      },
      () => this.memory.list(),
    );
  }

  private ensureAgent(s: SessionRuntime): Agent {
    if (s.agent) return s.agent;
    s.agent = this.buildAgent(
      this.registry,
      this.toolContext(s),
      this.makeEvents(s),
      this.makeApproval(s),
      () => this.readConfig(),
    );
    if (s.savedSnapshot) {
      s.agent.restore(s.savedSnapshot);
      s.savedSnapshot = undefined;
    }
    return s.agent;
  }

  private sessionKey(id: string): string {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "global";
    return `session:${root}:${id}`;
  }

  private sessionIndexKey(): string {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "global";
    return `sessions:${root}`;
  }

  private listSessions(): SessionMeta[] {
    const index = this.memento.get<SessionMeta[]>(this.sessionIndexKey(), []);
    if (index.length === 0) {
      return [{ id: "default", name: "Varsayılan", active: true }];
    }
    return index.map((s) => ({ ...s, active: s.id === this.currentSessionId }));
  }

  private renderSession(s: SessionRuntime): void {
    const items = s.transcript.slice();
    let liveText: string | undefined;
    if (
      s.busy &&
      s.streamingItem &&
      items[items.length - 1] === s.streamingItem
    ) {
      items.pop();
      liveText = s.streamingItem.text;
    }
    this.post({ type: "reset" });
    this.post({ type: "restore", items });
    if (liveText !== undefined) {
      this.post({ type: "assistantStart" });
      if (liveText) this.post({ type: "assistantToken", text: liveText });
    }
    this.post({ type: "undoAvailable", available: s.checkpoints.hasUndo() });
    this.post({ type: "todos", items: s.todos });
    this.post({
      type: "status",
      state: s.busy ? "thinking" : "idle",
      ctxPct: this.estimateCtxPct(s),
    });
    for (const p of s.pendingPrompts) this.post(p);
  }

  private switchSession(id: string): void {
    if (id === this.currentSessionId) return;
    this.persist(this.active);
    this.currentSessionId = id;
    this.renderSession(this.getSession(id));
    this.post({ type: "sessions", sessions: this.listSessions() });
  }

  private deleteSession(id: string): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "global";
    const index = this.memento.get<SessionMeta[]>(this.sessionIndexKey(), []);
    if (index.length <= 1) {
      this.info("Son sohbet silinemez.");
      return;
    }
    const deletingActive = this.currentSessionId === id;
    const remaining = index.filter((s) => s.id !== id);
    void this.memento.update(this.sessionIndexKey(), remaining);
    void this.memento.update(`session:${root}:${id}`, undefined);
    if (id === "default") {
      void this.memento.update(`session:${root}`, undefined);
    }
    const rt = this.sessions.get(id);
    if (rt) {
      this.cancelSession(rt);
      this.sessions.delete(id);
    }
    if (deletingActive) {
      this.currentSessionId = remaining[0].id;
      this.renderSession(this.active);
    }
    this.post({ type: "sessions", sessions: this.listSessions() });
  }

  private renameSession(id: string, name: string): void {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    const index = this.memento.get<SessionMeta[]>(this.sessionIndexKey(), []);
    const entry = index.find((s) => s.id === id);
    if (!entry) return;
    entry.name = trimmed;
    entry.autoName = false;
    void this.memento.update(this.sessionIndexKey(), index);
    this.post({ type: "sessions", sessions: this.listSessions() });
  }

  private firstUserMessage(s: SessionRuntime): string | undefined {
    const item = s.transcript.find((t) => t.kind === "user");
    if (!item || item.kind !== "user") return undefined;
    return item.text.slice(0, 40) + (item.text.length > 40 ? "…" : "");
  }

  private persist(s: SessionRuntime): void {
    void this.memento.update(this.sessionKey(s.id), {
      transcript: s.transcript,
      agent: s.agent?.snapshot() ?? s.savedSnapshot,
    });
    const index = this.memento.get<SessionMeta[]>(this.sessionIndexKey(), []);
    let entry = index.find((e) => e.id === s.id);
    if (!entry) {
      entry = {
        id: s.id,
        name: this.firstUserMessage(s) ?? "Yeni sohbet",
        active: false,
        autoName: true,
      };
      index.push(entry);
    }
    if (entry.autoName !== false) {
      const derived = this.firstUserMessage(s);
      if (derived) entry.name = derived;
    }
    entry.messageCount = s.transcript.filter((t) => t.kind === "user").length;
    entry.lastActivity = Date.now();
    void this.memento.update(this.sessionIndexKey(), index);
  }

  private pushItem(s: SessionRuntime, item: TranscriptItem): void {
    s.transcript.push(item);
    if (s.transcript.length > 400) {
      s.transcript = s.transcript.slice(-400);
    }
  }

  private async handleFilePicker(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "Ekle",
    });
    if (!uris || uris.length === 0) return;
    const uri = uris[0];
    const name = uri.fsPath.split(/[/\\]/).pop() ?? "dosya";
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const imageExts = new Set([
      "jpg",
      "jpeg",
      "png",
      "gif",
      "webp",
      "bmp",
      "svg",
      "ico",
      "tiff",
      "avif",
    ]);
    const binaryExts = new Set([
      "pdf",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "ppt",
      "pptx",
      "zip",
      "rar",
      "7z",
      "tar",
      "gz",
      "exe",
      "dll",
      "bin",
      "dat",
    ]);

    try {
      const bytes = await vscode.workspace.fs.readFile(uri);

      if (imageExts.has(ext)) {
        const mime =
          ext === "svg"
            ? "image/svg+xml"
            : ext === "jpg" || ext === "jpeg"
              ? "image/jpeg"
              : ext === "png"
                ? "image/png"
                : ext === "gif"
                  ? "image/gif"
                  : ext === "webp"
                    ? "image/webp"
                    : "image/png";
        const base64 = Buffer.from(bytes).toString("base64");
        const dataUrl = `data:${mime};base64,${base64}`;
        this.post({
          type: "fileAttached",
          name,
          content: `[Görsel ek: ${uri.fsPath}]`,
          isImage: true,
          dataUrl,
        });
      } else if (binaryExts.has(ext)) {
        this.error(
          `İkili dosya eklenemez: ${name}. Lütfen metin dosyası seçin.`,
        );
      } else {
        const content = Buffer.from(bytes).toString("utf8");
        this.post({ type: "fileAttached", name, content });
      }
    } catch {
      this.error("Dosya okunamadı.");
    }
  }

  private handleEditorContext(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.info("Aktif editör yok.");
      return;
    }
    const filename = editor.document.fileName.split(/[/\\]/).pop() ?? "dosya";
    const sel = editor.selection;
    const content = sel.isEmpty
      ? editor.document.getText()
      : editor.document.getText(sel);
    this.post({ type: "editorContext", filename, content });
  }

  private readConfig(): AgentConfig {
    const c = vscode.workspace.getConfiguration("ors");
    const auto = c.get<Record<string, boolean>>("autoApprove") ?? {};
    const effortMap = {
      low: { temperature: 0.1, numCtx: 32768, maxIterations: 12 },
      medium: { temperature: 0.2, numCtx: 65536, maxIterations: 25 },
      high: { temperature: 0.3, numCtx: 65536, maxIterations: 50 },
    } as const;
    const ef = effortMap[this.effort] ?? effortMap.medium;
    return {
      model: (c.get<string>("model") || this.selectedModel) ?? "",
      temperature: c.get<number>("temperature") ?? ef.temperature,
      numCtx: c.get<number>("contextWindow") ?? ef.numCtx,
      maxIterations: c.get<number>("maxIterations") ?? ef.maxIterations,
      autoApprove: {
        read: auto.read ?? true,
        search: auto.search ?? true,
        list: auto.list ?? true,
        write: auto.write ?? false,
        command: auto.command ?? false,
      },
      mode: this.mode,
      commandAllowlist: c.get<string[]>("commandAllowlist") ?? [],
      commandDenylist: c.get<string[]>("commandDenylist") ?? [],
    };
  }

  private postTo(id: string, m: WebviewBoundMessage): void {
    if (id === this.currentSessionId) this.view?.webview.postMessage(m);
  }

  private post(m: WebviewBoundMessage): void {
    this.view?.webview.postMessage(m);
  }
}
