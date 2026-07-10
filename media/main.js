// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const messagesEl = $("messages");
  const inputEl = /** @type {HTMLTextAreaElement} */ ($("input"));
  const sendBtn = $("sendBtn");
  const newChatBtn = $("newChatBtn");
  const historyBtn = $("historyBtn");
  const modePickerBtn = $("modePickerBtn");
  const modePicker = $("modePicker");
  const effortLabel = $("effortLabel");
  const todosEl = $("todos");
  const modelSelectBtn = $("modelSelectBtn");
  const modelDropdown = $("modelDropdown");
  const modelList = $("modelList");
  const hostBtn = $("hostBtn");
  const statusChip = $("statusChip");
  const ctxChip = $("ctxChip");
  const slashBtn = $("slashBtn");
  const tabbar = $("tabbar");
  const chatsPanel = $("chatsPanel");
  const chatsSearch = /** @type {HTMLInputElement} */ ($("chatsSearch"));
  const chatsSearchWrap = $("chatsSearchWrap");
  const SEARCH_MIN = 6;
  const chatsList = $("chatsList");
  const attachBtn = $("attachBtn");
  const attachMenu = $("attachMenu");
  const attachedCtx = $("attachedCtx");
  const emptyState = $("emptyState");
  const emptyModeCard = $("emptyModeCard");
  const sessionTitle = $("sessionTitle");
  const serverIndicator = $("serverIndicator");
  let currentMode = "act";
  let currentEffort = "medium";
  let isBusy = false;

  /** @type {{ label: string; content: string; dataUrl?: string } | null} */
  let pendingAttachment = null;

  /** @type {HTMLElement | null} */
  let streamingBubble = null;
  let streamingRaw = "";
  /** @type {{ det: HTMLDetailsElement; sum: HTMLElement; pre: HTMLElement; row: HTMLElement } | null} */
  let streamingThought = null;
  /** @type {HTMLElement | null} */
  let statusRow = null;
  /** @type {number | null} */
  let thinkStartTime = null;
  /** @type {number | null} */
  let thinkEndTime = null;
  /** @type {Map<string, HTMLElement>} */
  const toolCards = new Map();

  function hideEmptyState() {
    if (emptyState) emptyState.hidden = true;
  }
  function showEmptyState() {
    if (emptyState) emptyState.hidden = false;
  }

  attachBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    attachMenu.hidden = !attachMenu.hidden;
  });
  document.addEventListener("click", () => {
    attachMenu.hidden = true;
  });
  attachMenu.addEventListener("click", (e) => e.stopPropagation());

  $("attachFile").addEventListener("click", () => {
    attachMenu.hidden = true;
    vscode.postMessage({ type: "openFilePicker" });
  });
  $("attachEditor").addEventListener("click", () => {
    attachMenu.hidden = true;
    vscode.postMessage({ type: "getEditorContext" });
  });
  $("attachWeb").addEventListener("click", () => {
    attachMenu.hidden = true;
    const url = prompt("Web sayfası URL:");
    if (url && url.trim()) {
      inputEl.value = `Web sayfasını oku: ${url.trim()}\n\n${inputEl.value}`;
      autoGrow();
      inputEl.focus();
    }
  });

  function clearAttachment() {
    pendingAttachment = null;
    attachedCtx.hidden = true;
    while (attachedCtx.firstChild)
      attachedCtx.removeChild(attachedCtx.firstChild);
  }

  function setImageAttachment(name, content, dataUrl) {
    pendingAttachment = { label: name, content, dataUrl };
    attachedCtx.hidden = false;
    while (attachedCtx.firstChild)
      attachedCtx.removeChild(attachedCtx.firstChild);
    const img = document.createElement("img");
    img.src = dataUrl;
    img.className = "attach-img-preview";
    img.alt = name;
    const tag = document.createElement("span");
    tag.className = "attach-tag";
    tag.textContent = name;
    const rm = document.createElement("button");
    rm.className = "attach-remove";
    rm.title = "Kaldır";
    rm.textContent = "✕";
    rm.addEventListener("click", clearAttachment);
    attachedCtx.appendChild(img);
    attachedCtx.appendChild(tag);
    attachedCtx.appendChild(rm);
  }

  function setAttachment(label, content) {
    pendingAttachment = { label, content };
    attachedCtx.hidden = false;
    while (attachedCtx.firstChild)
      attachedCtx.removeChild(attachedCtx.firstChild);
    const tag = document.createElement("span");
    tag.className = "attach-tag";
    tag.textContent = label;
    const rm = document.createElement("button");
    rm.className = "attach-remove";
    rm.title = "Kaldır";
    rm.textContent = "✕";
    rm.addEventListener("click", clearAttachment);
    attachedCtx.appendChild(tag);
    attachedCtx.appendChild(rm);
  }

  function send() {
    let text = inputEl.value.trim();
    if (!text && !pendingAttachment) return;
    /** @type {string[] | undefined} */
    let images;
    if (pendingAttachment) {
      if (pendingAttachment.dataUrl) {
        const b64 = pendingAttachment.dataUrl.replace(
          /^data:[^;]+;base64,/,
          "",
        );
        if (b64) images = [b64];
        const note = `[Görsel: ${pendingAttachment.label}]`;
        text = text ? note + "\n" + text : note;
      } else {
        const header = `[Ek: ${pendingAttachment.label}]\n\`\`\`\n${pendingAttachment.content}\n\`\`\`\n\n`;
        text = header + text;
      }
      clearAttachment();
    }
    if (!text) return;
    vscode.postMessage({ type: "sendPrompt", text, images });
    inputEl.value = "";
    autoGrow();
  }
  sendBtn.addEventListener("click", () => {
    if (isBusy) vscode.postMessage({ type: "stop" });
    else send();
  });

  const micBtn = $("micBtn");
  const SpeechRec =
    /** @type {any} */ (window).SpeechRecognition ||
    /** @type {any} */ (window).webkitSpeechRecognition;
  if (!SpeechRec) {
    micBtn.setAttribute("disabled", "");
    micBtn.title = "Sesli giriş bu ortamda desteklenmiyor";
  } else {
    let recognition = null;
    let listening = false;
    let baseText = "";
    micBtn.addEventListener("click", () => {
      if (listening) {
        if (recognition) recognition.stop();
        return;
      }
      recognition = new SpeechRec();
      recognition.lang = navigator.language || "tr-TR";
      recognition.interimResults = true;
      recognition.continuous = false;
      baseText = inputEl.value.trim();
      recognition.onresult = (e) => {
        let heard = "";
        for (let i = 0; i < e.results.length; i++) {
          heard += e.results[i][0].transcript;
        }
        inputEl.value = baseText ? baseText + " " + heard : heard;
        autoGrow();
      };
      recognition.onerror = (e) => {
        micBtn.title =
          e && e.error === "not-allowed"
            ? "Mikrofon izni reddedildi"
            : "Sesli giriş başlatılamadı";
      };
      recognition.onend = () => {
        listening = false;
        micBtn.classList.remove("recording");
      };
      try {
        recognition.start();
        listening = true;
        micBtn.classList.add("recording");
      } catch {
        listening = false;
        micBtn.classList.remove("recording");
      }
    });
  }
  newChatBtn.addEventListener("click", () =>
    vscode.postMessage({ type: "newChat" }),
  );
  if (historyBtn) {
    historyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = chatsPanel.hidden;
      chatsPanel.hidden = !willOpen;
      if (willOpen) {
        chatsSearch.value = "";
        const showSearch = allSessions.length > SEARCH_MIN;
        chatsSearchWrap.hidden = !showSearch;
        renderChatsList("");
        if (showSearch) chatsSearch.focus();
      }
    });
    chatsPanel.addEventListener("click", (e) => e.stopPropagation());
    chatsSearch.addEventListener("input", () =>
      renderChatsList(chatsSearch.value),
    );
    document.addEventListener("click", () => {
      chatsPanel.hidden = true;
    });
  }

  modePickerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    modePicker.hidden = !modePicker.hidden;
  });
  document.addEventListener("click", () => {
    modePicker.hidden = true;
  });
  modePicker.addEventListener("click", (e) => e.stopPropagation());

  document.querySelectorAll(".mode-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = /** @type {HTMLElement} */ (btn).dataset.mode;
      if (mode) {
        modePicker.hidden = true;
        vscode.postMessage({ type: "selectMode", mode, effort: currentEffort });
      }
    });
  });

  const effortSlider = $("effortSlider");
  const EFFORT_ORDER = ["low", "medium", "high"];
  if (effortSlider) {
    effortSlider.addEventListener("click", (e) => {
      const rect = effortSlider.getBoundingClientRect();
      const ratio =
        /** @type {MouseEvent} */ (e.clientX - rect.left) / rect.width;
      const effort = EFFORT_ORDER[ratio < 0.34 ? 0 : ratio < 0.67 ? 1 : 2];
      currentEffort = effort;
      updateEffortUI(effort);
      vscode.postMessage({ type: "selectMode", mode: currentMode, effort });
    });
  }

  if (emptyModeCard) {
    emptyModeCard.addEventListener("click", (e) => {
      if (/** @type {Element} */ (e.target).closest(".emc-close")) {
        emptyModeCard.hidden = true;
      }
    });
  }

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  inputEl.addEventListener("input", autoGrow);
  function autoGrow() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
  }

  modelSelectBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    modelDropdown.hidden = !modelDropdown.hidden;
  });
  document.addEventListener("click", () => {
    modelDropdown.hidden = true;
  });
  modelDropdown.addEventListener("click", (e) => e.stopPropagation());

  modelList.addEventListener("click", (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest(".model-opt");
    if (!btn) return;
    const model = btn.dataset.model;
    if (model) {
      modelDropdown.hidden = true;
      modelSelectBtn.textContent = model;
      vscode.postMessage({ type: "selectModel", model });
    }
  });

  hostBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "setHost" });
  });

  const cmdPalette = $("cmdPalette");
  const cmdFilter = /** @type {HTMLInputElement} */ ($("cmdFilter"));
  const cmdList = $("cmdList");

  /**
   * @typedef {{ label: string; act: () => void; right?: () => string }} PaletteItem
   * @typedef {{ group: string; items: PaletteItem[] }} PaletteGroup
   */
  /** @type {PaletteGroup[]} */
  const PALETTE_GROUPS = [
    {
      group: "Context",
      items: [
        {
          label: "Attach file…",
          act: () => vscode.postMessage({ type: "openFilePicker" }),
        },
        {
          label: "Add editor context…",
          act: () => vscode.postMessage({ type: "getEditorContext" }),
        },
        {
          label: "Clear conversation",
          act: () => vscode.postMessage({ type: "newChat" }),
        },
        {
          label: "Undo last change",
          act: () => vscode.postMessage({ type: "undo" }),
        },
      ],
    },
    {
      group: "Model",
      items: [
        {
          label: "Switch model…",
          right: () => modelSelectBtn.textContent || "",
          act: () => {
            modelDropdown.hidden = !modelDropdown.hidden;
          },
        },
        {
          label: "Change mode…",
          right: () => currentMode,
          act: () => {
            modePicker.hidden = false;
          },
        },
        {
          label: "Adjust effort…",
          right: () => currentEffort,
          act: () => {
            modePicker.hidden = false;
          },
        },
        {
          label: "Manage hosts…",
          right: () =>
            hostBtn.textContent === "localhost" ? "local" : hostBtn.textContent,
          act: () => {
            vscode.postMessage({ type: "manageHosts" });
          },
        },
      ],
    },
  ];

  /** @type {{ el: HTMLElement; act: () => void }[]} */
  let paletteItems = [];
  let paletteSel = 0;

  function openCmdPalette() {
    cmdFilter.value = "";
    buildCmdPalette("");
    cmdPalette.hidden = false;
    cmdFilter.focus();
  }
  function closeCmdPalette() {
    cmdPalette.hidden = true;
  }

  /** @param {string} query */
  function buildCmdPalette(query) {
    const q = query.trim().toLowerCase();
    cmdList.innerHTML = "";
    paletteItems = [];
    for (const g of PALETTE_GROUPS) {
      const matched = g.items.filter((it) =>
        it.label.toLowerCase().includes(q),
      );
      if (!matched.length) continue;
      const gl = document.createElement("div");
      gl.className = "cmd-group";
      gl.textContent = g.group;
      cmdList.appendChild(gl);
      for (const it of matched) {
        const row = document.createElement("button");
        row.className = "cmd-row";
        const lbl = document.createElement("span");
        lbl.className = "cmd-lbl";
        lbl.textContent = it.label;
        row.appendChild(lbl);
        if (it.right) {
          const rt = document.createElement("span");
          rt.className = "cmd-rt";
          rt.textContent = it.right();
          row.appendChild(rt);
        }
        const idx = paletteItems.length;
        row.addEventListener("click", () => runCmdPalette(idx));
        row.addEventListener("mousemove", () => {
          paletteSel = idx;
          highlightCmdPalette();
        });
        cmdList.appendChild(row);
        paletteItems.push({ el: row, act: it.act });
      }
    }
    paletteSel = 0;
    highlightCmdPalette();
  }

  function highlightCmdPalette() {
    paletteItems.forEach((p, i) =>
      p.el.classList.toggle("sel", i === paletteSel),
    );
    const cur = paletteItems[paletteSel];
    if (cur) cur.el.scrollIntoView({ block: "nearest" });
  }

  /** @param {number} i */
  function runCmdPalette(i) {
    const item = paletteItems[i];
    if (!item) return;
    closeCmdPalette();
    setTimeout(item.act, 0);
  }

  cmdFilter.addEventListener("input", () => buildCmdPalette(cmdFilter.value));
  cmdFilter.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      paletteSel = Math.min(paletteSel + 1, paletteItems.length - 1);
      highlightCmdPalette();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      paletteSel = Math.max(paletteSel - 1, 0);
      highlightCmdPalette();
    } else if (e.key === "Enter") {
      e.preventDefault();
      runCmdPalette(paletteSel);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeCmdPalette();
    }
  });
  cmdPalette.addEventListener("click", (e) => {
    if (e.target === cmdPalette) closeCmdPalette();
  });

  slashBtn.addEventListener("click", () => openCmdPalette());
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      if (cmdPalette.hidden) openCmdPalette();
      else closeCmdPalette();
    }
  });

  messagesEl.addEventListener("click", (e) => {
    const btn = /** @type {Element} */ (e.target).closest(".copy-btn");
    if (!btn) return;
    const codeEl = btn.closest(".code-block")?.querySelector("code");
    if (!codeEl) return;
    const text = codeEl.textContent ?? "";
    navigator.clipboard
      .writeText(text)
      .then(() => {
        btn.textContent = "✓";
        setTimeout(() => {
          btn.textContent = "Copy";
        }, 1500);
      })
      .catch(() => {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        btn.textContent = "✓";
        setTimeout(() => {
          btn.textContent = "Copy";
        }, 1500);
      });
  });

  window.addEventListener("message", (event) => {
    const m = event.data;
    switch (m.type) {
      case "models":
        fillModels(m.models, m.current);
        if (m.currentHost) updateHostBtn(m.currentHost);
        break;
      case "status":
        setBusy(m.state !== "idle");
        setCtxChip(m.ctxPct);
        if (m.state === "thinking") showStatusRow("Thinking…");
        else removeStatusRow();
        break;
      case "userMessage":
        addMessage("user", m.text);
        break;
      case "assistantStart":
        startAssistant();
        break;
      case "assistantToken":
        appendAssistant(m.text);
        break;
      case "assistantEnd":
        endAssistant();
        break;
      case "assistantDiscard":
        discardAssistant();
        break;
      case "toolStart":
        addToolCard(m.id, m.name, m.summary);
        break;
      case "toolEnd":
        endToolCard(m.id, m.ok, m.detail);
        break;
      case "approvalRequest":
        addApproval(m);
        break;
      case "askUser":
        addAskUser(m);
        break;
      case "info":
        addNotice("info", m.text);
        break;
      case "error":
        addNotice("error", m.text);
        break;
      case "mode":
        setMode(m.mode, m.effort);
        break;
      case "todos":
        renderTodos(m.items);
        break;
      case "restore":
        restoreTranscript(m.items);
        break;
      case "reset":
        Array.from(messagesEl.children).forEach((c) => {
          if (c.id !== "emptyState") c.remove();
        });
        showEmptyState();
        streamingBubble = null;
        statusRow = null;
        toolCards.clear();
        setBusy(false);
        break;
      case "sessions":
        updateSessions(m.sessions);
        break;
      case "stats":
        break;
      case "fileAttached":
        if (m.isImage && m.dataUrl) {
          setImageAttachment(m.name, m.content, m.dataUrl);
        } else {
          setAttachment(m.name, m.content);
        }
        break;
      case "editorContext":
        setAttachment(m.filename, m.content);
        break;
      case "serverStatus":
        updateServerStatus(m.status, m.host, m.error);
        break;
      case "hosts":
        updateHostBtn(m.current);
        break;
    }
    scrollToBottom();
  });

  function restoreTranscript(items) {
    Array.from(messagesEl.children).forEach((c) => {
      if (c.id !== "emptyState") c.remove();
    });
    streamingBubble = null;
    toolCards.clear();
    const list = items || [];
    if (!list.length) {
      showEmptyState();
      return;
    }
    for (const it of list) {
      if (it.kind === "user") addMessage("user", it.text);
      else if (it.kind === "assistant") addMessage("assistant", it.text);
      else if (it.kind === "tool") {
        addToolCard("r" + Math.random(), it.name, it.summary);
        const last = messagesEl.lastElementChild;
        if (last) {
          last.classList.add(it.ok ? "ok" : "fail");
          const outDet = document.createElement("details");
          outDet.className = "tool-out";
          const outSum = document.createElement("summary");
          outSum.textContent = "OUT";
          const outPre = document.createElement("pre");
          outPre.textContent = it.detail || (it.ok ? "done" : "error");
          outDet.appendChild(outSum);
          outDet.appendChild(outPre);
          last.appendChild(outDet);
        }
      } else if (it.kind === "notice") addNotice(it.level, it.text);
    }
  }

  function fillModels(models, current) {
    modelList.innerHTML = "";
    if (!models.length) {
      modelSelectBtn.textContent = "(model yok)";
      return;
    }
    for (const name of models) {
      const btn = document.createElement("button");
      btn.className = "model-opt" + (name === current ? " selected" : "");
      btn.dataset.model = name;
      btn.textContent = name;
      if (name === current) {
        modelSelectBtn.textContent = name;
      }
      modelList.appendChild(btn);
    }
    if (!current || !models.includes(current)) {
      const first = models[0];
      modelSelectBtn.textContent = first;
      vscode.postMessage({ type: "selectModel", model: first });
    }
  }

  function updateServerStatus(status, host, error) {
    if (!serverIndicator) return;
    serverIndicator.className = "server-indicator " + status;
    if (status === "online") {
      serverIndicator.title = "✅ Sunucu çevrimiçi: " + host;
    } else if (status === "offline") {
      serverIndicator.title =
        "❌ Sunucu çevrimdışı: " + host + (error ? " — " + error : "");
    } else {
      serverIndicator.title = "⏳ Sunucu durumu kontrol ediliyor: " + host;
    }
  }

  function updateHostBtn(hostUrl) {
    try {
      const u = new URL(hostUrl);
      hostBtn.textContent =
        u.hostname === "localhost" || u.hostname === "127.0.0.1"
          ? "localhost"
          : u.hostname;
      hostBtn.title = `Ollama host: ${hostUrl} — değiştirmek için tıkla`;
    } catch {
      hostBtn.textContent = "host";
    }
  }

  function setBusy(busy) {
    isBusy = busy;
    sendBtn.classList.toggle("is-stop", busy);
    sendBtn.textContent = busy ? "■" : "↑";
    sendBtn.title = busy ? "Durdur" : "Gönder";
    inputEl.disabled = false;
    if (!busy) {
      setStatusChip(undefined);
      setCtxChip(undefined);
    }
  }

  /** @param {string | undefined} label */
  function setStatusChip(label) {
    if (!label) {
      statusChip.hidden = true;
      statusChip.textContent = "";
      return;
    }
    statusChip.textContent = "▶ " + label;
    statusChip.hidden = false;
  }

  /** @param {number | undefined | null} pct */
  function setCtxChip(pct) {
    if (pct === undefined || pct === null) {
      ctxChip.hidden = true;
      return;
    }
    ctxChip.textContent = "\u25CF " + pct + "% used";
    ctxChip.hidden = false;
    ctxChip.className =
      "chip" + (pct >= 90 ? " ctx-danger" : pct >= 70 ? " ctx-warn" : "");
  }

  function addMessage(role, text) {
    hideEmptyState();
    const wrap = document.createElement("div");
    wrap.className = "msg " + role;
    const r = document.createElement("div");
    r.className = "role";
    r.textContent = role === "user" ? "sen" : "ajan";
    const b = document.createElement("div");
    b.className = "bubble";
    b.innerHTML = renderMarkdown(text);
    wrap.appendChild(r);
    wrap.appendChild(b);
    messagesEl.appendChild(wrap);
    return b;
  }

  /**
   * Ajan düşünürken transcript'in en altında canlı durum satırı ("Thinking…" göstergesi).
   * @param {string} label
   */
  function showStatusRow(label) {
    hideEmptyState();
    if (!statusRow) {
      statusRow = document.createElement("div");
      statusRow.className = "status-msg";
      const ast = document.createElement("span");
      ast.className = "status-ast";
      const img = document.createElement("img");
      img.src = document.body.dataset.iconThinking || "";
      img.width = 18;
      img.height = 18;
      img.alt = "";
      ast.appendChild(img);
      const txt = document.createElement("span");
      txt.className = "status-txt";
      statusRow.appendChild(ast);
      statusRow.appendChild(txt);
    }
    /** @type {HTMLElement} */ (
      statusRow.querySelector(".status-txt")
    ).textContent = label;
    messagesEl.appendChild(statusRow);
  }
  function removeStatusRow() {
    if (statusRow) {
      statusRow.remove();
      statusRow = null;
    }
  }

  function startAssistant() {
    removeStatusRow();
    streamingRaw = "";
    thinkStartTime = null;
    thinkEndTime = null;
    streamingThought = null;
    streamingBubble = addMessage("assistant", "");
    streamingBubble.classList.add("typing");
  }
  function appendAssistant(text) {
    if (!streamingBubble) startAssistant();
    streamingRaw += text;
    if (!thinkStartTime && streamingRaw.startsWith("<think>")) {
      thinkStartTime = Date.now();
    }
    if (thinkStartTime && !thinkEndTime && streamingRaw.includes("</think>")) {
      thinkEndTime = Date.now();
    }
    const elapsedSecs =
      thinkStartTime && thinkEndTime
        ? Math.round((thinkEndTime - thinkStartTime) / 1000)
        : null;
    const split = splitThink(streamingRaw);
    updateThoughtRow(split, elapsedSecs);
    /** @type {HTMLElement} */ (streamingBubble).innerHTML = renderMarkdown(
      split.body,
    );
  }
  function endAssistant() {
    if (streamingBubble) streamingBubble.classList.remove("typing");
    streamingBubble = null;
    streamingThought = null;
  }
  function discardAssistant() {
    if (streamingThought) {
      streamingThought.row.remove();
      streamingThought = null;
    }
    if (streamingBubble) {
      const wrap = streamingBubble.closest(".msg");
      if (wrap) wrap.remove();
      streamingBubble = null;
    }
  }

  /**
   * <think>…</think> bloğunu gövdeden ayırır. Tek sorumluluk: metni parçalamak.
   * @param {string} text
   * @returns {{ hasThink: boolean; closed: boolean; thought: string; body: string }}
   */
  function splitThink(text) {
    if (!text.startsWith("<think>")) {
      return { hasThink: false, closed: false, thought: "", body: text };
    }
    const closeIdx = text.indexOf("</think>");
    if (closeIdx >= 0) {
      return {
        hasThink: true,
        closed: true,
        thought: text.slice(7, closeIdx),
        body: text.slice(closeIdx + 8).replace(/^\n+/, ""),
      };
    }
    return { hasThink: true, closed: false, thought: text.slice(7), body: "" };
  }

  /**
   * Düşünceyi asistan balonunun ÜSTÜNE ayrı bir timeline satırı olarak işler.
   * Tek sorumluluk: düşünce satırının DOM'unu kurmak/güncellemek.
   * @param {{ hasThink: boolean; closed: boolean; thought: string; body: string }} split
   * @param {number | null} elapsedSecs
   */
  function updateThoughtRow(split, elapsedSecs) {
    if (!split.hasThink) {
      if (streamingThought) {
        streamingThought.row.remove();
        streamingThought = null;
      }
      return;
    }
    if (!streamingThought) {
      const row = document.createElement("div");
      row.className = "thought";
      const det = /** @type {HTMLDetailsElement} */ (
        document.createElement("details")
      );
      det.className = "think-block";
      const sum = document.createElement("summary");
      const pre = document.createElement("pre");
      pre.className = "think-pre";
      det.appendChild(sum);
      det.appendChild(pre);
      row.appendChild(det);
      const wrap = /** @type {HTMLElement} */ (streamingBubble).closest(".msg");
      messagesEl.insertBefore(row, wrap);
      streamingThought = { row, det, sum, pre };
    }
    streamingThought.pre.textContent = split.thought;
    if (split.closed) {
      streamingThought.sum.textContent =
        elapsedSecs != null ? `Thought for ${elapsedSecs}s` : "Thought";
      streamingThought.det.open = false;
    } else {
      streamingThought.sum.textContent = "Thinking…";
      streamingThought.det.open = true;
    }
  }

  function makeCopyBlock(text) {
    const block = document.createElement("div");
    block.className = "code-block";
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "Copy";
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = text;
    pre.appendChild(code);
    block.appendChild(btn);
    block.appendChild(pre);
    return block;
  }

  function addToolCard(id, name, summary) {
    hideEmptyState();
    removeStatusRow();
    const card = document.createElement("div");
    card.className = "tool";

    const head = document.createElement("div");
    head.className = "head";
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = name;
    head.appendChild(nameEl);
    const isCmd = name === "run_command";
    if (summary && !isCmd) {
      const desc = document.createElement("span");
      desc.className = "desc";
      desc.textContent = summary;
      head.appendChild(desc);
    }
    card.appendChild(head);
    if (summary && isCmd) {
      card.appendChild(makeCopyBlock(summary));
    }

    messagesEl.appendChild(card);
    toolCards.set(id, card);
  }
  function endToolCard(id, ok, detail) {
    const card = toolCards.get(id);
    if (!card) return;
    card.classList.add(ok ? "ok" : "fail");

    const outDet = document.createElement("details");
    outDet.className = "tool-out";
    const outSum = document.createElement("summary");
    outSum.textContent = "OUT";
    const outPre = document.createElement("pre");
    outPre.textContent = detail || (ok ? "done" : "error");
    outDet.appendChild(outSum);
    outDet.appendChild(outPre);
    card.appendChild(outDet);

    toolCards.delete(id);
  }

  function addApproval(m) {
    hideEmptyState();
    const card = document.createElement("div");
    card.className = "approval";

    const header = document.createElement("div");
    header.className = "approval-header";
    const badge = document.createElement("span");
    badge.className = "approval-tool";
    badge.textContent = m.tool;
    const title = document.createElement("span");
    title.className = "approval-title";
    title.textContent = m.title;
    header.appendChild(badge);
    header.appendChild(title);

    let body;
    if (m.previewKind === "diff") {
      body = document.createElement("pre");
      body.className = "diff";
      body.innerHTML = renderDiff(m.preview);
    } else if (m.previewKind === "command") {
      body = makeCopyBlock(m.preview);
    } else {
      body = document.createElement("pre");
      body.textContent = m.preview;
    }

    const q = document.createElement("div");
    q.className = "approval-q";
    q.textContent = "Do you want to proceed?";

    const opts = document.createElement("div");
    opts.className = "approval-opts";
    const verdict = document.createElement("div");
    verdict.className = "verdict";
    verdict.hidden = true;

    let resolved = false;
    const respond = (choice) => {
      if (resolved) return;
      resolved = true;
      document.removeEventListener("keydown", onKey);
      const approved = choice !== "no";
      vscode.postMessage({
        type: "approvalResponse",
        id: m.id,
        approved,
        remember: choice === "remember",
      });
      card.classList.add("resolved", approved ? "approved" : "rejected");
      q.hidden = true;
      opts.hidden = true;
      verdict.hidden = false;
      verdict.textContent = approved ? "✓ Approved" : "✗ Rejected";
    };

    const optDefs = [{ label: "Yes", kbd: "⏎", choice: "yes" }];
    if (m.tool === "run_command") {
      optDefs.push({
        label: `Yes, and don't ask again for ${m.tool}`,
        choice: "remember",
      });
    }
    optDefs.push({
      label: "No, and tell Örs what to do differently",
      kbd: "Esc",
      choice: "no",
    });

    optDefs.forEach((d, i) => {
      const btn = document.createElement("button");
      btn.className = "approval-opt" + (i === 0 ? " sel" : "");
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(i + 1);
      btn.appendChild(num);
      btn.appendChild(document.createTextNode(" " + d.label));
      if (d.kbd) {
        const k = document.createElement("kbd");
        k.textContent = d.kbd;
        btn.appendChild(k);
      }
      btn.addEventListener("click", () => respond(d.choice));
      opts.appendChild(btn);
    });

    const onKey = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.key === "Enter") {
        e.preventDefault();
        respond("yes");
      } else if (e.key === "Escape") {
        e.preventDefault();
        respond("no");
      }
    };
    document.addEventListener("keydown", onKey);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(q);
    card.appendChild(opts);
    card.appendChild(verdict);
    messagesEl.appendChild(card);
    const first = opts.querySelector(".approval-opt");
    if (first) first.focus();
  }

  function addAskUser(m) {
    hideEmptyState();
    const card = document.createElement("div");
    card.className = "ask-user";

    const titleEl = document.createElement("div");
    titleEl.className = "title";
    titleEl.textContent = m.title;

    const btns = document.createElement("div");
    btns.className = "ask-options";

    const respond = (answer) => {
      vscode.postMessage({ type: "askUserResponse", id: m.id, answer });
      card.classList.add("resolved");
      btns.innerHTML = `<span class="verdict">✓ ${esc(answer)}</span>`;
    };

    for (const opt of m.options || []) {
      const btn = document.createElement("button");
      btn.className = "ask-opt";
      btn.textContent = opt;
      btn.addEventListener("click", () => respond(opt));
      btns.appendChild(btn);
    }

    card.appendChild(titleEl);
    card.appendChild(btns);
    messagesEl.appendChild(card);
  }

  /** @typedef {{ id: string; name: string; active: boolean; messageCount?: number; lastActivity?: number }} Session */
  /** @type {Session[]} */
  let allSessions = [];

  /** @param {Session[]} sessions */
  function updateSessions(sessions) {
    allSessions = sessions || [];
    renderTabs();
    if (!chatsPanel.hidden) renderChatsList(chatsSearch.value);
  }

  function renderTabs() {
    if (allSessions.length <= 1) {
      tabbar.hidden = true;
      tabbar.innerHTML = "";
      return;
    }
    tabbar.hidden = false;
    tabbar.innerHTML = "";
    for (const s of allSessions) {
      const tab = document.createElement("div");
      tab.className = "tab" + (s.active ? " active" : "");
      tab.title = s.name;
      const nm = document.createElement("span");
      nm.className = "tab-nm";
      nm.textContent = s.name;
      tab.appendChild(nm);
      const x = document.createElement("span");
      x.className = "tab-x";
      x.textContent = "✕";
      x.title = "Sekmeyi kapat";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: "deleteSession", id: s.id });
      });
      tab.appendChild(x);
      tab.addEventListener("click", () => {
        if (!s.active) vscode.postMessage({ type: "switchSession", id: s.id });
      });
      tabbar.appendChild(tab);
    }
    const add = document.createElement("button");
    add.className = "tab-new";
    add.title = "Yeni sekme";
    add.textContent = "＋";
    add.addEventListener("click", () =>
      vscode.postMessage({ type: "newChat" }),
    );
    tabbar.appendChild(add);
  }

  /** @param {string} filter */
  function renderChatsList(filter) {
    const q = (filter || "").trim().toLowerCase();
    chatsList.innerHTML = "";
    const matches = allSessions.filter(
      (s) => !q || s.name.toLowerCase().includes(q),
    );
    if (matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "chats-empty";
      empty.textContent = q ? "Eşleşen sohbet yok." : "Sohbet yok.";
      chatsList.appendChild(empty);
      return;
    }
    for (const s of matches) chatsList.appendChild(buildChatRow(s));
  }

  /** @param {Session} s */
  function buildChatRow(s) {
    const row = document.createElement("div");
    row.className = "chat-row" + (s.active ? " active" : "");

    const body = document.createElement("div");
    body.className = "chat-body";
    const nm = document.createElement("div");
    nm.className = "chat-nm";
    nm.textContent = s.name;
    const meta = document.createElement("div");
    meta.className = "chat-meta";
    meta.textContent = chatMeta(s);
    body.appendChild(nm);
    body.appendChild(meta);
    row.appendChild(body);

    const act = document.createElement("div");
    act.className = "chat-act";
    const edit = document.createElement("button");
    edit.className = "chat-ib";
    edit.title = "Yeniden adlandır";
    edit.textContent = "✎";
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      startRename(body, s);
    });
    const del = document.createElement("button");
    del.className = "chat-ib";
    del.title = "Sil";
    del.textContent = "✕";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: "deleteSession", id: s.id });
    });
    act.appendChild(edit);
    act.appendChild(del);
    row.appendChild(act);

    row.addEventListener("click", () => {
      if (!s.active) vscode.postMessage({ type: "switchSession", id: s.id });
      chatsPanel.hidden = true;
    });
    return row;
  }

  /** @param {HTMLElement} body @param {Session} s */
  function startRename(body, s) {
    const input = document.createElement("input");
    input.className = "chat-rename";
    input.value = s.name;
    let done = false;
    body.replaceWith(input);
    input.focus();
    input.select();
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v && v !== s.name) {
        vscode.postMessage({ type: "renameSession", id: s.id, name: v });
      } else {
        renderChatsList(chatsSearch.value);
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", (e) => e.stopPropagation());
  }

  /** @param {Session} s */
  function chatMeta(s) {
    const n = s.messageCount || 0;
    const parts = [n + " mesaj"];
    const rel = relTime(s.lastActivity);
    if (rel) parts.push(rel);
    return parts.join(" · ");
  }

  /** @param {number | undefined} ts */
  function relTime(ts) {
    if (!ts) return "";
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return "az önce";
    const m = Math.floor(sec / 60);
    if (m < 60) return m + " dk önce";
    const h = Math.floor(m / 60);
    if (h < 24) return h + " saat önce";
    const d = Math.floor(h / 24);
    if (d === 1) return "dün";
    if (d < 7) return d + " gün önce";
    return new Date(ts).toLocaleDateString();
  }

  function addNotice(kind, text) {
    hideEmptyState();
    const n = document.createElement("div");
    n.className = "notice " + kind;
    n.textContent = text;
    messagesEl.appendChild(n);
  }

  /** @param {string} effort */
  function updateEffortUI(effort) {
    const pct = { low: 8, medium: 50, high: 92 };
    const p = pct[effort] ?? 50;
    const fill = $("effortFill");
    const knob = $("effortKnob");
    if (fill) fill.style.width = p + "%";
    if (knob) knob.style.left = p + "%";
    const effortNames = { low: "Low", medium: "Medium", high: "High" };
    if (effortLabel) effortLabel.textContent = effortNames[effort] || effort;
  }

  function setMode(mode, effort) {
    currentMode = mode;
    if (effort) currentEffort = effort;
    const icons = { manual: "✋", act: "</>", plan: "📋", auto: "⚡" };
    const labels = {
      manual: "Manual",
      act: "Edit automatically",
      plan: "Plan mode",
      auto: "Auto mode",
    };
    const descs = {
      manual: "Ask for approval before making each edit",
      act: "Edit selected text or the whole file without asking",
      plan: "Explore the code and present a plan before editing",
      auto: "Run everything automatically without asking",
    };
    modePickerBtn.textContent =
      (icons[mode] || "⚡") + " " + (labels[mode] || mode);
    if (emptyModeCard) {
      emptyModeCard.hidden = false;
      emptyModeCard.innerHTML =
        `<div class="empty-mode-head">` +
        `<span class="emc-icon">${icons[mode] || "⚡"}</span>` +
        `<span class="emc-title">${esc(labels[mode] || mode)} is enabled</span>` +
        `<button class="emc-close" title="Dismiss">✕</button>` +
        `</div>` +
        `<div class="empty-mode-desc">${esc(descs[mode] || "")}</div>`;
    }
    document.querySelectorAll(".mode-option").forEach((btn) => {
      const el = /** @type {HTMLElement} */ (btn);
      el.classList.toggle("selected", el.dataset.mode === mode);
    });
    updateEffortUI(currentEffort);
  }

  function renderTodos(items) {
    if (!items || items.length === 0) {
      todosEl.hidden = true;
      todosEl.innerHTML = "";
      return;
    }
    todosEl.hidden = false;
    const rows = items
      .map((t) => {
        const icon =
          t.status === "completed"
            ? "✓"
            : t.status === "in_progress"
              ? "▸"
              : "○";
        return `<div class="todo ${t.status}"><span class="ti">${icon}</span>${esc(t.content)}</div>`;
      })
      .join("");
    const done = items.filter((t) => t.status === "completed").length;
    todosEl.innerHTML =
      `<div class="todos-head">Tasks ${done}/${items.length}</div>` + rows;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /**
   * Markdown → HTML. Tek sorumluluk: biçimlendirme. Düşünce bloğu streaming
   * katmanında ayrı bir timeline satırı olarak işlenir; burada ele alınmaz.
   * @param {string} text
   */
  function renderMarkdown(text) {
    let s = esc(text);
    s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
      return `<div class="code-block"><button class="copy-btn">Copy</button><pre><code>${code.replace(/\n$/, "")}</code></pre></div>`;
    });
    s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\n/g, "<br/>");
    s = s.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_, code) => {
      return `<pre><code>${code.replace(/<br\/>/g, "\n")}</code></pre>`;
    });
    return s;
  }
  function renderDiff(text) {
    return String(text)
      .split("\n")
      .map((line) => {
        const c = line.charAt(0);
        const cls = c === "+" ? "add" : c === "-" ? "del" : "";
        return cls ? `<span class="${cls}">${esc(line)}</span>` : esc(line);
      })
      .join("\n");
  }

  vscode.postMessage({ type: "ready" });
})();
