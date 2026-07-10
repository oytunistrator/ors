export type HostBoundMessage =
  | { type: "ready" }
  | { type: "sendPrompt"; text: string; images?: string[] }
  | { type: "stop" }
  | { type: "newChat" }
  | { type: "getModels" }
  | { type: "selectModel"; model: string }
  | {
      type: "approvalResponse";
      id: string;
      approved: boolean;
      remember?: boolean;
    }
  | { type: "askUserResponse"; id: string; answer: string }
  | { type: "selectMode"; mode: AgentMode; effort?: EffortLevel }
  | { type: "setHost" }
  | { type: "undo" }
  | { type: "switchSession"; id: string }
  | { type: "deleteSession"; id: string }
  | { type: "renameSession"; id: string; name: string }
  | { type: "openFilePicker" }
  | { type: "getEditorContext" }
  | { type: "manageHosts" }
  | { type: "removeHost"; host: string };

export type AgentMode = "manual" | "act" | "plan" | "auto";

export type EffortLevel = "low" | "medium" | "high";

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface SessionMeta {
  id: string;
  name: string;
  active: boolean;
  autoName?: boolean;
  messageCount?: number;
  lastActivity?: number;
}

export interface ToolStatItem {
  name: string;
  calls: number;
  ok: number;
  fail: number;
  totalMs: number;
}

export type WebviewBoundMessage =
  | { type: "models"; models: string[]; current: string; currentHost: string }
  | {
      type: "status";
      state: "idle" | "thinking" | "running";
      label?: string;
      ctxPct?: number;
    }
  | { type: "userMessage"; text: string }
  | { type: "assistantStart" }
  | { type: "assistantToken"; text: string }
  | { type: "assistantEnd" }
  | { type: "assistantDiscard" }
  | { type: "toolStart"; id: string; name: string; summary: string }
  | { type: "toolEnd"; id: string; ok: boolean; detail: string }
  | {
      type: "approvalRequest";
      id: string;
      title: string;
      tool: string;
      preview: string;
      previewKind: "diff" | "command" | "text";
    }
  | { type: "info"; text: string }
  | { type: "error"; text: string }
  | { type: "undoAvailable"; available: boolean }
  | { type: "mode"; mode: AgentMode; effort: EffortLevel }
  | { type: "todos"; items: TodoItem[] }
  | { type: "restore"; items: TranscriptItem[] }
  | { type: "reset" }
  | { type: "sessions"; sessions: SessionMeta[] }
  | { type: "stats"; items: ToolStatItem[] }
  | { type: "askUser"; id: string; title: string; options: string[] }
  | {
      type: "fileAttached";
      name: string;
      content: string;
      isImage?: true;
      dataUrl?: string;
    }
  | { type: "editorContext"; filename: string; content: string }
  | {
      type: "serverStatus";
      status: "online" | "offline" | "checking";
      host: string;
      error?: string;
    }
  | { type: "hosts"; hosts: string[]; current: string };

export type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; summary: string; ok: boolean; detail: string }
  | { kind: "notice"; level: "info" | "error"; text: string };
