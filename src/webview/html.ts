import * as vscode from "vscode";

export function getHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const nonce = makeNonce();
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "main.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "style.css"),
  );
  const iconAnvil = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "icons", "anvil-impact.svg"),
  );
  const iconThinking = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "icons", "thinking.svg"),
  );
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} https: data:`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Örs</title>
</head>
<body data-icon-thinking="${iconThinking}">
  <header id="topbar">
    <span id="sessionTitle" class="session-title">Örs</span>
    <span id="serverIndicator" class="server-indicator" title="Sunucu durumu kontrol ediliyor…">●</span>
    <div class="spacer"></div>
    <button id="historyBtn" class="topbar-btn" title="Tüm sohbetler">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    </button>
    <button id="newChatBtn" class="topbar-btn" title="Yeni sohbet">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
  </header>

  <div id="tabbar" hidden></div>

  <div id="chatsPanel" class="chats-panel" hidden>
    <div id="chatsSearchWrap" class="chats-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input id="chatsSearch" type="text" placeholder="Sohbetlerde ara…" />
    </div>
    <div id="chatsList" class="chats-list"></div>
  </div>

  <div id="todos" hidden></div>

  <main id="messages" aria-live="polite">
    <div id="emptyState" class="empty-state">
      <div class="welcome-brand"><span class="welcome-ast"><img src="${iconAnvil}" width="26" height="26" alt="" aria-hidden="true" /></span> Örs</div>
      <img class="welcome-mascot" src="${iconAnvil}" width="84" height="84" alt="" aria-hidden="true" />
      <div class="welcome-tag">Tired of repeating yourself? Tell Örs what to remember and it'll keep it in mind next time.</div>
      <div id="emptyModeCard" class="empty-mode-card">
        <div class="empty-mode-head">
          <span class="emc-icon">✋</span>
          <span class="emc-title">Manual is enabled</span>
          <button class="emc-close" title="Dismiss">✕</button>
        </div>
        <div class="empty-mode-desc">Ask for approval before making each edit</div>
      </div>
      <div class="empty-tip">Type a message or press <kbd>/</kbd> for commands</div>
    </div>
  </main>

  <footer id="composer">
    <div id="attachedCtx" hidden></div>
    <div id="inputWrap" class="input-wrap">
      <textarea id="input" rows="1" placeholder="Send a message…"></textarea>
      <button id="micBtn" class="mic-btn" title="Sesli giriş">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
      </button>
    </div>
    <div id="cbar">
      <div id="attachWrap" style="position:relative">
        <button id="attachBtn" class="cbar-btn" title="Bağlam ekle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <div id="attachMenu" class="attach-menu" hidden>
          <button id="attachFile" class="attach-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span>Upload from computer</span>
          </button>
          <button id="attachEditor" class="attach-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <span>Add context</span>
          </button>
          <button id="attachWeb" class="attach-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            <span>Browse the web</span>
          </button>
        </div>
      </div>
      <button id="slashBtn" class="cbar-btn slash-btn" title="Slash komutları">/</button>
      <span class="cbar-gap"></span>
      <span id="statusChip" class="chip" hidden></span>
      <span id="ctxChip" class="chip" hidden></span>
      <div id="modelSelectWrap" class="model-select-wrap">
        <button id="modelSelectBtn" class="model-chip" title="Model seç">model</button>
        <div id="modelDropdown" class="model-dropdown" hidden>
          <div id="modelList" class="model-list"></div>
        </div>
      </div>
      <div id="modePickerWrap">
        <button id="modePickerBtn" class="mode-picker-btn" title="Mod seç">⚡ Act</button>
        <div id="modePicker" class="mode-picker" hidden>
          <div class="mode-picker-header">
            <span class="mode-picker-title">Modes</span>
            <span class="mode-picker-hint">
              <kbd>⇧</kbd><span>+</span><kbd>tab</kbd><span>to switch</span>
            </span>
          </div>
          <button class="mode-option" data-mode="manual">
            <span class="mode-opt-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 11V7a2 2 0 0 0-4 0v.5M14 7.5V5a2 2 0 0 0-4 0v2.5M10 7.5V6a2 2 0 0 0-4 0v5a8 8 0 0 0 8 8h2a6 6 0 0 0 6-6v-2a2 2 0 0 0-4 0"/>
              </svg>
            </span>
            <div class="mode-opt-text">
              <div class="mode-opt-name">Manual</div>
              <div class="mode-opt-desc">Ask for approval before making each edit</div>
            </div>
            <span class="mode-opt-check">✓</span>
          </button>
          <button class="mode-option" data-mode="act">
            <span class="mode-opt-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="16 18 22 12 16 6"/>
                <polyline points="8 6 2 12 8 18"/>
              </svg>
            </span>
            <div class="mode-opt-text">
              <div class="mode-opt-name">Edit automatically</div>
              <div class="mode-opt-desc">Edit selected text or the whole file without asking</div>
            </div>
            <span class="mode-opt-check">✓</span>
          </button>
          <button class="mode-option" data-mode="plan">
            <span class="mode-opt-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="8" y1="13" x2="16" y2="13"/>
                <line x1="8" y1="17" x2="16" y2="17"/>
              </svg>
            </span>
            <div class="mode-opt-text">
              <div class="mode-opt-name">Plan mode</div>
              <div class="mode-opt-desc">Explore the code and present a plan before editing</div>
            </div>
            <span class="mode-opt-check">✓</span>
          </button>
          <button class="mode-option" data-mode="auto">
            <span class="mode-opt-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </span>
            <div class="mode-opt-text">
              <div class="mode-opt-name">Auto mode</div>
              <div class="mode-opt-desc">Run everything automatically without asking</div>
            </div>
            <span class="mode-opt-check">✓</span>
          </button>
          <div class="effort-sep"></div>
          <div class="effort-row">
            <span class="effort-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="7" y1="12" x2="17" y2="12"/>
                <path d="M5 8.5v7M8 7v10M16 7v10M19 8.5v7"/>
              </svg>
            </span>
            <span class="effort-label">Effort (<span id="effortLabel">Medium</span>)</span>
            <div class="effort-slider" id="effortSlider" title="Effort">
              <div class="effort-fill" id="effortFill"></div>
              <div class="effort-knob" id="effortKnob"></div>
            </div>
          </div>
          <div class="picker-host-row">
            <button id="hostBtn" class="host-link" title="Ollama host seç / ekle">localhost</button>
          </div>
        </div>
      </div>
      <button id="sendBtn" class="send-btn" title="Gönder">↑</button>
    </div>
  </footer>

  <div id="cmdPalette" class="cmd-palette" hidden>
    <div class="cmd-box">
      <input id="cmdFilter" class="cmd-filter" type="text" placeholder="Filter actions…" spellcheck="false" />
      <div id="cmdList" class="cmd-list"></div>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function makeNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
