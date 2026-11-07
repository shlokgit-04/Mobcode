/**
 * Mobcode markdown renderer + tiny syntax highlighter.
 *
 * Zero dependencies. Renders the subset of markdown AI assistants actually
 * emit: headings, paragraphs, bold/italic/strikethrough, inline code, fenced
 * code blocks with language label + copy button, lists (nested one level),
 * blockquotes, links, horizontal rules and simple pipe tables.
 *
 * Security model: all input is HTML-escaped first; the renderer builds DOM
 * through `h()` helpers — no raw innerHTML from model output other than the
 * escaped/highlighted code spans produced here.
 */
import { h } from "./ui.js";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/* ------------- inline rendering (escaped already at assembly time) ------------- */

function inlineTokens(text) {
  // returns array of nodes for a single line of markdown
  const nodes = [];
  // split by inline code first — `code` inside should not be further processed
  const codeSplit = text.split(/(`[^`]+`)/);
  for (const chunk of codeSplit) {
    if (!chunk) continue;
    if (chunk.startsWith("`") && chunk.endsWith("`") && chunk.length > 2) {
      nodes.push(h("code", {}, chunk.slice(1, -1)));
      continue;
    }
    // bold / italic / strike / links
    let rest = chunk;
    const parts = rest.split(/(\*\*[^*]+\*\*|__[^_]+__|(?<![\w*])\*[^*\s][^*]*\*(?![\w*])|~~[^~]+~~|https?:\/\/[^\s)<>"']+)/g);
    for (const p of parts) {
      if (!p) continue;
      if ((p.startsWith("**") && p.endsWith("**")) || (p.startsWith("__") && p.endsWith("__"))) {
        nodes.push(h("strong", {}, p.slice(2, -2)));
      } else if (p.startsWith("~~") && p.endsWith("~~")) {
        nodes.push(h("s", {}, p.slice(2, -2)));
      } else if ((p.startsWith("*") && p.endsWith("*") && p.length > 2)) {
        nodes.push(h("em", {}, p.slice(1, -1)));
      } else if (/^https?:\/\//.test(p)) {
        nodes.push(h("a", { href: p, target: "_blank", rel: "noopener noreferrer" }, p.replace(/^https?:\/\//, "").slice(0, 48) + (p.length > 48 + 8 ? "…" : "")));
      } else {
        nodes.push(p);
      }
    }
  }
  return nodes;
}

/* ------------- fenced code highlighter ------------- */

const KEYWORDS = {
  js: "const let var function return if else for while do class extends super new this typeof instanceof in of await async try catch finally throw switch case break continue default yield import export from as delete void null undefined true false static get set",
  ts: "const let var function return if else for while do class interface type enum extends implements super new this typeof instanceof in of await async try catch finally throw switch case break continue default yield import export from as delete void null undefined true false static public private protected readonly abstract declare namespace get set satisfies keyof",
  py: "def return if elif else for while in not and or is None True False class import from as with try except finally raise lambda global nonlocal yield async await pass break continue del assert match case self print len range str int float list dict set tuple bool",
  json: "true false null",
  sh: "if then else elif fi for do done while case esac function return exit export set local source echo cd read trap shift",
  bash: "if then else elif fi for do done while case esac function return exit export set local source echo cd read trap shift",
  html: "",
  css: "!important",
  sql: "select from where insert into values update delete create table drop alter join left right inner on group by order having limit as and or not null primary key foreign references",
  go: "func return if else for range while package import var const type struct interface map chan go defer select case break continue fallthrough switch default new make nil true false",
  rs: "fn return if else for while loop match impl trait struct enum pub use mod crate self super as in let mut const static where dyn async move await ref box unsafe",
  java: "public private protected class interface extends implements static final void return new this super if else for while do switch case break continue try catch finally throw throws import package instanceof var boolean int long float double char byte short enum abstract synchronized volatile null true false",
  kt: "fun val var if else for while return class object interface extends implements when import package null true false private public internal override data sealed suspend lateinit companion is in as by lazy",
};

const LANG_ALIASES = {
  javascript: "js", js: "js", jsx: "js", mjs: "js", cjs: "js", node: "js",
  typescript: "ts", ts: "ts", tsx: "ts",
  python: "py", py: "py", py3: "py",
  json: "json", jsonc: "json",
  bash: "sh", sh: "sh", shell: "sh", zsh: "sh", console: "sh", terminal: "sh",
  html: "html", xml: "html", svg: "html",
  css: "css", scss: "css", less: "css",
  sql: "sql", go: "go", rust: "rs", rs: "rs", java: "java", kotlin: "kt", kt: "kt",
  c: "c", cpp: "c", "c++": "c", cs: "c", csharp: "c",
  yaml: "sh", yml: "sh", toml: "sh", ini: "sh", dockerfile: "sh", make: "sh",
};

function highlight(code, lang) {
  const family = LANG_ALIASES[(lang || "").toLowerCase()] || "";
  if (!family || family === "html") {
    // generic: highlight strings + comments lightly (html: skip, tags via strings)
    return esc(code);
  }
  const kws = new Set((KEYWORDS[family] || "").split(" ").filter(Boolean));

  // tokenize: comments, strings, numbers, keywords, function names, operators
  const pattern =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\/\/[^\n]*|#[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\/)|\b(\d[\d_.eE+-]*|0x[\da-fA-F]+)\b|\b([A-Za-z_$][\w$]*)\b|([{}()[\].,;:+\-*/=<>!&|?%^~])/g;

  let out = "";
  let m, last = 0;
  while ((m = pattern.exec(code)) !== null) {
    out += esc(code.slice(last, m.index));
    const i = m[0], s = m[1], c = m[2], n = m[3], w = m[4], op = m[5];
    if (s) out += `<span class="tk-str">${esc(s)}</span>`;
    else if (c) out += `<span class="tk-com">${esc(c)}</span>`;
    else if (n) out += `<span class="tk-num">${esc(n)}</span>`;
    else if (w) {
      if (kws.has(w)) out += `<span class="tk-key">${esc(w)}</span>`;
      else if (code[m.index + i.length] === "(") out += `<span class="tk-fn">${esc(w)}</span>`;
      else out += esc(w);
    } else if (op) out += `<span class="tk-op">${esc(i)}</span>`;
    last = m.index + i.length;
  }
  out += esc(code.slice(last));
  return out;
}

function codeBlock(code, lang) {
  const label = (LANG_ALIASES[(lang || "").toLowerCase()] ? (lang || "").toLowerCase() : (lang || "text"));
  const pre = h("pre", {});
  pre.innerHTML = `<code>${highlight(code.replace(/\n$/, ""), (lang || "").toLowerCase())}</code>`;
  const copy = h("button", { class: "code-copy", onclick: copyCode }, "⧉ Copy");
  copy.dataset.code = code;
  return h("div", { class: "code-block" },
    h("div", { class: "code-head" }, h("span", {}, label), copy),
    pre);
}

async function copyCode(e) {
  const btn = e.currentTarget;
  try {
    const { copyText } = await import("./native.js");
    await copyText(btn.dataset.code || "");
    const old = btn.textContent;
    btn.textContent = "✓ Copied";
    setTimeout(() => { btn.textContent = old; }, 1400);
  } catch {}
}

/* ------------- block parser ------------- */

export function renderMarkdown(source) {
  const root = h("div", { class: "md" });
  if (!source || !source.trim()) return root;

  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  let listBuf = null; // {tag, items}
  let para = [];

  const flushPara = () => {
    if (para.length) {
      const p = h("p", {});
      para.forEach((ln, k) => {
        if (k) p.append(" ");
        inlineTokens(ln).forEach((n) => p.append(n));
      });
      root.append(p);
      para = [];
    }
  };
  const flushList = () => {
    if (listBuf) { root.append(listBuf.el); listBuf = null; }
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushPara(); flushList();
      const lang = fence[1] || "";
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence (or EOF)
      root.append(codeBlock(buf.join("\n"), lang));
      continue;
    }

    // heading
    const head = line.match(/^(#{1,4})\s+(.*)/);
    if (head) {
      flushPara(); flushList();
      root.append(h(`h${head[1].length}`, {}, ...inlineTokens(head[2].replace(/#+\s*$/, ""))));
      i++; continue;
    }

    // hr
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushPara(); flushList();
      root.append(h("hr"));
      i++; continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      flushPara(); flushList();
      const q = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      const bq = h("blockquote", {});
      q.forEach((ln) => { if (bq.childNodes.length) bq.append(h("br")); inlineTokens(ln).forEach((n) => bq.append(n)); });
      root.append(bq);
      continue;
    }

    // list item (ul or ol, one nesting level)
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/);
    if (li) {
      flushPara();
      const tag = /\d/.test(li[2][0]) ? "ol" : "ul";
      if (!listBuf || listBuf.tag !== tag) { flushList(); }
      if (!listBuf) listBuf = { tag, el: h(tag, {}) };
      const content = li[3];
      // simple nested handling: "  - " inside an item
      const nested = content.match(/^(?:[-*+])\s+(.*)/) && li[1].length >= 2;
      const target = nested ? null : listBuf.el;
      const itemLis = h("li", {});
      inlineTokens(content.replace(/^(?:[-*+]|\d+[.)])\s+/, "")).forEach((n) => itemLis.append(n));
      (target || listBuf.el).append(itemLis);
      i++; continue;
    }

    // table row
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^[\s|:-]+\|[\s|:-]*$/.test(lines[i + 1] || "")) {
      flushPara(); flushList();
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const header = cells(rows[0]);
      const table = h("table", {});
      const trh = h("tr", {});
      header.forEach((cell) => trh.append(h("th", {}, ...inlineTokens(cell))));
      table.append(h("thead", {}, trh));
      const tbody = h("tbody", {});
      for (let r = 2; r < rows.length; r++) {
        const tr = h("tr", {});
        cells(rows[r]).forEach((cell) => tr.append(h("td", {}, ...inlineTokens(cell))));
        tbody.append(tr);
      }
      table.append(tbody);
      root.append(table);
      continue;
    }

    // blank
    if (!line.trim()) {
      flushPara(); flushList();
      i++; continue;
    }

    para.push(line.trim());
    i++;
  }
  flushPara(); flushList();
  return root;
}
