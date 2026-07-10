"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// e2e/coding.ts
var os = __toESM(require("os"));
var fs4 = __toESM(require("fs"));
var path5 = __toESM(require("path"));

// src/llm/ollamaClient.ts
var OllamaClient = class {
  constructor(getBaseUrl) {
    this.getBaseUrl = getBaseUrl;
  }
  idCounter = 0;
  base() {
    return this.getBaseUrl().replace(/\/+$/, "");
  }
  async chat(opts) {
    const controller = new AbortController();
    const sub = opts.token?.onCancellationRequested(() => controller.abort());
    let res;
    try {
      res = await fetch(`${this.base()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages.map(toWireMessage),
          tools: opts.tools.length ? opts.tools : void 0,
          stream: true,
          keep_alive: "5m",
          options: {
            temperature: opts.temperature,
            num_ctx: opts.numCtx
          }
        })
      });
    } catch (err) {
      sub?.dispose();
      if (controller.signal.aborted) {
        throw new CancelledError();
      }
      throw new Error(
        `Ollama'ya ba\u011Flan\u0131lamad\u0131 (${this.base()}). Ollama \xE7al\u0131\u015F\u0131yor mu? Ayr\u0131nt\u0131: ${err.message}`
      );
    }
    if (!res.ok) {
      sub?.dispose();
      const body = await res.text().catch(() => "");
      throw new Error(
        `Ollama /api/chat ${res.status} d\xF6nd\xFCrd\xFC. ${body.slice(0, 400)}`
      );
    }
    if (!res.body) {
      sub?.dispose();
      throw new Error("Ollama yan\u0131t\u0131nda g\xF6vde yok.");
    }
    let content = "";
    const toolCalls = [];
    try {
      for await (const line of readNdjson(res.body)) {
        if (opts.token?.isCancellationRequested) {
          controller.abort();
          throw new CancelledError();
        }
        let chunk;
        try {
          chunk = JSON.parse(line);
        } catch {
          continue;
        }
        if (chunk.error) {
          throw new Error(`Ollama: ${chunk.error}`);
        }
        const msg = chunk.message;
        if (msg?.content) {
          content += msg.content;
          opts.onToken?.(msg.content);
        }
        if (msg?.tool_calls?.length) {
          for (const tc of msg.tool_calls) {
            toolCalls.push({
              id: `call_${++this.idCounter}`,
              name: tc.function?.name ?? "",
              arguments: normalizeArgs(tc.function?.arguments)
            });
          }
        }
        if (chunk.done) {
          break;
        }
      }
    } finally {
      sub?.dispose();
    }
    return { content, toolCalls };
  }
  async listModels() {
    const res = await fetch(`${this.base()}/api/tags`);
    if (!res.ok) {
      throw new Error(`Ollama /api/tags ${res.status}`);
    }
    const data = await res.json();
    return (data.models ?? []).map((m) => m.name).sort();
  }
  async supportsTools(model) {
    try {
      const res = await fetch(`${this.base()}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model })
      });
      if (!res.ok) {
        return true;
      }
      const data = await res.json();
      if (!data.capabilities) {
        return true;
      }
      return data.capabilities.includes("tools");
    } catch {
      return true;
    }
  }
};
var CancelledError = class extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
};
function toWireMessage(m) {
  const wire = { role: m.role, content: m.content };
  if (m.tool_name) wire.tool_name = m.tool_name;
  if (m.tool_calls?.length) {
    wire.tool_calls = m.tool_calls.map((tc) => ({
      function: { name: tc.name, arguments: tc.arguments }
    }));
  }
  return wire;
}
function normalizeArgs(args) {
  if (args && typeof args === "object") {
    return args;
  }
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }
  return {};
}
async function* readNdjson(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          yield line;
        }
      }
    }
    const rest = buffer.trim();
    if (rest) {
      yield rest;
    }
  } finally {
    reader.releaseLock();
  }
}

// src/tools/fsTools.ts
var fs = __toESM(require("fs/promises"));
var path2 = __toESM(require("path"));

// src/tools/paths.ts
var path = __toESM(require("path"));
function makeResolvePath(workspaceRoot, restrict = true) {
  const root = path.resolve(workspaceRoot);
  return (rel) => {
    if (typeof rel !== "string" || rel.length === 0) {
      throw new Error("Ge\xE7ersiz yol: bo\u015F.");
    }
    const abs = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(root, rel);
    if (restrict) {
      const relToRoot = path.relative(root, abs);
      if (relToRoot === ".." || relToRoot.startsWith(".." + path.sep) || path.isAbsolute(relToRoot)) {
        throw new Error(
          `G\xFCvenlik: '${rel}' k\xF6k dizin d\u0131\u015F\u0131na \xE7\u0131k\u0131yor. T\xFCm diske eri\u015Fim i\xE7in ayarlardan 'ors.workspaceOnly' se\xE7ene\u011Fini kapat.`
        );
      }
    }
    return abs;
  };
}
function displayPath(workspaceRoot, abs) {
  const rel = path.relative(workspaceRoot, abs);
  return rel && !rel.startsWith("..") ? rel.split(path.sep).join("/") : abs;
}

// src/tools/diff.ts
function lineDiff(oldText, newText, context = 3) {
  const a = oldText.length ? oldText.split("\n") : [];
  const b = newText.length ? newText.split("\n") : [];
  const n = a.length;
  const m = b.length;
  const lcs = Array.from(
    { length: n + 1 },
    () => new Array(m + 1).fill(0)
  );
  for (let i2 = n - 1; i2 >= 0; i2--) {
    for (let j2 = m - 1; j2 >= 0; j2--) {
      lcs[i2][j2] = a[i2] === b[j2] ? lcs[i2 + 1][j2 + 1] + 1 : Math.max(lcs[i2 + 1][j2], lcs[i2][j2 + 1]);
    }
  }
  const full = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      full.push({ type: "ctx", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      full.push({ type: "del", text: a[i] });
      i++;
    } else {
      full.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) full.push({ type: "del", text: a[i++] });
  while (j < m) full.push({ type: "add", text: b[j++] });
  return trimContext(full, context);
}
function trimContext(lines, context) {
  const keep = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== "ctx") {
      for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) {
        keep[k] = true;
      }
    }
  }
  const out = [];
  let gap = false;
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) {
      out.push(lines[i]);
      gap = false;
    } else if (!gap) {
      out.push({ type: "ctx", text: "\u2026" });
      gap = true;
    }
  }
  return out;
}
function renderDiff(lines) {
  return lines.map((l) => (l.type === "add" ? "+" : l.type === "del" ? "-" : " ") + l.text).join("\n");
}

// src/tools/fsTools.ts
var MAX_READ_BYTES = 256 * 1024;
var readFileTool = {
  name: "read_file",
  category: "read",
  description: "Workspace i\xE7indeki bir dosyan\u0131n i\xE7eri\u011Fini okur. B\xFCy\xFCk dosyalar i\xE7in offset/limit ile sat\u0131r aral\u0131\u011F\u0131 verilebilir.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace k\xF6k\xFCne g\xF6re dosya yolu." },
      offset: { type: "number", description: "Ba\u015Flang\u0131\xE7 sat\u0131r\u0131 (1-tabanl\u0131, opsiyonel)." },
      limit: { type: "number", description: "Okunacak sat\u0131r say\u0131s\u0131 (opsiyonel)." }
    },
    required: ["path"]
  },
  summarize: (a) => `Okunuyor: ${a.path}`,
  async invoke(args, ctx) {
    const abs = ctx.resolvePath(String(args.path));
    let stat3;
    try {
      stat3 = await fs.stat(abs);
    } catch {
      return { ok: false, content: `Dosya bulunamad\u0131: ${args.path}` };
    }
    if (stat3.isDirectory()) {
      return { ok: false, content: `${args.path} bir dizin, dosya de\u011Fil. list_dir kullan.` };
    }
    if (stat3.size > MAX_READ_BYTES) {
      return {
        ok: false,
        content: `Dosya \xE7ok b\xFCy\xFCk (${Math.round(stat3.size / 1024)} KB). offset/limit ile aral\u0131k oku.`
      };
    }
    const raw = await fs.readFile(abs, "utf8");
    const lines = raw.split("\n");
    const offset = typeof args.offset === "number" ? Math.max(1, args.offset) : 1;
    const limit = typeof args.limit === "number" ? args.limit : lines.length;
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const numbered = slice.map((l, i) => `${String(offset + i).padStart(5)}	${l}`).join("\n");
    return {
      ok: true,
      content: numbered || "(bo\u015F dosya)",
      detail: `${slice.length} sat\u0131r`
    };
  }
};
var writeFileTool = {
  name: "write_file",
  category: "write",
  description: "Bir dosyay\u0131 verilen i\xE7erikle olu\u015Fturur veya tamamen \xFCzerine yazar. Var olan dosyay\u0131 de\u011Fi\u015Ftirmek i\xE7in genelde edit_file tercih edilir.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace k\xF6k\xFCne g\xF6re dosya yolu." },
      content: { type: "string", description: "Dosyaya yaz\u0131lacak tam i\xE7erik." }
    },
    required: ["path", "content"]
  },
  summarize: (a) => `Yaz\u0131l\u0131yor: ${a.path}`,
  async preview(args, ctx) {
    const ch = await computeWriteChange(args, ctx);
    return {
      title: `${ch.original === null ? "Yeni dosya" : "\xDCzerine yaz"}: ${displayPath(
        ctx.workspaceRoot,
        ch.absPath
      )}`,
      kind: "diff",
      text: renderDiff(lineDiff(ch.original ?? "", ch.proposed))
    };
  },
  previewChange: computeWriteChange,
  async invoke(args, ctx) {
    const ch = await computeWriteChange(args, ctx);
    ctx.recordCheckpoint?.(ch.absPath, ch.original);
    await fs.mkdir(path2.dirname(ch.absPath), { recursive: true });
    await fs.writeFile(ch.absPath, ch.proposed, "utf8");
    const lines = ch.proposed.split("\n").length;
    return {
      ok: true,
      content: `Yaz\u0131ld\u0131: ${args.path} (${lines} sat\u0131r).`,
      detail: `${lines} sat\u0131r yaz\u0131ld\u0131`
    };
  }
};
var editFileTool = {
  name: "edit_file",
  category: "write",
  description: "Bir dosyada old_string metnini new_string ile de\u011Fi\u015Ftirir. old_string dosyada B\u0130REB\u0130R ve TEK olmal\u0131d\u0131r; de\u011Fi\u015Ftirilecek yeri benzersiz k\u0131lmaya yetecek kadar ba\u011Flam (\xE7evre sat\u0131rlar) i\xE7ermelidir. Sat\u0131r numaras\u0131 KULLANMA.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace k\xF6k\xFCne g\xF6re dosya yolu." },
      old_string: { type: "string", description: "De\u011Fi\u015Ftirilecek mevcut metin (benzersiz, ba\u011Flaml\u0131)." },
      new_string: { type: "string", description: "Yerine yaz\u0131lacak yeni metin." }
    },
    required: ["path", "old_string", "new_string"]
  },
  summarize: (a) => `D\xFCzenleniyor: ${a.path}`,
  async preview(args, ctx) {
    const ch = await computeEditChange(args, ctx);
    return {
      title: `D\xFCzenle: ${displayPath(ctx.workspaceRoot, ch.absPath)}`,
      kind: "diff",
      text: renderDiff(lineDiff(ch.original ?? "", ch.proposed))
    };
  },
  previewChange: computeEditChange,
  async invoke(args, ctx) {
    let ch;
    try {
      ch = await computeEditChange(args, ctx);
    } catch (e) {
      return { ok: false, content: e.message };
    }
    ctx.recordCheckpoint?.(ch.absPath, ch.original);
    await fs.writeFile(ch.absPath, ch.proposed, "utf8");
    return { ok: true, content: `D\xFCzenlendi: ${args.path}.`, detail: "1 de\u011Fi\u015Fiklik uyguland\u0131" };
  }
};
var listDirTool = {
  name: "list_dir",
  category: "list",
  description: "Bir dizinin i\xE7eri\u011Fini (dosya/klas\xF6r) listeler.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace k\xF6k\xFCne g\xF6re dizin yolu (varsay\u0131lan: k\xF6k '.')." }
    }
  },
  summarize: (a) => `Listeleniyor: ${a.path ?? "."}`,
  async invoke(args, ctx) {
    const rel = args.path ? String(args.path) : ".";
    const abs = ctx.resolvePath(rel);
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return { ok: false, content: `Dizin bulunamad\u0131: ${rel}` };
    }
    const ignore = /* @__PURE__ */ new Set([".git", "node_modules", ".vscode-test", "out", "dist"]);
    const listed = entries.filter((e) => !ignore.has(e.name)).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)).map((e) => e.isDirectory() ? `${e.name}/` : e.name);
    return {
      ok: true,
      content: listed.length ? listed.join("\n") : "(bo\u015F dizin)",
      detail: `${listed.length} \xF6\u011Fe`
    };
  }
};
async function computeWriteChange(args, ctx) {
  const abs = ctx.resolvePath(String(args.path));
  const proposed = String(args.content ?? "");
  let original = null;
  try {
    original = await fs.readFile(abs, "utf8");
  } catch {
    original = null;
  }
  return { absPath: abs, original, proposed };
}
async function computeEditChange(args, ctx) {
  const abs = ctx.resolvePath(String(args.path));
  let original;
  try {
    original = await fs.readFile(abs, "utf8");
  } catch {
    throw new Error(`Dosya bulunamad\u0131: ${args.path}`);
  }
  const oldString = String(args.old_string ?? "");
  const newString = String(args.new_string ?? "");
  if (oldString === "") {
    throw new Error("old_string bo\u015F olamaz. write_file kullan.");
  }
  const match = findMatch(original, oldString);
  if (!match) {
    throw new Error(
      "old_string dosyada bulunamad\u0131. Dosyay\u0131 read_file ile tekrar oku ve metni birebir (girinti dahil) kopyala."
    );
  }
  if (match.count > 1) {
    throw new Error(
      `old_string dosyada ${match.count} kez ge\xE7iyor; benzersiz de\u011Fil. Daha fazla \xE7evre sat\u0131r ekleyerek tek e\u015Fle\u015Fme sa\u011Fla.`
    );
  }
  const proposed = original.slice(0, match.index) + newString + original.slice(match.index + match.matched.length);
  return { absPath: abs, original, proposed };
}
function stripLineNumberGutter(text) {
  const gutter = /^\s*\d+(?:\t| {1,2})/;
  const lines = text.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0 || !nonEmpty.every((l) => gutter.test(l))) {
    return text;
  }
  return lines.map((l) => l.replace(gutter, "")).join("\n");
}
function findMatch(haystack, rawNeedle) {
  const needle = stripLineNumberGutter(rawNeedle);
  const first = haystack.indexOf(needle);
  if (first >= 0) {
    let count2 = 0;
    let idx2 = first;
    while (idx2 >= 0) {
      count2++;
      idx2 = haystack.indexOf(needle, idx2 + 1);
    }
    return { index: first, matched: needle, count: count2 };
  }
  const normLine = (s) => s.replace(/[ \t]+$/gm, "");
  const hNorm = normLine(haystack);
  const nNorm = normLine(needle);
  const ni = hNorm.indexOf(nNorm);
  if (ni < 0) {
    return null;
  }
  let count = 0;
  let idx = ni;
  while (idx >= 0) {
    count++;
    idx = hNorm.indexOf(nNorm, idx + 1);
  }
  const before = hNorm.slice(0, ni);
  const startLine = before.split("\n").length - 1;
  const needleLines = nNorm.split("\n").length;
  const origLines = haystack.split("\n");
  const matched = origLines.slice(startLine, startLine + needleLines).join("\n");
  const index = origLines.slice(0, startLine).join("\n").length + (startLine > 0 ? 1 : 0);
  return { index, matched, count };
}

// src/tools/searchTool.ts
var fs2 = __toESM(require("fs/promises"));
var path3 = __toESM(require("path"));
var IGNORE_DIRS = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  "out",
  "dist",
  ".vscode-test",
  ".next",
  "build",
  "coverage",
  ".venv",
  "__pycache__"
]);
var MAX_MATCHES = 200;
var MAX_FILE_BYTES = 1024 * 1024;
var NUL = String.fromCharCode(0);
var searchTool = {
  name: "search",
  category: "search",
  description: "Workspace i\xE7indeki dosyalarda regex (JavaScript regex) ile metin arar. \u0130ste\u011Fe ba\u011Fl\u0131 path ile alt dizine, include ile dosya uzant\u0131s\u0131na (\xF6r. '.ts') daralt\u0131l\u0131r. Kod taban\u0131nda bir \u015Fey bulman\u0131n en h\u0131zl\u0131 yoludur.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Aranacak JavaScript regex deseni." },
      path: { type: "string", description: "Alt dizine daralt (opsiyonel, varsay\u0131lan k\xF6k)." },
      include: {
        type: "string",
        description: "Sadece bu uzant\u0131/sonek ile biten dosyalar (\xF6r. '.ts', '.py'). Opsiyonel."
      }
    },
    required: ["pattern"]
  },
  summarize: (a) => `Aran\u0131yor: /${a.pattern}/`,
  async invoke(args, ctx, token) {
    let regex;
    try {
      regex = new RegExp(String(args.pattern), "g");
    } catch (e) {
      return { ok: false, content: `Ge\xE7ersiz regex: ${e.message}` };
    }
    const root = ctx.resolvePath(args.path ? String(args.path) : ".");
    const include = args.include ? String(args.include) : void 0;
    const matches = [];
    let scanned = 0;
    const walk = async (dir) => {
      if (matches.length >= MAX_MATCHES || token.isCancellationRequested) return;
      let entries;
      try {
        entries = await fs2.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (matches.length >= MAX_MATCHES || token.isCancellationRequested) return;
        const full = path3.join(dir, e.name);
        if (e.isDirectory()) {
          if (!IGNORE_DIRS.has(e.name)) await walk(full);
          continue;
        }
        if (include && !e.name.endsWith(include)) continue;
        let stat3;
        try {
          stat3 = await fs2.stat(full);
        } catch {
          continue;
        }
        if (stat3.size > MAX_FILE_BYTES) continue;
        scanned++;
        let text;
        try {
          text = await fs2.readFile(full, "utf8");
        } catch {
          continue;
        }
        if (text.includes(NUL)) continue;
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            const rel = displayPath(ctx.workspaceRoot, full);
            matches.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
            if (matches.length >= MAX_MATCHES) break;
          }
        }
      }
    };
    await walk(root);
    if (matches.length === 0) {
      return { ok: true, content: `E\u015Fle\u015Fme yok (${scanned} dosya tarand\u0131).`, detail: "0 e\u015Fle\u015Fme" };
    }
    const capped = matches.length >= MAX_MATCHES ? `
\u2026 (ilk ${MAX_MATCHES} e\u015Fle\u015Fme)` : "";
    return {
      ok: true,
      content: matches.join("\n") + capped,
      detail: `${matches.length} e\u015Fle\u015Fme`
    };
  }
};

// src/tools/globTool.ts
var fs3 = __toESM(require("fs/promises"));
var path4 = __toESM(require("path"));
var IGNORE_DIRS2 = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  "out",
  "dist",
  ".vscode-test",
  ".next",
  "build",
  "coverage",
  ".venv",
  "__pycache__"
]);
var MAX_RESULTS = 300;
var globTool = {
  name: "glob",
  category: "search",
  description: "Dosya ad\u0131/yol deseniyle (glob) dosya bulur. \xD6rn: '**/*.ts', 'src/**/test_*.py', '*.json'. \u0130\xE7erik de\u011Fil, dosya ad\u0131 aramas\u0131 yapar.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob deseni (** = her derinlik, * = segment, ? = tek karakter)." },
      path: { type: "string", description: "Arama k\xF6k\xFC (opsiyonel, varsay\u0131lan workspace k\xF6k\xFC)." }
    },
    required: ["pattern"]
  },
  summarize: (a) => `Bulunuyor: ${a.pattern}`,
  async invoke(args, ctx, token) {
    const root = ctx.resolvePath(args.path ? String(args.path) : ".");
    const re = globToRegExp(String(args.pattern));
    const results = [];
    const walk = async (dir) => {
      if (results.length >= MAX_RESULTS || token.isCancellationRequested) return;
      let entries;
      try {
        entries = await fs3.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (results.length >= MAX_RESULTS || token.isCancellationRequested) return;
        const full = path4.join(dir, e.name);
        if (e.isDirectory()) {
          if (!IGNORE_DIRS2.has(e.name)) await walk(full);
          continue;
        }
        const rel = displayPath(ctx.workspaceRoot, full);
        if (re.test(rel)) results.push(rel);
      }
    };
    await walk(root);
    if (results.length === 0) {
      return { ok: true, content: "E\u015Fle\u015Fen dosya yok.", detail: "0 dosya" };
    }
    results.sort();
    const capped = results.length >= MAX_RESULTS ? `
\u2026 (ilk ${MAX_RESULTS})` : "";
    return { ok: true, content: results.join("\n") + capped, detail: `${results.length} dosya` };
  }
};
function globToRegExp(glob) {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re);
}

// src/tools/commandTool.ts
var import_child_process = require("child_process");
var DEFAULT_TIMEOUT_MS = 12e4;
var MAX_OUTPUT_CHARS = 3e4;
var runCommandTool = {
  name: "run_command",
  category: "command",
  description: "Workspace k\xF6k\xFCnde bir shell komutu \xE7al\u0131\u015Ft\u0131r\u0131r ve stdout/stderr + \xE7\u0131k\u0131\u015F kodunu d\xF6nd\xFCr\xFCr. Testler, build, git, paket kurulumu vb. i\xE7in kullan. Uzun s\xFCren/etkile\u015Fimli komutlardan ka\xE7\u0131n.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "\xC7al\u0131\u015Ft\u0131r\u0131lacak shell komutu." },
      timeout_ms: {
        type: "number",
        description: `Zaman a\u015F\u0131m\u0131 (ms). Varsay\u0131lan ${DEFAULT_TIMEOUT_MS}.`
      }
    },
    required: ["command"]
  },
  summarize: (a) => `Komut: ${String(a.command).slice(0, 60)}`,
  async preview(args) {
    return {
      title: "Komut \xE7al\u0131\u015Ft\u0131r\u0131ls\u0131n m\u0131?",
      kind: "command",
      text: String(args.command ?? "")
    };
  },
  async invoke(args, ctx, token) {
    const command = String(args.command ?? "").trim();
    if (!command) {
      return { ok: false, content: "Bo\u015F komut." };
    }
    const timeout = typeof args.timeout_ms === "number" ? args.timeout_ms : DEFAULT_TIMEOUT_MS;
    const isWin = process.platform === "win32";
    const shell = isWin ? "powershell.exe" : "/bin/sh";
    const shellArgs = isWin ? ["-NoProfile", "-Command", command] : ["-c", command];
    return await new Promise((resolve2) => {
      const child = (0, import_child_process.spawn)(shell, shellArgs, {
        cwd: ctx.workspaceRoot,
        env: process.env
      });
      let out = "";
      let killed = false;
      const append = (d) => {
        if (out.length < MAX_OUTPUT_CHARS) {
          out += d.toString();
        }
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      const timer = setTimeout(() => {
        killed = true;
        child.kill();
      }, timeout);
      const cancelSub = token.onCancellationRequested(() => {
        killed = true;
        child.kill();
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        cancelSub.dispose();
        resolve2({ ok: false, content: `Komut ba\u015Flat\u0131lamad\u0131: ${err.message}` });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        cancelSub.dispose();
        let text = out.slice(0, MAX_OUTPUT_CHARS);
        if (out.length > MAX_OUTPUT_CHARS) text += "\n\u2026 (\xE7\u0131kt\u0131 k\u0131rp\u0131ld\u0131)";
        if (killed) {
          resolve2({
            ok: false,
            content: `Komut durduruldu (zaman a\u015F\u0131m\u0131/iptal).
${text}`,
            detail: "durduruldu"
          });
          return;
        }
        const header = `$ ${command}
(\xE7\u0131k\u0131\u015F kodu: ${code})
`;
        resolve2({
          ok: code === 0,
          content: header + (text || "(\xE7\u0131kt\u0131 yok)"),
          detail: `\xE7\u0131k\u0131\u015F kodu ${code}`
        });
      });
    });
  }
};

// src/tools/todosTool.ts
var todosTool = {
  name: "manage_todos",
  category: "list",
  description: "\xC7ok ad\u0131ml\u0131 bir g\xF6revi planlamak ve ilerlemeyi takip etmek i\xE7in yap\u0131lacaklar listesini olu\u015Fturur/g\xFCnceller. Her \xE7a\u011Fr\u0131da T\xDCM listeyi g\xF6nder; tek seferde yaln\u0131zca bir \xF6\u011Fe 'in_progress' olmal\u0131. Karma\u015F\u0131k g\xF6revlerin ba\u015F\u0131nda listeyi kur, ad\u0131m bitince g\xFCncelle.",
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "G\xF6rev \xF6\u011Feleri listesi.",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "G\xF6rev a\xE7\u0131klamas\u0131." },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
              description: "\xD6\u011Fe durumu."
            }
          },
          required: ["content", "status"]
        }
      }
    },
    required: ["todos"]
  },
  summarize: () => "G\xF6rev listesi g\xFCncelleniyor",
  async invoke(args, ctx) {
    const raw = Array.isArray(args.todos) ? args.todos : [];
    const items = raw.map((t) => ({
      content: String(t?.content ?? "").trim(),
      status: normalizeStatus(t?.status)
    })).filter((t) => t.content.length > 0);
    ctx.onTodos?.(items);
    const done = items.filter((t) => t.status === "completed").length;
    return {
      ok: true,
      content: `G\xF6rev listesi g\xFCncellendi (${done}/${items.length} tamamland\u0131).`,
      detail: `${done}/${items.length}`
    };
  }
};
function normalizeStatus(s) {
  return s === "in_progress" || s === "completed" ? s : "pending";
}

// src/tools/processTools.ts
var startProcessTool = {
  name: "start_process",
  category: "command",
  description: "Uzun s\xFCren/bloklayan bir komutu ARKA PLANDA ba\u015Flat\u0131r ve bir s\xFCre\xE7 id d\xF6nd\xFCr\xFCr (\xF6r. 'npm run dev', 'docker compose up', 'python -m http.server'). \xC7\u0131kt\u0131s\u0131n\u0131 check_process ile izle, stop_process ile durdur. K\u0131sa/tek seferlik komutlar i\xE7in run_command kullan.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Arka planda \xE7al\u0131\u015Ft\u0131r\u0131lacak komut." }
    },
    required: ["command"]
  },
  summarize: (a) => `Arka plan: ${String(a.command).slice(0, 60)}`,
  async preview(args) {
    return { title: "Arka planda ba\u015Flat\u0131ls\u0131n m\u0131?", kind: "command", text: String(args.command ?? "") };
  },
  async invoke(args, ctx) {
    if (!ctx.background) return { ok: false, content: "Arka plan y\xF6neticisi mevcut de\u011Fil." };
    const command = String(args.command ?? "").trim();
    if (!command) return { ok: false, content: "Bo\u015F komut." };
    const { id } = ctx.background.start(command, ctx.workspaceRoot);
    return {
      ok: true,
      content: `Arka planda ba\u015Flat\u0131ld\u0131. S\xFCre\xE7 id: ${id}. \xC7\u0131kt\u0131y\u0131 check_process("${id}") ile izle.`,
      detail: id
    };
  }
};
var checkProcessTool = {
  name: "check_process",
  category: "read",
  description: "Bir arka plan s\xFCrecinin \xE7al\u0131\u015F\u0131p \xE7al\u0131\u015Fmad\u0131\u011F\u0131n\u0131 ve o ana kadarki \xE7\u0131kt\u0131s\u0131n\u0131 d\xF6nd\xFCr\xFCr.",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "start_process'in d\xF6nd\xFCrd\xFC\u011F\xFC s\xFCre\xE7 id." } },
    required: ["id"]
  },
  summarize: (a) => `Kontrol: ${a.id}`,
  async invoke(args, ctx) {
    if (!ctx.background) return { ok: false, content: "Arka plan y\xF6neticisi mevcut de\u011Fil." };
    const r = ctx.background.check(String(args.id));
    if (!r.found) return { ok: false, content: `S\xFCre\xE7 bulunamad\u0131: ${args.id}` };
    const status = r.running ? "\xE7al\u0131\u015F\u0131yor" : `bitti (\xE7\u0131k\u0131\u015F kodu ${r.code})`;
    return {
      ok: true,
      content: `Durum: ${status}
--- \xE7\u0131kt\u0131 ---
${r.output || "(\xE7\u0131kt\u0131 yok)"}`,
      detail: status
    };
  }
};
var stopProcessTool = {
  name: "stop_process",
  category: "command",
  description: "Bir arka plan s\xFCrecini durdurur (\xF6ld\xFCr\xFCr).",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "Durdurulacak s\xFCre\xE7 id." } },
    required: ["id"]
  },
  summarize: (a) => `Durdur: ${a.id}`,
  async preview(args) {
    return { title: "S\xFCre\xE7 durdurulsun mu?", kind: "text", text: `S\xFCre\xE7: ${args.id}` };
  },
  async invoke(args, ctx) {
    if (!ctx.background) return { ok: false, content: "Arka plan y\xF6neticisi mevcut de\u011Fil." };
    const ok = ctx.background.stop(String(args.id));
    return ok ? { ok: true, content: `Durduruldu: ${args.id}`, detail: "durduruldu" } : { ok: false, content: `S\xFCre\xE7 bulunamad\u0131: ${args.id}` };
  }
};

// src/tools/sshTool.ts
var import_child_process2 = require("child_process");
var DEFAULT_TIMEOUT_MS2 = 12e4;
var MAX_OUTPUT = 3e4;
var sshRunTool = {
  name: "ssh_run",
  category: "command",
  description: "Uzak bir makinada SSH ile komut \xE7al\u0131\u015Ft\u0131r\u0131r ve \xE7\u0131kt\u0131s\u0131n\u0131 d\xF6nd\xFCr\xFCr. host, ~/.ssh/config'deki bir takma ad veya user@host olabilir. Anahtar-tabanl\u0131 kimlik do\u011Frulama gerekir (parola sorusu olan sunucular \xE7al\u0131\u015Fmaz). Sunucu kurulumu, docker, servis y\xF6netimi vb. i\xE7in kullan.",
  parameters: {
    type: "object",
    properties: {
      host: { type: "string", description: "Hedef: 'user@host', IP, ya da ssh config takma ad\u0131." },
      command: { type: "string", description: "Uzak makinada \xE7al\u0131\u015Ft\u0131r\u0131lacak komut." },
      timeout_ms: { type: "number", description: `Zaman a\u015F\u0131m\u0131 (ms). Varsay\u0131lan ${DEFAULT_TIMEOUT_MS2}.` }
    },
    required: ["host", "command"]
  },
  summarize: (a) => `SSH ${a.host}: ${String(a.command).slice(0, 50)}`,
  async preview(args) {
    return {
      title: `SSH ile \xE7al\u0131\u015Ft\u0131r\u0131ls\u0131n m\u0131? (${args.host})`,
      kind: "command",
      text: `ssh ${args.host} "${args.command}"`
    };
  },
  async invoke(args, ctx, token) {
    const host = String(args.host ?? "").trim();
    const command = String(args.command ?? "").trim();
    if (!host || !command) return { ok: false, content: "host ve command gerekli." };
    const timeout = typeof args.timeout_ms === "number" ? args.timeout_ms : DEFAULT_TIMEOUT_MS2;
    const sshArgs = [
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      `ConnectTimeout=15`,
      host,
      command
    ];
    return await new Promise((resolve2) => {
      const child = (0, import_child_process2.spawn)("ssh", sshArgs, { cwd: ctx.workspaceRoot, env: process.env });
      let out = "";
      let killed = false;
      const append = (d) => {
        if (out.length < MAX_OUTPUT) out += d.toString();
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      const timer = setTimeout(() => {
        killed = true;
        child.kill();
      }, timeout);
      const sub = token.onCancellationRequested(() => {
        killed = true;
        child.kill();
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        sub.dispose();
        resolve2({
          ok: false,
          content: `ssh ba\u015Flat\u0131lamad\u0131: ${err.message}. Sistemde 'ssh' istemcisi kurulu mu?`
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        sub.dispose();
        const text = out.slice(0, MAX_OUTPUT);
        if (killed) {
          resolve2({ ok: false, content: `SSH durduruldu (zaman a\u015F\u0131m\u0131/iptal).
${text}`, detail: "durduruldu" });
          return;
        }
        resolve2({
          ok: code === 0,
          content: `ssh ${host} (\xE7\u0131k\u0131\u015F kodu ${code}):
${text || "(\xE7\u0131kt\u0131 yok)"}`,
          detail: `\xE7\u0131k\u0131\u015F kodu ${code}`
        });
      });
    });
  }
};

// src/tools/webTools.ts
var MAX_TEXT = 12e3;
var webFetchTool = {
  name: "web_fetch",
  category: "search",
  description: "Verilen URL'nin i\xE7eri\u011Fini indirir ve okunabilir metne \xE7evirir (HTML temizlenir). Dok\xFCmantasyon, API referans\u0131, sayfa i\xE7eri\u011Fi okumak i\xE7in kullan.",
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "\xC7ekilecek tam URL (http/https)." } },
    required: ["url"]
  },
  summarize: (a) => `\xC7ekiliyor: ${a.url}`,
  async invoke(args, _ctx, token) {
    const url = String(args.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, content: "Ge\xE7erli bir http(s) URL ver." };
    }
    const controller = new AbortController();
    const sub = token.onCancellationRequested(() => controller.abort());
    const timer = setTimeout(() => controller.abort(), 3e4);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Ors VSCode agent)" }
      });
      if (!res.ok) return { ok: false, content: `HTTP ${res.status} \u2014 ${url}` };
      const ctype = res.headers.get("content-type") ?? "";
      const body = await res.text();
      const text = ctype.includes("html") ? htmlToText(body) : body;
      return {
        ok: true,
        content: text.slice(0, MAX_TEXT) + (text.length > MAX_TEXT ? "\n\u2026 (k\u0131rp\u0131ld\u0131)" : ""),
        detail: `${Math.min(text.length, MAX_TEXT)} karakter`
      };
    } catch (e) {
      return { ok: false, content: `\xC7ekme hatas\u0131: ${e.message}` };
    } finally {
      clearTimeout(timer);
      sub.dispose();
    }
  }
};
var webSearchTool = {
  name: "web_search",
  category: "search",
  description: "\u0130nternette arama yapar (DuckDuckGo). Ba\u015Fl\u0131k, URL ve k\u0131sa \xF6zet listesi d\xF6nd\xFCr\xFCr. G\xFCncel bilgi, hata \xE7\xF6z\xFCm\xFC, dok\xFCmantasyon bulmak i\xE7in kullan; sonra web_fetch ile detay oku.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Arama sorgusu." } },
    required: ["query"]
  },
  summarize: (a) => `Web aramas\u0131: ${a.query}`,
  async invoke(args, _ctx, token) {
    const query = String(args.query ?? "").trim();
    if (!query) return { ok: false, content: "Bo\u015F sorgu." };
    const controller = new AbortController();
    const sub = token.onCancellationRequested(() => controller.abort());
    const timer = setTimeout(() => controller.abort(), 3e4);
    try {
      const res = await fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Ors VSCode agent)"
        },
        body: `q=${encodeURIComponent(query)}`
      });
      if (!res.ok) return { ok: false, content: `Arama HTTP ${res.status}` };
      const html = await res.text();
      const results = parseDdgResults(html);
      if (results.length === 0) {
        return { ok: true, content: "Sonu\xE7 bulunamad\u0131.", detail: "0 sonu\xE7" };
      }
      const text = results.slice(0, 8).map((r, i) => `${i + 1}. ${r.title}
   ${r.url}
   ${r.snippet}`).join("\n\n");
      return { ok: true, content: text, detail: `${results.length} sonu\xE7` };
    } catch (e) {
      return { ok: false, content: `Arama hatas\u0131: ${e.message}` };
    } finally {
      clearTimeout(timer);
      sub.dispose();
    }
  }
};
function parseDdgResults(html) {
  const out = [];
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets = [];
  let sm;
  while (sm = snippetRe.exec(html)) snippets.push(stripTags(sm[1]));
  let lm;
  let i = 0;
  while (lm = linkRe.exec(html)) {
    out.push({
      title: stripTags(lm[2]),
      url: decodeDdgUrl(lm[1]),
      snippet: snippets[i] ?? ""
    });
    i++;
  }
  return out;
}
function decodeDdgUrl(href) {
  const m = /[?&]uddg=([^&]+)/.exec(href);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
    }
  }
  return href.startsWith("//") ? "https:" + href : href;
}
function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}
function stripTags(s) {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// src/tools/memoryTool.ts
var memoryTool = {
  name: "manage_memory",
  category: "list",
  description: "Kal\u0131c\u0131 haf\u0131zay\u0131 y\xF6netir (projeler-aras\u0131). action='add' ile kal\u0131c\u0131 bir not ekle (kullan\u0131c\u0131 tercihi, \xF6nemli karar, s\u0131k kullan\u0131lan yol/host). action='list' ile mevcut notlar\u0131 g\xF6r. action='remove' ile index'e g\xF6re sil. Kal\u0131c\u0131 notlar sonraki oturumlarda da hat\u0131rlan\u0131r.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["add", "list", "remove"], description: "Yap\u0131lacak i\u015Flem." },
      text: { type: "string", description: "action='add' i\xE7in saklanacak not." },
      index: { type: "number", description: "action='remove' i\xE7in silinecek notun index'i (0-tabanl\u0131)." }
    },
    required: ["action"]
  },
  summarize: (a) => `Haf\u0131za: ${a.action}`,
  async invoke(args, ctx) {
    if (!ctx.memory) return { ok: false, content: "Haf\u0131za servisi mevcut de\u011Fil." };
    const action = String(args.action);
    if (action === "add") {
      const text = String(args.text ?? "").trim();
      if (!text) return { ok: false, content: "Eklenecek not bo\u015F." };
      ctx.memory.add(text);
      return { ok: true, content: `Haf\u0131zaya eklendi: "${text}"`, detail: "eklendi" };
    }
    if (action === "remove") {
      const idx = Number(args.index);
      const ok = ctx.memory.remove(idx);
      return ok ? { ok: true, content: `Not silindi (index ${idx}).`, detail: "silindi" } : { ok: false, content: `Ge\xE7ersiz index: ${args.index}` };
    }
    const items = ctx.memory.list();
    if (items.length === 0) return { ok: true, content: "Haf\u0131za bo\u015F.", detail: "0 not" };
    return {
      ok: true,
      content: items.map((m, i) => `${i}. ${m}`).join("\n"),
      detail: `${items.length} not`
    };
  }
};

// src/tools/registry.ts
var READ_ONLY = /* @__PURE__ */ new Set(["read", "search", "list"]);
var ToolRegistry = class {
  tools = /* @__PURE__ */ new Map();
  constructor(tools) {
    for (const t of tools) {
      this.tools.set(t.name, t);
    }
  }
  get(name) {
    return this.tools.get(name);
  }
  all() {
    return [...this.tools.values()];
  }
  /** Moda göre araçlar: plan modunda yalnızca salt-okunur araçlar. */
  forMode(mode) {
    if (mode === "plan") return this.all().filter((t) => READ_ONLY.has(t.category));
    return this.all();
  }
  /** Verilen araçlardan (varsayılan: hepsi) Ollama tool spec dizisi üretir. */
  specs(tools = this.all()) {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
  }
};
function defaultTools() {
  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    listDirTool,
    searchTool,
    globTool,
    runCommandTool,
    startProcessTool,
    checkProcessTool,
    stopProcessTool,
    sshRunTool,
    webSearchTool,
    webFetchTool,
    memoryTool,
    todosTool
  ];
}

// src/agent/systemPrompt.ts
function buildSystemPrompt(params) {
  const toolList = params.tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  const memorySection = params.memories.length ? `
# Kal\u0131c\u0131 haf\u0131za (\xF6nceki oturumlardan)
${params.memories.map((m) => `- ${m}`).join("\n")}
` : "";
  const modeSection = params.mode === "plan" ? `# MOD: PLAN
\u015Eu an PLAN modundas\u0131n. Dosya DE\u011E\u0130\u015ET\u0130REMEZS\u0130N ve komut \xC7ALI\u015ETIRAMAZSIN; yaln\u0131zca
okuma/arama ara\xE7lar\u0131n var. \xD6nce ilgili dosyalar\u0131 oku, kod taban\u0131n\u0131 anla, sonra
NET bir uygulama plan\u0131 sun (hangi dosyalar, hangi de\u011Fi\u015Fiklikler, s\u0131ra). Plan\u0131 yaz\u0131nca
dur ve kullan\u0131c\u0131dan onay iste; kullan\u0131c\u0131 'act' moduna ge\xE7ince uygulars\u0131n.` : `# MOD: ACT
\u015Eu an ACT modundas\u0131n. Planla ve g\xF6revi ara\xE7larla u\xE7tan uca tamamla.`;
  return `Sen VSCode i\xE7inde \xE7al\u0131\u015Fan, genel ama\xE7l\u0131 bir MAK\u0130NE AJANISIN (ad\u0131n: \xD6rs).
Yaln\u0131zca kod yazmakla s\u0131n\u0131rl\u0131 de\u011Filsin: kabuk komutlar\u0131 \xE7al\u0131\u015Ft\u0131r\u0131r, sistem servislerini
kontrol eder, program kurar, arka planda s\xFCre\xE7/sunucu/docker \xE7al\u0131\u015Ft\u0131r\u0131r, SSH ile uzak
sunuculara ba\u011Flan\u0131p i\u015F yapars\u0131n. Ger\xE7ek i\u015Flemler yaparak kullan\u0131c\u0131n\u0131n g\xF6revlerini tamamlars\u0131n.
T\xFCrk\xE7e konu\u015F.

${modeSection}
${memorySection}
# \xC7al\u0131\u015Fma alan\u0131
- K\xF6k dizin: ${params.workspaceRoot}
- \u0130\u015Fletim sistemi: ${params.platform}, kabuk: ${params.shell}
- Proje dosyalar\u0131 i\xE7in G\xD6REL\u0130 yol tercih et (\xF6rn. "src/app.ts"); k\xF6k dizin ad\u0131n\u0131 yola ekleme.
- Sistem genelinde i\u015F yaparken mutlak yol kullanabilirsin (izin verildiyse). K\xF6k d\u0131\u015F\u0131na
  eri\u015Fim engellenirse kullan\u0131c\u0131 'ors.workspaceOnly' ayar\u0131n\u0131 kapatmal\u0131.

# Ara\xE7lar\u0131n
${toolList}

# Kesin kurallar
1. G\xF6revi tamamlamak i\xE7in ara\xE7lar\u0131 kullan. Bir dosyay\u0131 de\u011Fi\u015Ftirmeden \xD6NCE read_file ile oku.
2. Var olan bir dosyay\u0131 de\u011Fi\u015Ftirirken edit_file kullan (write_file t\xFCm dosyan\u0131n \xFCzerine yazar).
   - edit_file'da old_string dosyada B\u0130REB\u0130R ve TEK olmal\u0131; girintiyi aynen kopyala,
     benzersiz olmas\u0131 i\xE7in \xE7evre sat\u0131rlar\u0131 da ekle. ASLA sat\u0131r numaras\u0131 kullanma.
3. \u0130htiyaca g\xF6re ara\xE7lar\u0131 kullan: ke\u015Fif i\xE7in birden \xE7ok okuma/arama arac\u0131n\u0131 birlikte
   \xE7a\u011F\u0131rabilirsin; dosya de\u011Fi\u015Ftiren i\u015Flemleri ise sonucunu g\xF6rerek ad\u0131m ad\u0131m y\xFCr\xFCt.
4. Bir ara\xE7 hata d\xF6nd\xFCr\xFCrse hatay\u0131 oku, d\xFCzelt ve tekrar dene; ayn\u0131 hatada \u0131srar etme.
5. write_file, edit_file ve run_command kullan\u0131c\u0131 onay\u0131 gerektirir; bu normaldir.
6. G\xF6rev bitti\u011Finde ara\xE7 \xE7a\u011F\u0131rmay\u0131 b\u0131rak ve kullan\u0131c\u0131ya k\u0131sa, net bir \xF6zet yaz.
   Emin de\u011Filsen veya bilgi gerekiyorsa kullan\u0131c\u0131ya soru sor.
7. Uydurma yapma: dosya i\xE7eri\u011Fini g\xF6rmeden onun hakk\u0131nda iddiada bulunma, \xF6nce oku.
8. \xC7ok ad\u0131ml\u0131/karma\u015F\u0131k g\xF6revlerde manage_todos ile bir yap\u0131lacaklar listesi tut ve
   ilerledik\xE7e g\xFCncelle; ayn\u0131 anda yaln\u0131zca bir \xF6\u011Fe 'in_progress' olsun.`;
}

// src/agent/contextManager.ts
function estimateTokens(text) {
  return Math.ceil((text?.length ?? 0) / 4);
}
function messageTokens(m) {
  let t = estimateTokens(m.content);
  if (m.tool_calls?.length) {
    t += estimateTokens(JSON.stringify(m.tool_calls));
  }
  return t + 8;
}
function fitHistory(history, budgetTokens) {
  const kept = [];
  let total = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const t = messageTokens(history[i]);
    if (kept.length > 0 && total + t > budgetTokens) break;
    kept.unshift(history[i]);
    total += t;
  }
  while (kept.length > 1 && kept[0].role === "tool") {
    kept.shift();
  }
  return { kept, droppedCount: history.length - kept.length };
}
function buildSummaryPrompt(existingSummary, dropped) {
  const transcript = dropped.map((m) => {
    if (m.role === "tool") return `[ara\xE7 sonucu] ${truncate(m.content, 500)}`;
    if (m.role === "assistant" && m.tool_calls?.length) {
      const names = m.tool_calls.map((c) => c.name).join(", ");
      return `[asistan ara\xE7 \xE7a\u011Fr\u0131s\u0131: ${names}] ${truncate(m.content, 300)}`;
    }
    return `[${m.role}] ${truncate(m.content, 800)}`;
  }).join("\n");
  const sys = {
    role: "system",
    content: "Bir kodlama oturumunun eski k\u0131sm\u0131n\u0131 \xF6zetliyorsun. Mevcut \xF6zet ve yeni mesajlar\u0131 birle\u015Ftirip TEK, k\u0131sa (en fazla ~200 kelime) ama bilgi-koruyan bir \xF6zet \xFCret: hangi dosyalara dokunuldu, al\u0131nan kararlar, tamamlanan/bekleyen i\u015Fler, \xF6nemli bulgular. Sadece \xF6zeti yaz."
  };
  const usr = {
    role: "user",
    content: (existingSummary ? `Mevcut \xF6zet:
${existingSummary}

` : "") + `Yeni mesajlar:
${transcript}`
  };
  return [sys, usr];
}
function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + "\u2026" : s;
}

// src/agent/toolCallParser.ts
function parseTextToolCalls(content) {
  if (!content || !content.includes("{")) return [];
  const calls = [];
  for (const value of extractJsonValues(content)) {
    collect(value, calls);
  }
  return calls;
}
function collect(value, out) {
  if (Array.isArray(value)) {
    for (const v of value) collect(v, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const o = value;
  if (Array.isArray(o.tool_calls)) {
    for (const c of o.tool_calls) collect(c, out);
    return;
  }
  const fn = o.function && typeof o.function === "object" ? o.function : void 0;
  const name = o.name ?? o.tool ?? o.tool_name ?? fn?.name;
  let args = o.arguments ?? o.parameters ?? o.args ?? o.input ?? fn?.arguments;
  if (typeof name !== "string" || !name) return;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }
  out.push({
    name,
    arguments: args && typeof args === "object" ? args : {}
  });
}
function extractJsonValues(text) {
  const values = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "{" || c === "[") {
      const end = matchBalanced(text, i);
      if (end > i) {
        const slice = text.slice(i, end + 1);
        const parsed = tryParseLenient(slice);
        if (parsed !== void 0) values.push(parsed);
        i = end + 1;
        continue;
      }
    }
    i++;
  }
  return values;
}
function tryParseLenient(slice) {
  try {
    return JSON.parse(slice);
  } catch {
  }
  try {
    const repaired = slice.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
    return JSON.parse(repaired);
  } catch {
    return void 0;
  }
}
function matchBalanced(text, start) {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// src/agent/agent.ts
var MAX_CONSECUTIVE_FAILURES = 4;
var Agent = class {
  constructor(llm, registry, ctx, events2, approval2, getConfig, env, getMemories = () => []) {
    this.llm = llm;
    this.registry = registry;
    this.ctx = ctx;
    this.events = events2;
    this.approval = approval2;
    this.getConfig = getConfig;
    this.env = env;
    this.getMemories = getMemories;
  }
  history = [];
  /** Kırpılan eski mesajların bilgi-koruyan özeti (bağlam yönetimi). */
  summary = "";
  summarizedCount = 0;
  fallbackSeq = 0;
  reset() {
    this.history = [];
    this.summary = "";
    this.summarizedCount = 0;
  }
  /** Kalıcılık için geçmişin anlık görüntüsü. */
  snapshot() {
    return {
      history: this.history,
      summary: this.summary,
      summarizedCount: this.summarizedCount
    };
  }
  /** Kayıtlı geçmişi geri yükler (oturum sürekliliği). */
  restore(s) {
    this.history = s.history ?? [];
    this.summary = s.summary ?? "";
    this.summarizedCount = s.summarizedCount ?? 0;
  }
  /** Sistem mesajı + özet + bütçeye sığdırılmış geçmişten çağrı mesajlarını kurar. */
  async buildMessages(cfg, token) {
    const system = this.systemMessage(cfg.mode);
    const reserve = Math.min(4096, Math.max(1024, Math.floor(cfg.numCtx / 4)));
    const sysTokens = estimateTokens(system.content);
    const budget = cfg.numCtx - reserve - sysTokens - estimateTokens(this.summary) - 300;
    const { kept, droppedCount } = fitHistory(
      this.history,
      Math.max(1500, budget)
    );
    if (droppedCount > this.summarizedCount) {
      await this.updateSummary(droppedCount, cfg, token);
    }
    const msgs = [system];
    if (this.summary) {
      msgs.push({
        role: "system",
        content: `# \xD6nceki konu\u015Fman\u0131n \xF6zeti
${this.summary}`
      });
    }
    msgs.push(...kept);
    return msgs;
  }
  async updateSummary(dropTo, cfg, token) {
    const newly = this.history.slice(this.summarizedCount, dropTo);
    if (newly.length === 0) {
      this.summarizedCount = dropTo;
      return;
    }
    try {
      const res = await this.llm.chat({
        model: cfg.model,
        messages: buildSummaryPrompt(this.summary, newly),
        tools: [],
        temperature: 0.2,
        numCtx: cfg.numCtx,
        token
      });
      this.summary = res.content.trim() || this.summary;
      this.summarizedCount = dropTo;
      this.events.info("Uzun sohbet: eski k\u0131s\u0131m \xF6zetlenerek ba\u011Flamda tutuldu.");
    } catch {
      this.summarizedCount = dropTo;
    }
  }
  systemMessage(mode) {
    return {
      role: "system",
      content: buildSystemPrompt({
        tools: this.registry.forMode(mode),
        workspaceRoot: this.ctx.workspaceRoot,
        platform: this.env.platform,
        shell: this.env.shell,
        mode,
        memories: this.getMemories()
      })
    };
  }
  /** Bir kullanıcı mesajını işler; görev bitene kadar araç döngüsünü yürütür. */
  async run(userText, token) {
    const cfg = this.getConfig();
    this.history.push({ role: "user", content: userText });
    let consecutiveFailures = 0;
    let lastSignature = "";
    let repeatCount = 0;
    try {
      for (let iter = 0; iter < cfg.maxIterations; iter++) {
        if (token.isCancellationRequested) throw new CancelledError();
        this.events.status("thinking");
        let started = false;
        const messages = await this.buildMessages(cfg, token);
        const result = await this.llm.chat({
          model: cfg.model,
          messages,
          tools: this.registry.specs(this.registry.forMode(cfg.mode)),
          temperature: cfg.temperature,
          numCtx: cfg.numCtx,
          token,
          onToken: (t) => {
            if (!started) {
              started = true;
              this.events.assistantStart();
            }
            this.events.assistantToken(t);
          }
        });
        if (started) this.events.assistantEnd();
        let toolCalls = result.toolCalls;
        let usedFallback = false;
        if (toolCalls.length === 0) {
          const parsed = parseTextToolCalls(result.content);
          if (parsed.length) {
            toolCalls = parsed.map((p) => ({
              id: `fb_${++this.fallbackSeq}`,
              name: p.name,
              arguments: p.arguments
            }));
            usedFallback = true;
            if (started) this.events.assistantDiscard();
          }
        }
        this.history.push({
          role: "assistant",
          content: usedFallback ? "" : result.content,
          tool_calls: toolCalls.length ? toolCalls : void 0
        });
        if (toolCalls.length === 0) {
          if (!started && result.content.trim() === "") {
            this.events.info("Model bo\u015F yan\u0131t verdi.");
          }
          this.events.status("idle");
          return;
        }
        const signature = toolCalls.map((c) => c.name + ":" + JSON.stringify(c.arguments)).join("|");
        if (signature === lastSignature) {
          repeatCount++;
        } else {
          repeatCount = 0;
          lastSignature = signature;
        }
        if (repeatCount >= 2) {
          this.events.error(
            "Ajan ayn\u0131 i\u015Flemleri tekrarlay\u0131p ilerleyemiyor, durduruldu. Model bu g\xF6revi \xE7\xF6zemedi olabilir; daha g\xFC\xE7l\xFC bir model dene."
          );
          this.events.status("idle");
          return;
        }
        let anyOk = false;
        for (const call of toolCalls) {
          if (token.isCancellationRequested) throw new CancelledError();
          const ok = await this.executeTool(call, cfg, token);
          anyOk = anyOk || ok;
        }
        consecutiveFailures = anyOk ? 0 : consecutiveFailures + 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.events.error(
            `Ajan ${MAX_CONSECUTIVE_FAILURES} turdur ilerleyemedi, durduruldu. \u0130stek \xE7ok karma\u015F\u0131k olabilir veya model ara\xE7lar\u0131 yanl\u0131\u015F kullan\u0131yor.`
          );
          this.events.status("idle");
          return;
        }
      }
      this.events.error(
        `Maksimum iterasyon (${cfg.maxIterations}) a\u015F\u0131ld\u0131. G\xF6rev tamamlanmam\u0131\u015F olabilir.`
      );
      this.events.status("idle");
    } catch (err) {
      if (err instanceof CancelledError) {
        this.events.info("Durduruldu.");
      } else {
        this.events.error(err.message);
      }
      this.events.status("idle");
    }
  }
  /** Tek bir araç çağrısını onay + çalıştırma + sonucu geçmişe ekleme ile yürütür. */
  async executeTool(call, cfg, token) {
    const tool = this.registry.get(call.name);
    if (!tool) {
      this.events.toolStart(call.id, call.name, `Bilinmeyen ara\xE7: ${call.name}`);
      this.events.toolEnd(call.id, false, "yok");
      this.pushToolResult(call.name, `Hata: '${call.name}' diye bir ara\xE7 yok.`);
      return false;
    }
    if (cfg.mode === "plan" && (tool.category === "write" || tool.category === "command")) {
      this.events.toolStart(call.id, tool.name, "plan modu");
      this.events.toolEnd(call.id, false, "plan modunda engellendi");
      this.pushToolResult(
        tool.name,
        "PLAN modundas\u0131n; dosya de\u011Fi\u015Ftiremez/komut \xE7al\u0131\u015Ft\u0131ramazs\u0131n. Plan\u0131 yaz ve kullan\u0131c\u0131dan act moduna ge\xE7mesini iste."
      );
      return false;
    }
    this.events.toolStart(call.id, tool.name, safe(() => tool.summarize(call.arguments)));
    let autoApproved = cfg.autoApprove[tool.category] === true;
    if (!autoApproved && tool.name === "run_command") {
      autoApproved = commandAutoApproved(String(call.arguments.command ?? ""), cfg);
    }
    if (!autoApproved) {
      try {
        const preview = tool.preview ? await tool.preview(call.arguments, this.ctx) : {
          title: `${tool.name} \xE7al\u0131\u015Ft\u0131r\u0131ls\u0131n m\u0131?`,
          kind: "text",
          text: JSON.stringify(call.arguments, null, 2)
        };
        const approved = await this.approval.request(tool.name, call.arguments, preview);
        if (!approved) {
          this.events.toolEnd(call.id, false, "reddedildi");
          this.pushToolResult(
            tool.name,
            "Kullan\u0131c\u0131 bu i\u015Flemi reddetti. Farkl\u0131 bir yakla\u015F\u0131m dene veya kullan\u0131c\u0131ya sor."
          );
          return false;
        }
      } catch (err) {
        this.events.toolEnd(call.id, false, "\xF6nizleme hatas\u0131");
        this.pushToolResult(tool.name, `\xD6nizleme hatas\u0131: ${err.message}`);
        return false;
      }
    }
    try {
      const res = await tool.invoke(call.arguments, this.ctx, token);
      this.events.toolEnd(call.id, res.ok, res.detail ?? (res.ok ? "tamam" : "hata"));
      this.pushToolResult(tool.name, res.content);
      return res.ok;
    } catch (err) {
      const msg = err.message;
      this.events.toolEnd(call.id, false, "hata");
      this.pushToolResult(tool.name, `Ara\xE7 hatas\u0131: ${msg}`);
      return false;
    }
  }
  pushToolResult(name, content) {
    this.history.push({ role: "tool", tool_name: name, content });
  }
};
function safe(fn) {
  try {
    return fn();
  } catch {
    return "";
  }
}
function commandAutoApproved(command, cfg) {
  const cmd = command.trim().toLowerCase();
  if (!cmd) return false;
  const matches = (list) => list.some((p) => {
    const pref = p.trim().toLowerCase();
    return pref.length > 0 && cmd.startsWith(pref);
  });
  if (matches(cfg.commandDenylist)) return false;
  return matches(cfg.commandAllowlist);
}

// e2e/coding.ts
var MODEL = process.env.ORS_MODEL || "qwen2.5-coder:3b";
var fakeToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {
  } })
};
var events = {
  status: () => {
  },
  assistantStart: () => process.stdout.write("\n[asistan] "),
  assistantToken: (t) => process.stdout.write(t),
  assistantEnd: () => process.stdout.write("\n"),
  assistantDiscard: () => process.stdout.write(" [fallback]\n"),
  toolStart: (_i, name, s) => console.log(`
[ara\xE7\u2192] ${name} :: ${s}`),
  toolEnd: (_i, ok, d) => console.log(`[ara\xE7\u2190] ${ok ? "OK" : "HATA"} :: ${d}`),
  info: (t) => console.log(`[bilgi] ${t}`),
  error: (t) => console.log(`[HATA] ${t}`)
};
var approval = { async request() {
  return true;
} };
async function main() {
  const root = fs4.mkdtempSync(path5.join(os.tmpdir(), "ors-proj-"));
  fs4.writeFileSync(
    path5.join(root, "index.js"),
    'function greet(name) {\n  return "Hello " + name;\n}\nconsole.log(greet("world"));\n'
  );
  console.log(`Proje: ${root}`);
  console.log("Ba\u015Flang\u0131\xE7 index.js:\n" + fs4.readFileSync(path5.join(root, "index.js"), "utf8"));
  const llm = new OllamaClient(() => "http://localhost:11434");
  const registry = new ToolRegistry(defaultTools());
  const ctx = {
    workspaceRoot: root,
    resolvePath: makeResolvePath(root),
    recordCheckpoint: () => {
    }
  };
  const cfg = {
    model: MODEL,
    temperature: 0.1,
    numCtx: 8192,
    maxIterations: 15,
    autoApprove: { read: true, search: true, list: true, write: true, command: true },
    mode: "act",
    commandAllowlist: [],
    commandDenylist: []
  };
  const agent = new Agent(llm, registry, ctx, events, approval, () => cfg, {
    platform: process.platform,
    shell: "powershell"
  });
  const task = "Bu projede index.js var. Onu oku. greet fonksiyonunu, \u0130ngilizce 'Hello' yerine T\xFCrk\xE7e 'Merhaba' diyecek \u015Fekilde d\xFCzenle (edit_file kullan). Sonra `node index.js` komutunu \xE7al\u0131\u015Ft\u0131r\u0131p \xE7\u0131kt\u0131y\u0131 g\xF6ster.";
  console.log(`
=== G\xD6REV: ${task} ===`);
  await agent.run(task, fakeToken);
  console.log("\n\n=== DO\u011ERULAMA ===");
  const final = fs4.readFileSync(path5.join(root, "index.js"), "utf8");
  console.log("Son index.js:\n" + final);
  const edited = final.includes("Merhaba");
  console.log(edited ? "\u2705 KOD D\xDCZENLEND\u0130 (Merhaba var)" : "\u274C kod d\xFCzenlenmedi");
}
main().catch((e) => {
  console.error("TEST HATASI:", e);
  process.exit(1);
});
