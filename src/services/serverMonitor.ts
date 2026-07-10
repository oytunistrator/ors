import * as vscode from "vscode";

export type ServerStatus = "online" | "offline" | "checking";

export interface ServerInfo {
  status: ServerStatus;
  host: string;
  lastOnline?: number;
  lastOffline?: number;
  error?: string;
}

export class ServerMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private _status: ServerStatus = "checking";
  private _lastOnline: number | undefined;
  private _lastOffline: number | undefined;
  private _error: string | undefined;
  private _currentHost = "";

  private readonly _onStatusChange = new vscode.EventEmitter<ServerInfo>();
  readonly onStatusChange: vscode.Event<ServerInfo> = this._onStatusChange.event;

  private readonly _onServerOnline = new vscode.EventEmitter<string>();
  readonly onServerOnline: vscode.Event<string> = this._onServerOnline.event;

  private readonly _onServerOffline = new vscode.EventEmitter<string>();
  readonly onServerOffline: vscode.Event<string> = this._onServerOffline.event;

  private readonly _onError = new vscode.EventEmitter<string>();
  readonly onError: vscode.Event<string> = this._onError.event;

  constructor(private readonly getBaseUrl: () => string) {
    this._currentHost = getBaseUrl();
  }

  start(intervalMs = 30_000): void {
    this.stop();
    this._currentHost = this.getBaseUrl();
    this.check();
    this.timer = setInterval(() => this.check(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  restart(): void {
    this._currentHost = this.getBaseUrl();
    this._error = undefined;
    this.start();
  }

  get status(): ServerStatus {
    return this._status;
  }

  get currentHost(): string {
    return this._currentHost;
  }

  get info(): ServerInfo {
    return {
      status: this._status,
      host: this._currentHost,
      lastOnline: this._lastOnline,
      lastOffline: this._lastOffline,
      error: this._error,
    };
  }

  async check(): Promise<ServerStatus> {
    const host = this.getBaseUrl();
    this._currentHost = host;

    // Don't emit "checking" on every poll to avoid flickering
    const wasOffline = this._status === "offline";

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);

      const res = await fetch(`${host.replace(/\/+$/, "")}/api/tags`, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        const previousStatus = this._status;
        this._status = "online";
        this._lastOnline = Date.now();
        this._error = undefined;

        if (previousStatus !== "online") {
          this._onStatusChange.fire(this.info);
          this._onServerOnline.fire(host);
        }

        // If was offline and now online, also notify
        if (wasOffline) {
          this._onServerOnline.fire(host);
        }
      } else {
        this.setOffline(host, `HTTP ${res.status}: ${res.statusText}`);
      }
    } catch (err) {
      const message = (err as Error).name === "AbortError"
        ? "Zaman aşımı (5s)"
        : (err as Error).message;
      this.setOffline(host, message);
    }

    return this._status;
  }

  private setOffline(host: string, error: string): void {
    const previousStatus = this._status;
    this._status = "offline";
    this._lastOffline = Date.now();
    this._error = error;

    if (previousStatus !== "offline") {
      this._onStatusChange.fire(this.info);
      this._onServerOffline.fire(host);
      this._onError.fire(error);
    }
  }

  dispose(): void {
    this.stop();
    this._onStatusChange.dispose();
    this._onServerOnline.dispose();
    this._onServerOffline.dispose();
    this._onError.dispose();
  }
}
