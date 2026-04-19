/* ══════════════════════════════════════════════════════════════════════════
   PM Board — Sprint Cockpit Dashboard
   app.js — kanban rendering, drag-drop, item detail overlay
   ══════════════════════════════════════════════════════════════════════════ */

"use strict";

// ─────────────────────────────────────────────────────────── Config (loaded from server)

let pmConfig = {
  name: "PM Board",
  stages: ["inbox", "exploring", "sdd", "planned", "done"],
  entityTypes: {}
};

// ─────────────────────────────────────────────────────────── State

const state = {
  items: [],
  designs: [],
  plans: [],
  sprints: [],
  activeSprints: [],
  selectedSprintId: null,
  search: "",
  typeFilter: new Set(),
  draggedCard: null,
  view: "board",
  ralphLoops: [],
  testsCatalogue: null,
  testsFilter: "all",
  testsSearch: "",
  testsSort: "directory",
};

// ─────────────────────────────────────────────────────────── Router

let _skipPush = false; // prevent pushRoute during applyRoute-triggered renders

function currentBoardPath() {
  if (state.view === "decisions") return "/decisions";
  if (state.view === "tests") return "/tests";
  return state.selectedSprintId ? `/sprint/${state.selectedSprintId}` : "/board";
}

function pushRoute(path) {
  if (_skipPush) return;
  if (window.location.pathname === path) return;
  history.pushState({}, "", path);
}

function applyRoute() {
  _skipPush = true;
  closeDetailOverlay();

  const path = window.location.pathname;
  const parts = path.split("/").filter(Boolean);
  const section = parts[0] || "";
  const id = parts[1] || "";

  // Determine base view + sprint
  if (section === "decisions") {
    state.view = "decisions";
    state.selectedSprintId = null;
  } else if (section === "tests") {
    state.view = "tests";
    state.selectedSprintId = null;
  } else if (section === "sprint" && id) {
    state.view = "board";
    state.selectedSprintId = id;
  } else if (section === "board") {
    state.view = "board";
    state.selectedSprintId = null;
  } else if (["item", "sdd", "plan", "dossier"].includes(section)) {
    // Overlay routes — keep current board state, show overlay after render
    state.view = "board";
  } else {
    // "/" — default: auto-select most recent active sprint
    state.view = "board";
    if (state.activeSprints.length > 0 && !state.selectedSprintId) {
      state.selectedSprintId = state.activeSprints[0].id;
    }
  }

  // Render base view
  const kanbanEl = document.getElementById("kanbanBoard");
  const decisionsEl = document.getElementById("decisionsView");
  const testsEl = document.getElementById("testsView");
  if (state.view === "decisions") {
    kanbanEl.classList.add("hidden");
    decisionsEl.classList.remove("hidden");
    testsEl.classList.add("hidden");
    renderSprintTabs();
    renderDecisionsView();
  } else if (state.view === "tests") {
    kanbanEl.classList.add("hidden");
    decisionsEl.classList.add("hidden");
    testsEl.classList.remove("hidden");
    renderSprintTabs();
    renderTestsView();
  } else {
    kanbanEl.classList.remove("hidden");
    decisionsEl.classList.add("hidden");
    testsEl.classList.add("hidden");
    renderSprintTabs();
    renderBoard();
  }

  _skipPush = false;

  // Open overlay if route specifies one
  if (section === "item" && id) showDetailOverlay(id);
  else if (section === "sdd" && id) showSddDetail(id);
  else if (section === "plan" && id) showPlanDetail(id);
  else if (section === "dossier" && id) showSprintDossier(id);
}

window.addEventListener("popstate", () => applyRoute());

// ─────────────────────────────────────────────────────────── SSE helpers

function removeFromState(entity, id) {
  const key = entity + "s";
  if (state[key]) state[key] = state[key].filter((e) => e.id !== id);
}

function upsertInState(entity, id, data) {
  const key = entity + "s";
  if (!state[key]) return;
  const idx = state[key].findIndex((e) => e.id === id);
  if (idx >= 0) state[key][idx] = data;
  else state[key].push(data);
}

// Column stages in board order
const COLUMNS = ["inbox", "exploring", "sdd", "planned", "done"];
const PRIORITIES = ["critical", "balance", "feature", "polish"];
const STAGES_FOR_ITEMS = ["inbox", "exploring", "sdd", "planned", "done"];

// Valid drop targets per entity type
const VALID_DROPS = {
  item: ["inbox", "exploring", "sdd", "planned", "done"],
  design: ["sdd", "planned", "done"],
  plan: ["planned", "done"],
};

// ─────────────────────────────────────────────────────────── Pillar helpers

/** Canonical pillar name normalization */
const PILLAR_ALIASES = {
  "nudging creates meaningful tension": "Nudging creates tension",
  "satisfying growth": "Satisfying Growth",
  "reproducibility / workflow": "Reproducibility",
  reproducibility: "Reproducibility",
  "n/a (tooling)": "Tooling",
  "n/a (tooling/diagnostics)": "Tooling",
  "n/a — data quality": "Tooling",
};

/** Split a semicolon-separated pillar string into normalized individual pillars */
function parsePillars(raw) {
  if (!raw) return [];
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => PILLAR_ALIASES[s.toLowerCase()] || s);
}

/** Get all unique normalized pillars across all items */
function allUniquePillars() {
  const set = new Set();
  for (const item of state.items) {
    for (const p of parsePillars(item.pillar)) set.add(p);
  }
  return [...set].sort();
}

// ─────────────────────────────────────────────────────────── Helpers

function escAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}
function escText(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Build <option> list for sprint assignment dropdown */
function buildSprintOptions(currentSprintId) {
  const opts = [`<option value=""${!currentSprintId ? " selected" : ""}>-- none --</option>`];
  for (const sp of state.sprints) {
    const sel = sp.id === currentSprintId ? " selected" : "";
    const label = `${sp.id} — ${sp.name || "Untitled"}`;
    opts.push(`<option value="${escAttr(sp.id)}"${sel}>${escText(label)}</option>`);
  }
  return opts.join("");
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function relativeTime(dateString) {
  if (!dateString) return "";
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

/**
 * Render the VERIFIED CLAIMS widget for a DD/SDD detail pane.
 * `tests` comes from the sidecar embed in /api/items/:id or /api/designs/:id
 * (may be undefined when no sidecar exists — render empty state).
 */
function renderTestsWidget(tests) {
  const list = Array.isArray(tests) ? tests : [];
  if (list.length === 0) {
    return `
      <div class="detail-section detail-tests">
        <h3 class="detail-section-title">VERIFIED CLAIMS</h3>
        <div class="detail-tests-empty">(no claims yet — no tests guard this decision)</div>
      </div>
    `;
  }
  const testsHTML = list
    .map((t) => {
      const claims = Array.isArray(t.claims) ? t.claims : [];
      const claimsHTML =
        claims.length > 0
          ? `<ul class="detail-tests-claims">${claims
              .map((c) => `<li>${escText(c.text || c.method || "")}</li>`)
              .join("")}</ul>`
          : "";
      const fileLabel = t.file
        ? `<span class="detail-tests-file">${escText(t.file)}</span>`
        : "";
      return `
        <div class="detail-tests-row">
          <div class="detail-tests-header">
            <span class="detail-tests-name">${escText(t.name || "")}</span>
            ${fileLabel}
          </div>
          ${claimsHTML}
        </div>
      `;
    })
    .join("");
  return `
    <div class="detail-section detail-tests">
      <h3 class="detail-section-title">VERIFIED CLAIMS</h3>
      ${testsHTML}
    </div>
  `;
}

// ─────────────────────────────────────────────────────────── Image upload helper

/** Attach drag-drop and paste image upload to a textarea. Inserts markdown image syntax. */
function initImageUpload(textarea) {
  if (!textarea) return;

  async function uploadFile(file) {
    const name = file.name || "paste.png";
    try {
      const res = await fetch(`/api/attachments?name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    } catch (err) {
      showToast(`Upload failed: ${err.message}`, true);
      return null;
    }
  }

  function insertAtCursor(text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const needsNewline = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    textarea.value = before + needsNewline + text + "\n" + after;
    textarea.selectionStart = textarea.selectionEnd = start + needsNewline.length + text.length + 1;
    textarea.focus();
  }

  async function handleFiles(files) {
    // Use selected text as label, or prompt for one
    const selectedText = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).trim();
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const label = selectedText || prompt("Image label:", file.name) || file.name;
      const placeholder = `![Uploading ${label}...]()`;
      insertAtCursor(placeholder);
      const result = await uploadFile(file);
      if (result) {
        textarea.value = textarea.value.replace(
          placeholder,
          `![${label}](${result.filename})`,
        );
      } else {
        textarea.value = textarea.value.replace(placeholder, "");
      }
    }
  }

  textarea.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files?.length) return;
    const imageFiles = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    e.preventDefault();
    handleFiles(imageFiles);
  });

  textarea.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      textarea.classList.add("drag-over");
    }
  });

  textarea.addEventListener("dragleave", () => {
    textarea.classList.remove("drag-over");
  });

  textarea.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      handleFiles(imageFiles);
    }
  });
}

// ─────────────────────────────────────────────────────────── Markdown renderer

function mdToHtml(text) {
  if (!text) return "";

  function escHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inlineFormat(line) {
    let s = escHtml(line);
    // Inline code
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Bold
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // Strikethrough
    s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");
    // Italic
    s = s.replace(/\*(?!\*)(.+?)(?<!\*)\*/g, "<em>$1</em>");
    // Images (must come before links since ![alt](url) would match [alt](url))
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
      const safeUrl = /^(https?:\/\/|\/attachments\/)/.test(url) ? url : `/attachments/${url}`;
      return `<img src="${safeUrl}" alt="${alt}" loading="lazy">`;
    });
    // Links
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, url) => {
      const safeUrl = /^https?:\/\//i.test(url) ? url : "#";
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
    });
    return s;
  }

  const lines = text.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(escHtml(lines[i]));
        i++;
      }
      i++;
      out.push(
        `<pre><code${lang ? ` class="language-${escHtml(lang)}"` : ""}>${codeLines.join("\n")}</code></pre>`,
      );
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // Headings
    const h4 = line.match(/^####\s+(.*)/);
    if (h4) {
      out.push(`<h4>${inlineFormat(h4[1])}</h4>`);
      i++;
      continue;
    }
    const h3 = line.match(/^###\s+(.*)/);
    if (h3) {
      out.push(`<h3>${inlineFormat(h3[1])}</h3>`);
      i++;
      continue;
    }
    const h2 = line.match(/^##\s+(.*)/);
    if (h2) {
      out.push(`<h2>${inlineFormat(h2[1])}</h2>`);
      i++;
      continue;
    }
    const h1 = line.match(/^#\s+(.*)/);
    if (h1) {
      out.push(`<h1>${inlineFormat(h1[1])}</h1>`);
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${mdToHtml(quoteLines.join("\n"))}</blockquote>`);
      continue;
    }

    // Pipe table
    if (/^\|/.test(line)) {
      const tableLines = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 2) {
        const parseCells = (row) =>
          row
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim());
        const headers = parseCells(tableLines[0]);
        const rows = tableLines.slice(2);
        let tbl = "<table><thead><tr>";
        for (const h of headers) tbl += `<th>${inlineFormat(h)}</th>`;
        tbl += "</tr></thead><tbody>";
        for (const r of rows) {
          const cells = parseCells(r);
          tbl += "<tr>";
          for (let ci = 0; ci < headers.length; ci++) {
            tbl += `<td>${inlineFormat(cells[ci] || "")}</td>`;
          }
          tbl += "</tr>";
        }
        tbl += "</tbody></table>";
        out.push(tbl);
      }
      continue;
    }

    // Unordered list (with nested indent support)
    if (/^(\s*)[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^(\s*)[-*]\s+/.test(lines[i])) {
        const indent = lines[i].match(/^(\s*)/)[1].length;
        const content = lines[i].replace(/^\s*[-*]\s+/, "");
        if (indent >= 2 && items.length > 0) {
          // Nested item — append to last item
          items[items.length - 1] +=
            `<ul><li>${inlineFormat(content)}</li></ul>`;
        } else {
          items.push(`<li>${inlineFormat(content)}</li>`);
        }
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(
          `<li>${inlineFormat(lines[i].replace(/^\d+\.\s+/, ""))}</li>`,
        );
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Standalone image line
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imgMatch) {
      const alt = escHtml(imgMatch[1]);
      const rawUrl = imgMatch[2];
      const url = /^(https?:\/\/|\/attachments\/)/.test(rawUrl) ? rawUrl : `/attachments/${rawUrl}`;
      out.push(`<figure class="md-figure"><img src="${url}" alt="${alt}" loading="lazy">${alt ? `<figcaption>${alt}</figcaption>` : ""}</figure>`);
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-blank, non-block lines
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(```|#{1,4}\s|[-*]\s+|\d+\.\s+|\||>\s?|(-{3,}|\*{3,}|_{3,})\s*$)/.test(
        lines[i],
      )
    ) {
      paraLines.push(inlineFormat(lines[i]));
      i++;
    }
    if (paraLines.length > 0) {
      out.push(`<p>${paraLines.join("<br>")}</p>`);
    }
  }

  return out.join("\n");
}

// ─────────────────────────────────────────────────────────── Toast

function showToast(message, type = "success") {
  const container = document.getElementById("toasts");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 3000);
}

// ─────────────────────────────────────────────────────────── API

async function apiFetch(url, opts = {}) {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  } catch (err) {
    showToast(err.message, "error");
    throw err;
  }
}

async function loadAll() {
  const [items, designs, plans, sprints] = await Promise.all([
    apiFetch("/api/items").catch(() => []),
    apiFetch("/api/designs").catch(() => []),
    apiFetch("/api/plans").catch(() => []),
    apiFetch("/api/sprints").catch(() => []),
  ]);
  state.items = items || [];
  state.designs = designs || [];
  state.plans = plans || [];
  state.sprints = sprints || [];

  // Determine active sprints
  state.activeSprints = state.sprints.filter((s) => s.status === "active").reverse();
  // Auto-select most recent active sprint if nothing selected
  if (state.selectedSprintId === null && state.activeSprints.length > 0) {
    state.selectedSprintId = state.activeSprints[0].id;
  }
  // If selected sprint was ended/deleted, fall back
  if (
    state.selectedSprintId &&
    !state.activeSprints.find((s) => s.id === state.selectedSprintId)
  ) {
    state.selectedSprintId = state.activeSprints[0]?.id ?? null;
  }
  renderSprintTabs();
}

// ─────────────────────────────────────────────────────────── Sprint info

function renderSprintTabs() {
  const container = document.getElementById("sprintInfo");
  const sprintBtn = document.getElementById("sprintBtn");
  if (!container) return;

  const tabs = [
    { id: null, label: "All Items", isAll: true },
    ...state.activeSprints.map((s) => ({
      id: s.id,
      label: s.name,
      isAll: false,
    })),
  ];

  container.innerHTML = tabs
    .map(
      (tab) => `
    <button
      class="sprint-tab${tab.isAll ? " tab-all" : ""}${state.view === "board" && state.selectedSprintId === tab.id ? " tab-active" : ""}"
      data-sprint-id="${tab.id === null ? "" : escAttr(tab.id)}"
    >
      <span class="sprint-tab-dot"></span>
      ${escText(tab.label)}
    </button>
  `,
    )
    .join("") +
    `<button class="sprint-tab tab-decisions${state.view === "decisions" ? " tab-active" : ""}">
      <span class="sprint-tab-dot" style="background:var(--accent)"></span>
      Decisions
    </button>` +
    `<button class="sprint-tab tab-tests${state.view === "tests" ? " tab-active" : ""}">
      <span class="sprint-tab-dot" style="background:var(--accent)"></span>
      Tests
    </button>`;

  // Wire sprint/all-items tab clicks
  container.querySelectorAll(".sprint-tab:not(.tab-decisions):not(.tab-tests)").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rawId = btn.dataset.sprintId;
      state.selectedSprintId = rawId === "" ? null : rawId;
      state.view = "board";
      document.getElementById("kanbanBoard").classList.remove("hidden");
      document.getElementById("decisionsView").classList.add("hidden");
      document.getElementById("testsView").classList.add("hidden");
      renderSprintTabs();
      renderBoard();
      pushRoute(rawId ? `/sprint/${rawId}` : "/board");
    });
  });

  // Wire Decisions tab click
  container.querySelector(".tab-decisions").addEventListener("click", () => {
    state.view = "decisions";
    document.getElementById("kanbanBoard").classList.add("hidden");
    document.getElementById("decisionsView").classList.remove("hidden");
    document.getElementById("testsView").classList.add("hidden");
    renderSprintTabs();
    renderDecisionsView();
    pushRoute("/decisions");
  });

  // Wire Tests tab click
  container.querySelector(".tab-tests").addEventListener("click", () => {
    state.view = "tests";
    document.getElementById("kanbanBoard").classList.add("hidden");
    document.getElementById("decisionsView").classList.add("hidden");
    document.getElementById("testsView").classList.remove("hidden");
    renderSprintTabs();
    renderTestsView();
    pushRoute("/tests");
  });

  // Keep sprintBtn in sync — "End Sprint" only when a specific sprint tab is selected
  if (sprintBtn) {
    sprintBtn.textContent = state.selectedSprintId ? "End Sprint" : "+ Sprint";
  }

  // Show/hide Explore button based on sprint selection
  const exploreBtn = document.getElementById("exploreSprintBtn");
  if (exploreBtn) {
    if (state.selectedSprintId) {
      exploreBtn.classList.remove("hidden");
    } else {
      exploreBtn.classList.add("hidden");
    }
  }

  if (!state.selectedSprintId) removeSuggestionsBar();
}

// ─────────────────────────────────────────────────────────── Sprint suggestions bar

function removeSuggestionsBar() {
  const existing = document.getElementById("suggestionsBar");
  if (existing) existing.remove();
}

async function showSprintSuggestions(sprintId) {
  try {
    const suggestions = await apiFetch(`/api/sprints/${sprintId}/suggest`);
    if (!suggestions || !suggestions.length) return;

    removeSuggestionsBar();

    const bar = document.createElement("div");
    bar.id = "suggestionsBar";
    bar.className = "suggestions-bar";
    bar.innerHTML = `
      <span class="suggestions-label">Suggested items:</span>
      <div class="suggestions-chips">
        ${suggestions
          .map(
            (s) => `
          <button class="suggestion-chip" data-item-id="${escAttr(s.id || s.itemId || "")}">
            <span class="chip-id">${escText(s.id || s.itemId || "")}</span>
            <span class="chip-title">${escText(s.title || "")}</span>
          </button>
        `,
          )
          .join("")}
      </div>
    `;

    // Insert after header
    const header = document.querySelector(".dashboard-header");
    if (header && header.nextSibling) {
      header.parentNode.insertBefore(bar, header.nextSibling);
    } else {
      document.body.prepend(bar);
    }

    // Wire chip clicks
    bar.querySelectorAll(".suggestion-chip").forEach((chip) => {
      chip.addEventListener("click", async () => {
        const itemId = chip.dataset.itemId;
        if (!itemId) return;
        try {
          await apiFetch(`/api/sprints/${sprintId}/items`, {
            method: "POST",
            body: JSON.stringify({ itemId }),
          });
          chip.remove();
          // Remove bar if no chips left
          const remaining = bar.querySelectorAll(".suggestion-chip");
          if (remaining.length === 0) bar.remove();
          showToast(`Added ${itemId} to sprint`);
        } catch (err) {
          /* toasted */
        }
      });
    });
  } catch (err) {
    // Suggestions are optional, don't block on failure
  }
}

async function endActiveSprint() {
  if (!state.selectedSprintId) return;
  const endingId = state.selectedSprintId;
  try {
    await apiFetch(`/api/sprints/${endingId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });
    removeSuggestionsBar();
    showToast("Sprint ended");
  } catch (err) {
    /* toasted */
  }
}

// ─────────────────────────────────────────────────────────── Card builder

function buildCardHTML(entity, type) {
  const id = entity.id || "";
  const title = entity.title || entity.name || "(untitled)";

  // Priority pill (items only)
  let priorityPill = "";
  if (type === "item" && entity.priority) {
    priorityPill = `<span class="badge badge-priority-${escAttr(entity.priority)}">${escText(entity.priority)}</span>`;
  }

  // Type badge
  let typeBadge = "";
  if (type === "item" && entity.type) {
    typeBadge = `<span class="badge badge-type-${escAttr(entity.type)}">${escText(entity.type)}</span>`;
  } else if (type === "design") {
    typeBadge = '<span class="badge badge-type">SDD</span>';
  } else if (type === "plan") {
    typeBadge = '<span class="badge badge-type">Plan</span>';
  }

  // Comment count
  const commentCount = (entity.comments || []).length;
  const commentBadge =
    commentCount > 0
      ? `<span class="card-comments">${commentCount} comment${commentCount !== 1 ? "s" : ""}</span>`
      : "";

  // Task progress (plans)
  let taskProgress = "";
  if (type === "plan" && entity.tasks && entity.tasks.length > 0) {
    const done = entity.tasks.filter((t) => t.status === "done").length;
    const total = entity.tasks.length;
    taskProgress = `<span class="card-progress"><span class="done">${done}</span>/${total} tasks</span>`;
  }

  // Linked item count (SDDs)
  let linkedCount = "";
  if (
    type === "design" &&
    entity.linkedItems &&
    entity.linkedItems.length > 0
  ) {
    linkedCount = `<span class="card-comments">${entity.linkedItems.length} linked</span>`;
  }

  // Pillar badges (items only)
  const pillarBadges =
    type === "item"
      ? parsePillars(entity.pillar)
          .map((p) => `<span class="badge badge-pillar">${escText(p)}</span>`)
          .join("")
      : "";

  // Card class modifiers
  let cardClass = "card";
  if (type === "design") cardClass += " card-sdd";
  if (type === "plan") cardClass += " card-plan";
  if (type === "item" && entity.type) cardClass += ` card-type-${entity.type}`;

  return `
    <div class="${cardClass}"
         draggable="true"
         data-entity-type="${escAttr(type)}"
         data-entity-id="${escAttr(id)}"
         tabindex="0">
      <div class="card-id">${escText(id)}${entity.updatedAt ? `<span class="card-updated" title="${escAttr(new Date(entity.updatedAt).toLocaleString())}">updated ${relativeTime(entity.updatedAt)}</span>` : ""}</div>
      <div class="card-title">${escText(title)}</div>
      <div class="card-meta">
        ${typeBadge}
        ${priorityPill}
        ${pillarBadges}
        ${commentBadge}
        ${taskProgress}
        ${linkedCount}
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────── Tests view

const DRIFT_SEVERITY_CLASS = {
  broken: "broken",
  suspect: "suspect",
  warn: "warn",
};

async function renderTestsView() {
  const container = document.getElementById("testsView");
  container.innerHTML = '<div class="tests-loading">Loading tests…</div>';
  let cat;
  try {
    const res = await fetch("/api/tests");
    cat = await res.json();
  } catch (err) {
    container.innerHTML = `<div class="tests-empty">Failed to load catalogue: ${escText(err.message)}</div>`;
    return;
  }
  if (cat.missing) {
    container.innerHTML =
      '<div class="tests-empty">No catalogue yet. Run <code>./tests/run_tests.sh</code> to generate.</div>';
    return;
  }
  state.testsCatalogue = cat;
  container.innerHTML = renderTestsHTML(cat);
  bindTestsViewHandlers(container);
}

function formatTestRunTime(iso) {
  if (!iso) return { text: "never run", stale: false, missing: true };
  const diffMs = Date.now() - new Date(iso).getTime();
  const stale = diffMs > 24 * 60 * 60 * 1000;
  const base = relativeTime(iso);
  return { text: stale ? `stale — last run ${base}` : base, stale, missing: false };
}

function renderCodebaseDriftSection(codebaseDrift) {
  const findings = (codebaseDrift && codebaseDrift.constants_out_of_sync) || [];
  const count = findings.length;
  const summary = `<summary class="codebase-drift-summary">Codebase drift (${count} ${count === 1 ? "finding" : "findings"})</summary>`;
  if (count === 0) {
    return `<details class="codebase-drift-section">${summary}<div class="codebase-drift-empty">No codebase drift — constants and activity resources are in sync.</div></details>`;
  }
  const items = findings
    .map((f) => {
      const kind = f.kind || "unknown";
      const kindLabel = kind === "dangling_constant" ? "dangling constant" : kind === "unregistered_activity" ? "unregistered activity" : escText(kind);
      const constName = f.constant ? `<code>${escText(f.constant)}</code>` : "";
      const value = f.value ? `<code>${escText(f.value)}</code>` : "";
      const tresPath = f.tres_path ? ` <span class="codebase-drift-path">${escText(f.tres_path)}</span>` : "";
      const label = kind === "dangling_constant"
        ? `${constName} = ${value} has no matching <code>.tres</code>`
        : `${value} exists in .tres but no <code>ActivityIds</code> constant${tresPath}`;
      return `<li class="codebase-drift-item"><span class="codebase-drift-kind codebase-drift-kind-${kind}">${kindLabel}</span> ${label}</li>`;
    })
    .join("");
  return `<details class="codebase-drift-section">${summary}<ul class="codebase-drift-list">${items}</ul></details>`;
}

function renderDriftChip(d) {
  const severityClass = DRIFT_SEVERITY_CLASS[d.severity] || "warn";
  return `<span class="drift-chip drift-chip-${severityClass}" title="${escText(d.severity || "")}">${escText(d.code)}</span>`;
}

function renderGuardChip(id) {
  return `<span class="guard-chip">${escText(id)}</span>`;
}

function renderClaimBullet(c) {
  const text = escText(c.text || c.method || "");
  const lqClass = c.lowQuality ? " claim-low-quality" : "";
  return `<li class="tests-claim${lqClass}">${text}</li>`;
}

function renderTestRow(test) {
  const runMeta = formatTestRunTime(test.last_run_at);
  const statusLabel = test.status || "unknown";
  const statusClass = `tests-status-${statusLabel}`;
  const guards = (test.guards || []).map(renderGuardChip).join("");
  const drift = (test.drift || []).map(renderDriftChip).join("");
  const claims = (test.claims || []).map(renderClaimBullet).join("");
  const summaryText = test.summary ? `<p class="tests-summary">${escText(test.summary)}</p>` : "";
  const uncalled = (test.uncalledSubmethods || []).length > 0
    ? `<div class="tests-sub-block"><h4>Uncalled methods</h4><ul>${test.uncalledSubmethods.map((m) => `<li><code>${escText(m)}</code></li>`).join("")}</ul></div>`
    : "";
  const hardcoded = (test.hardcodedStrings || []).length > 0
    ? `<div class="tests-sub-block"><h4>Hardcoded activity strings</h4><ul>${test.hardcodedStrings.map((h) => `<li><code>"${escText(h.value)}"</code> → use <code>ActivityIds.${escText(h.constant || "?")}</code></li>`).join("")}</ul></div>`
    : "";
  const deadAssets = (test.deadAssetStrings || []).length > 0
    ? `<div class="tests-sub-block tests-sub-block-bad"><h4>Dead activity strings</h4><ul>${test.deadAssetStrings.map((v) => `<li><code>"${escText(v)}"</code> — not in <code>ActivityIds</code></li>`).join("")}</ul></div>`
    : "";
  const runLine = `<div class="tests-runline ${runMeta.stale ? "tests-runline-stale" : ""}">${escText(runMeta.text)}</div>`;
  const fileLabel = test.file ? `<span class="tests-filepath">${escText(test.file)}</span>` : "";
  const staleClass = runMeta.stale ? " tests-row-stale" : "";
  return `
    <details class="tests-row${staleClass}" data-test="${escText(test.name)}">
      <summary class="tests-row-summary">
        <span class="tests-row-status ${statusClass}" title="${escText(statusLabel)}"></span>
        <span class="tests-row-name">${escText(test.name)}</span>
        ${fileLabel}
        <span class="tests-row-chips">${guards}${drift}</span>
      </summary>
      <div class="tests-row-body">
        ${summaryText}
        ${claims ? `<ul class="tests-claims">${claims}</ul>` : ""}
        ${hardcoded}
        ${deadAssets}
        ${uncalled}
        ${runLine}
      </div>
    </details>
  `;
}

const TESTS_FILTER_LABELS = {
  all: "All",
  flagged: "Flagged",
  orphans: "Orphans",
  stale: "Stale",
};
const TESTS_SORT_LABELS = {
  directory: "Directory (default)",
  name: "Name",
  last_run: "Last run",
  drift: "Drift severity",
};
const DRIFT_SEVERITY_WEIGHT = { broken: 3, suspect: 2, warn: 1 };

function testCategory(test) {
  const dir = test.directory || "tests";
  const parts = dir.split("/").filter(Boolean);
  return parts[1] || parts[0] || "other";
}

function testIsStale(test) {
  if (!test.last_run_at) return false;
  return Date.now() - new Date(test.last_run_at).getTime() > 24 * 60 * 60 * 1000;
}

function testMaxDriftWeight(test) {
  return (test.drift || []).reduce((max, d) => {
    const w = DRIFT_SEVERITY_WEIGHT[d.severity] || 0;
    return w > max ? w : max;
  }, 0);
}

function testMatchesFilter(test, filter) {
  if (filter === "all") return true;
  if (filter === "flagged") return (test.drift || []).length > 0;
  if (filter === "orphans") return (test.drift || []).some((d) => d.code === "orphan_test");
  if (filter === "stale") return testIsStale(test);
  return true;
}

function testMatchesSearch(test, needle) {
  if (!needle) return true;
  const q = needle.toLowerCase();
  const hay = `${test.name || ""} ${test.summary || ""}`.toLowerCase();
  return hay.includes(q);
}

function sortTests(tests, sort) {
  const list = tests.slice();
  if (sort === "name") {
    list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  } else if (sort === "last_run") {
    list.sort((a, b) => {
      const at = a.last_run_at ? new Date(a.last_run_at).getTime() : 0;
      const bt = b.last_run_at ? new Date(b.last_run_at).getTime() : 0;
      return bt - at;
    });
  } else if (sort === "drift") {
    list.sort((a, b) => {
      const dw = testMaxDriftWeight(b) - testMaxDriftWeight(a);
      if (dw !== 0) return dw;
      const dc = (b.drift || []).length - (a.drift || []).length;
      if (dc !== 0) return dc;
      return (a.name || "").localeCompare(b.name || "");
    });
  } else {
    list.sort((a, b) => (a.file || a.name || "").localeCompare(b.file || b.name || ""));
  }
  return list;
}

function computeFilteredTests(cat) {
  const all = cat.tests || [];
  const filtered = all.filter(
    (t) => testMatchesFilter(t, state.testsFilter) && testMatchesSearch(t, state.testsSearch),
  );
  return filtered;
}

function renderTestsCountsLine(cat, filtered) {
  const driftTotal = filtered.reduce((sum, t) => sum + (t.drift || []).length, 0);
  const passed = filtered.filter((t) => t.status === "passed").length;
  const failed = filtered.filter((t) => t.status === "failed").length;
  const skipped = filtered.filter((t) => t.status === "skipped").length;
  const stalenessNote = cat.summary_stale
    ? `<span class="tests-staleness">summary.json stale — statuses may be out of date</span>`
    : "";
  return `
    <span class="tests-count tests-count-total"><strong>${filtered.length}</strong> tests</span>
    <span class="tests-count-sep">·</span>
    <span class="tests-count tests-count-flagged"><strong>${driftTotal}</strong> flagged</span>
    ${passed > 0 ? `<span class="tests-count-sep">·</span><span class="tests-count tests-count-passed"><strong>${passed}</strong> passed</span>` : ""}
    ${failed > 0 ? `<span class="tests-count-sep">·</span><span class="tests-count tests-count-failed"><strong>${failed}</strong> failed</span>` : ""}
    ${skipped > 0 ? `<span class="tests-count-sep">·</span><span class="tests-count tests-count-skipped"><strong>${skipped}</strong> skipped</span>` : ""}
    ${stalenessNote}
  `;
}

function renderCategoryChips(cat, filtered) {
  const allCategories = new Set((cat.tests || []).map(testCategory));
  const order = Array.from(allCategories).sort();
  const counts = {};
  for (const cat of order) counts[cat] = 0;
  for (const t of filtered) {
    const c = testCategory(t);
    if (c in counts) counts[c] += 1;
  }
  return order
    .map(
      (c) =>
        `<span class="category-chip" data-category="${escAttr(c)}">[${escText(c)}] <strong>${counts[c]}</strong></span>`,
    )
    .join("");
}

function renderFilterChips() {
  return Object.keys(TESTS_FILTER_LABELS)
    .map((f) => {
      const active = f === state.testsFilter ? " filter-chip-active" : "";
      return `<button type="button" class="filter-chip${active}" data-filter="${escAttr(f)}">${escText(TESTS_FILTER_LABELS[f])}</button>`;
    })
    .join("");
}

function renderSortSelect() {
  const opts = Object.keys(TESTS_SORT_LABELS)
    .map((k) => {
      const sel = k === state.testsSort ? " selected" : "";
      return `<option value="${escAttr(k)}"${sel}>${escText(TESTS_SORT_LABELS[k])}</option>`;
    })
    .join("");
  return `<select class="tests-sort-select" id="testsSortSelect" aria-label="Sort tests">${opts}</select>`;
}

function renderTestsGroupsHTML(filtered) {
  if (filtered.length === 0) {
    return `<div class="tests-empty-filter">No tests match the current filter.</div>`;
  }
  const groups = {};
  for (const t of filtered) {
    const dir = t.directory || "tests";
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(t);
  }
  const dirs = Object.keys(groups).sort();
  return dirs
    .map((dir) => {
      const rows = sortTests(groups[dir], state.testsSort).map(renderTestRow).join("");
      return `
        <section class="tests-group">
          <h3 class="tests-group-header"><span class="tests-group-dir">${escText(dir)}</span><span class="tests-group-count">${groups[dir].length}</span></h3>
          <div class="tests-group-body">${rows}</div>
        </section>
      `;
    })
    .join("");
}

function renderTestsHTML(cat) {
  const filtered = computeFilteredTests(cat);
  return `
    <div class="tests-view-inner">
      <header class="tests-header">
        <h2 class="tests-title">Test catalogue</h2>
        <div class="tests-counts" id="testsCounts">${renderTestsCountsLine(cat, filtered)}</div>
        <div class="tests-category-chips" id="testsCategoryChips">${renderCategoryChips(cat, filtered)}</div>
      </header>
      ${renderCodebaseDriftSection(cat.codebase_drift)}
      <div class="tests-controls">
        <input type="search" class="tests-search" id="testsSearch" placeholder="search name or summary…" value="${escAttr(state.testsSearch || "")}" aria-label="Search tests">
        <div class="tests-filter-chips" role="group" aria-label="Filter tests">${renderFilterChips()}</div>
        <label class="tests-sort-label">Sort: ${renderSortSelect()}</label>
      </div>
      <div class="tests-list" id="testsList">${renderTestsGroupsHTML(filtered)}</div>
    </div>
  `;
}

function applyTestsFilters() {
  const cat = state.testsCatalogue;
  if (!cat) return;
  const filtered = computeFilteredTests(cat);
  const countsEl = document.getElementById("testsCounts");
  const chipsEl = document.getElementById("testsCategoryChips");
  const listEl = document.getElementById("testsList");
  if (countsEl) countsEl.innerHTML = renderTestsCountsLine(cat, filtered);
  if (chipsEl) chipsEl.innerHTML = renderCategoryChips(cat, filtered);
  if (listEl) listEl.innerHTML = renderTestsGroupsHTML(filtered);
}

function bindTestsViewHandlers(container) {
  const searchInput = container.querySelector("#testsSearch");
  if (searchInput) {
    const onSearch = debounce(() => {
      state.testsSearch = searchInput.value || "";
      applyTestsFilters();
    }, 120);
    searchInput.addEventListener("input", onSearch);
  }
  const chipRow = container.querySelector(".tests-filter-chips");
  if (chipRow) {
    chipRow.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-filter]");
      if (!btn) return;
      const filter = btn.getAttribute("data-filter");
      if (!filter || filter === state.testsFilter) return;
      state.testsFilter = filter;
      chipRow.querySelectorAll(".filter-chip").forEach((el) => {
        el.classList.toggle("filter-chip-active", el.getAttribute("data-filter") === filter);
      });
      applyTestsFilters();
    });
  }
  const sortSelect = container.querySelector("#testsSortSelect");
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      state.testsSort = sortSelect.value;
      applyTestsFilters();
    });
  }
}

// ─────────────────────────────────────────────────────────── Decisions view

function renderDecisionsView(selectedId) {
  const container = document.getElementById("decisionsView");
  if (!container) return;

  const searchQuery = state.search.toLowerCase();
  const decisions = state.items.filter((item) => {
    if (item.type !== "decision") return false;
    if (!searchQuery) return true;
    const title = (item.title || "").toLowerCase();
    const id = (item.id || "").toLowerCase();
    const body = (item.body || "").toLowerCase();
    return title.includes(searchQuery) || id.includes(searchQuery) || body.includes(searchQuery);
  });

  // Group by pillar
  const groups = {};
  decisions.forEach((item) => {
    const pillars = parsePillars(item.pillar);
    if (pillars.length === 0) pillars.push("Uncategorized");
    pillars.forEach((p) => {
      if (!groups[p]) groups[p] = [];
      groups[p].push(item);
    });
  });

  const sortedPillars = Object.keys(groups).sort((a, b) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return a.localeCompare(b);
  });

  // Resolve which DD to show — keep current selection if still visible
  const allVisibleIds = decisions.map((d) => d.id);
  let activeId = selectedId || state._ddSelectedId || null;
  if (activeId && !allVisibleIds.includes(activeId)) activeId = null;
  if (!activeId && allVisibleIds.length > 0) activeId = allVisibleIds[0];
  state._ddSelectedId = activeId;

  const activeItem = activeId ? state.items.find((i) => i.id === activeId) : null;

  // Build list pane
  const listHTML = sortedPillars.length === 0
    ? '<div class="dd-empty">No decisions found.</div>'
    : sortedPillars.map((pillar) => `
        <div class="dd-group">
          <div class="dd-group-header">
            <span class="dd-group-title">${escText(pillar)}</span>
            <span class="dd-group-count">${groups[pillar].length}</span>
          </div>
          ${groups[pillar].map((item) => `
            <div class="dd-card${item.id === activeId ? " dd-card-active" : ""}" data-id="${escAttr(item.id)}">
              <span class="dd-card-id">${escText(item.id)}</span>
              <span class="dd-card-title">${escText(item.title)}</span>
            </div>
          `).join("")}
        </div>
      `).join("");

  // Build detail pane
  let detailHTML = "";
  if (activeItem) {
    const bodyHTML = activeItem.body
      ? mdToHtml(activeItem.body)
      : '<p style="color:var(--text-muted)">No description</p>';
    const pillarBadges = parsePillars(activeItem.pillar)
      .map((p) => `<span class="badge badge-pillar">${escText(p)}</span>`)
      .join("");

    // Related items
    const relatedItems = (activeItem.related || [])
      .map((rid) => state.items.find((i) => i.id === rid))
      .filter(Boolean);
    const relatedHTML = relatedItems.length > 0
      ? relatedItems.map((r) => `
          <div class="related-item" data-id="${escAttr(r.id)}">
            <span class="item-id">${escText(r.id)}</span>
            <span>${escText(r.title)}</span>
          </div>
        `).join("")
      : "";

    detailHTML = `
      <div class="dd-detail-toolbar">
        <div class="dd-detail-header">
          <span class="dd-detail-id">${escText(activeItem.id)}</span>
          ${pillarBadges}
        </div>
        <div class="dd-detail-actions">
          <button class="btn btn-secondary btn-sm" id="ddGeneratePrompt">Generate Prompt</button>
          <button class="btn btn-secondary btn-sm" id="ddFileIssue">File Issue from DD</button>
        </div>
      </div>
      <div class="dd-detail-doc">
        <h2 class="dd-detail-title">${escText(activeItem.title)}</h2>
        <div class="detail-body">${bodyHTML}</div>
        ${renderTestsWidget(activeItem.tests)}
        ${relatedHTML ? `
          <div class="detail-section">
            <div class="detail-section-title">Related Items</div>
            <div id="ddRelated">${relatedHTML}</div>
          </div>
        ` : ""}
        <div class="detail-section">
          <div class="detail-section-title">Comments</div>
          <div id="ddCommentThread"></div>
        </div>
        <div class="prompt-preview hidden" id="ddPromptPreview"></div>
      </div>
    `;
  } else {
    detailHTML = '<div class="dd-empty">Select a decision to view details.</div>';
  }

  container.innerHTML = `
    <div class="dd-index">${listHTML}</div>
    <div class="dd-detail">${detailHTML}</div>
  `;

  // Wire list clicks
  container.querySelectorAll(".dd-card[data-id]").forEach((el) => {
    el.addEventListener("click", () => {
      renderDecisionsView(el.dataset.id);
    });
  });

  // Wire detail interactions
  if (activeItem) {
    // Related item clicks
    container.querySelectorAll("#ddRelated .related-item[data-id]").forEach((el) => {
      el.addEventListener("click", () => showDetailOverlay(el.dataset.id));
    });

    // Comment thread
    renderComments(
      activeItem.comments || [],
      "items",
      activeItem.id,
      document.getElementById("ddCommentThread"),
      () => renderDecisionsView(activeItem.id),
    );

    document.getElementById("ddGeneratePrompt").addEventListener("click", () => {
      generateAndShowPrompt(
        { entityType: "item", entityId: activeItem.id, includeQmd: true },
        document.getElementById("ddPromptPreview"),
      );
    });

    document.getElementById("ddFileIssue").addEventListener("click", () => {
      // Open the new-item modal pre-filled with a reference to this DD
      openNewItemModal("inbox");
      const form = document.getElementById("newItemForm");
      if (!form) return;
      form.querySelector('[name="type"]').value = "issue";
      form.querySelector('[name="title"]').value = "";
      form.querySelector('[name="body"]').value =
        `Related to ${activeItem.id}: ${activeItem.title}\n\n`;
      form.querySelector('[name="title"]').focus();
    });
  }
}

// ─────────────────────────────────────────────────────────── Board rendering

function renderBoard() {
  const searchQuery = state.search.toLowerCase();

  COLUMNS.forEach((stage) => {
    const cardsContainer = document.getElementById(`cards-${stage}`);
    const countEl = document.getElementById(`count-${stage}`);
    if (!cardsContainer) return;

    const cards = [];

    // Items matching this column stage
    if (stage === "done") {
      // Done column: all entity types that are done
      state.items.forEach((item) => {
        if (item.stage === "done" || item.stage === "closed")
          cards.push({ entity: item, type: "item" });
      });
      state.designs.forEach((d) => {
        if (d.stage === "done") cards.push({ entity: d, type: "design" });
      });
      state.plans.forEach((p) => {
        if (p.stage === "done") cards.push({ entity: p, type: "plan" });
      });
    } else if (stage === "sdd") {
      // SDD column: items with stage 'sdd' + designs not done
      state.items.forEach((item) => {
        if (item.stage === "sdd") cards.push({ entity: item, type: "item" });
      });
      state.designs.forEach((d) => {
        if (d.stage !== "done") cards.push({ entity: d, type: "design" });
      });
    } else if (stage === "planned") {
      // Planned column: items with stage 'planned' + plans not done
      state.items.forEach((item) => {
        if (item.stage === "planned")
          cards.push({ entity: item, type: "item" });
      });
      state.plans.forEach((p) => {
        if (p.stage !== "done") cards.push({ entity: p, type: "plan" });
      });
    } else {
      // inbox, exploring: items only
      state.items.forEach((item) => {
        if (item.stage === stage) cards.push({ entity: item, type: "item" });
      });
    }

    // Exclude decisions from the kanban (they live in the Decisions view)
    const nonDecision = cards.filter((c) => c.type !== "item" || c.entity.type !== "decision");

    // Sprint filter: when a sprint is active, show only sprint items + unassigned inbox items
    let sprintFiltered = nonDecision;
    if (state.selectedSprintId) {
      const sprintId = state.selectedSprintId;
      sprintFiltered = cards.filter((c) => {
        const e = c.entity;
        // Always show items assigned to this sprint
        if (e.sprintId === sprintId) return true;
        // Also show unassigned inbox items (so they can be dragged into the sprint)
        if (stage === "inbox" && !e.sprintId) return true;
        return false;
      });
    }

    // Search filter
    const filtered = searchQuery
      ? sprintFiltered.filter((c) => {
          const e = c.entity;
          const title = (e.title || e.name || "").toLowerCase();
          const id = (e.id || "").toLowerCase();
          return title.includes(searchQuery) || id.includes(searchQuery);
        })
      : sprintFiltered;

    // Type filter
    const final =
      state.typeFilter.size > 0
        ? filtered.filter(
            (c) => c.type !== "item" || state.typeFilter.has(c.entity.type),
          )
        : filtered;

    // Sort newest first so recently created items appear at the top
    final.sort((a, b) => {
      const ta = a.entity.createdAt || "";
      const tb = b.entity.createdAt || "";
      return tb.localeCompare(ta);
    });

    // Update count
    if (countEl) countEl.textContent = final.length;

    // Render cards
    cardsContainer.innerHTML = final
      .map((c) => buildCardHTML(c.entity, c.type))
      .join("");

    // Stagger animation
    cardsContainer.querySelectorAll(".card").forEach((cardEl, i) => {
      cardEl.style.setProperty("--i", i);
    });
  });
}

// Delegated card click handler — wired once in initDragAndDrop on the board
function handleCardClick(e) {
  const card = e.target.closest(".card");
  if (!card || state.draggedCard) return;
  const entityType = card.dataset.entityType;
  const entityId = card.dataset.entityId;
  if (entityType === "item") showDetailOverlay(entityId);
  else if (entityType === "design") showSddDetail(entityId);
  else if (entityType === "plan") showPlanDetail(entityId);
}

/** Determine which column stage an entity belongs in */
function stageForEntity(entity, type) {
  const stage = entity.stage;
  if (stage === "done" || stage === "closed") return "done";
  if (type === "design") return stage || "sdd";
  if (type === "plan") return stage || "planned";
  return stage || "inbox";
}

/** Surgically update a single card in the DOM without rebuilding everything */
function patchCard(entity, type) {
  const board = document.getElementById("kanbanBoard");
  if (!board) return;
  const selector = `.card[data-entity-id="${CSS.escape(entity.id)}"]`;
  const existing = board.querySelector(selector);
  const newStage = stageForEntity(entity, type);
  const targetContainer = document.getElementById(`cards-${newStage}`);

  const newHTML = buildCardHTML(entity, type);

  if (existing) {
    const currentContainer = existing.closest(".kanban-cards");
    const temp = document.createElement("div");
    temp.innerHTML = newHTML;
    const newCard = temp.firstElementChild;
    if (currentContainer === targetContainer) {
      // Same column — replace in-place, keep position
      existing.replaceWith(newCard);
    } else {
      // Moving columns — remove from old, prepend to new (most recent at top)
      existing.remove();
      if (targetContainer) {
        targetContainer.prepend(newCard);
      }
    }
  } else if (targetContainer) {
    // New card — prepend to target column (most recent at top)
    targetContainer.insertAdjacentHTML("afterbegin", newHTML);
  }
  // Update column counts
  updateColumnCounts();
}

/** Remove a card from the DOM */
function removeCard(id) {
  const board = document.getElementById("kanbanBoard");
  if (!board) return;
  const card = board.querySelector(`.card[data-entity-id="${CSS.escape(id)}"]`);
  if (card) card.remove();
  updateColumnCounts();
}

/** Recount cards in each column */
function updateColumnCounts() {
  COLUMNS.forEach((stage) => {
    const container = document.getElementById(`cards-${stage}`);
    const countEl = document.getElementById(`count-${stage}`);
    if (container && countEl) {
      countEl.textContent = container.querySelectorAll(".card").length;
    }
  });
}

// ─────────────────────────────────────────────────────────── Drag and Drop

function initDragAndDrop() {
  const board = document.getElementById("kanbanBoard");
  if (!board) return;

  // Delegated card click
  board.addEventListener("click", handleCardClick);

  // Dragstart — delegated on the board
  board.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const entityType = card.dataset.entityType;
    const entityId = card.dataset.entityId;
    state.draggedCard = { type: entityType, id: entityId };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify(state.draggedCard));
    card.classList.add("dragging");
  });

  board.addEventListener("dragend", (e) => {
    const card = e.target.closest(".card");
    if (card) card.classList.remove("dragging");
    state.draggedCard = null;
    // Clean up all drag-over classes
    board
      .querySelectorAll(".kanban-col.drag-over")
      .forEach((col) => col.classList.remove("drag-over"));
  });

  // Dragover / dragleave / drop on columns
  board.querySelectorAll(".kanban-col").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      col.classList.add("drag-over");
    });

    col.addEventListener("dragleave", (e) => {
      // Only remove if actually leaving the column (not entering a child)
      if (!col.contains(e.relatedTarget)) {
        col.classList.remove("drag-over");
      }
    });

    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");

      let data = state.draggedCard;
      if (!data) {
        try {
          data = JSON.parse(e.dataTransfer.getData("text/plain"));
        } catch {
          return;
        }
      }
      if (!data || !data.type || !data.id) return;

      const targetStage = col.dataset.stage;
      const validStages = VALID_DROPS[data.type];
      if (!validStages || !validStages.includes(targetStage)) {
        showToast(`Cannot move ${data.type} to ${targetStage}`, "error");
        return;
      }

      // Determine the API endpoint
      let endpoint;
      if (data.type === "item") {
        endpoint = `/api/items/${data.id}`;
      } else if (data.type === "design") {
        endpoint = `/api/designs/${data.id}`;
      } else if (data.type === "plan") {
        endpoint = `/api/plans/${data.id}`;
      }

      try {
        // Build patch payload — include sprintId if active sprint and entity is unassigned
        const patchData = { stage: targetStage };
        if (state.selectedSprintId) {
          // Find the entity to check if it's unassigned
          let entity = null;
          if (data.type === "item")
            entity = state.items.find((i) => i.id === data.id);
          else if (data.type === "design")
            entity = state.designs.find((d) => d.id === data.id);
          else if (data.type === "plan")
            entity = state.plans.find((p) => p.id === data.id);
          if (entity && !entity.sprintId) {
            patchData.sprintId = state.selectedSprintId;
          }
        }

        await apiFetch(endpoint, {
          method: "PATCH",
          body: JSON.stringify(patchData),
        });
        showToast(`Moved to ${targetStage}`);
      } catch (err) {
        // Error already toasted by apiFetch
      }

      state.draggedCard = null;
    });
  });
}

// ─────────────────────────────────────────────────────────── Shared comment thread helper

/**
 * Render a comment thread into a container and wire up the add-comment form.
 * Used by item, SDD, and plan detail overlays for consistent UI.
 * @param {Array} comments - array of comment objects
 * @param {string} entityType - 'items' | 'designs' | 'plans'
 * @param {string} entityId - entity ID for the API endpoint
 * @param {HTMLElement} container - DOM element to render into
 * @param {Function} onCommentAdded - callback after comment is posted (e.g. re-render overlay)
 */
function renderComments(
  comments,
  entityType,
  entityId,
  container,
  onCommentAdded,
) {
  const commentsHTML = (comments || [])
    .map((c) => {
      const isUser = (c.author || "").toLowerCase() !== "claude";
      return `
      <div class="comment ${isUser ? "comment-user" : "comment-claude"}">
        <div class="comment-author">${escText(c.author || "Unknown")}</div>
        <div class="comment-text">${mdToHtml(c.text || "")}</div>
        <div class="comment-time">${relativeTime(c.createdAt)}</div>
      </div>
    `;
    })
    .join("");

  container.innerHTML = `
    <div class="comments-section">
      <div class="comments-title">Comments</div>
      <div class="comment-list" id="commentList">${commentsHTML}</div>
      <div class="comment-form">
        <textarea id="commentInput" placeholder="Add a comment..." rows="2"></textarea>
        <button class="btn btn-primary btn-sm" id="addCommentBtn">Add Comment</button>
      </div>
    </div>
  `;

  // Wire add comment
  container
    .querySelector("#addCommentBtn")
    .addEventListener("click", async () => {
      const input = container.querySelector("#commentInput");
      const text = (input.value || "").trim();
      if (!text) return;
      try {
        await apiFetch(`/api/${entityType}/${entityId}/comments`, {
          method: "POST",
          body: JSON.stringify({ text, author: "user" }),
        });
        input.value = "";
        if (onCommentAdded) onCommentAdded();
        showToast("Comment added");
      } catch (err) {
        /* toasted */
      }
    });

  // Scroll to bottom
  const commentList = container.querySelector("#commentList");
  if (commentList) commentList.scrollTop = commentList.scrollHeight;
}

// ─────────────────────────────────────────────────────────── Prompt generation helpers

/**
 * Generate a prompt via the API and show it in a preview container.
 * @param {Object} opts - { entityType, entityId, includeQmd }
 * @param {HTMLElement} previewEl - container for the prompt preview
 */
async function generateAndShowPrompt(opts, previewEl) {
  previewEl.classList.remove("hidden");
  previewEl.innerHTML =
    '<span style="color:var(--text-muted)">Generating...</span>';
  try {
    const result = await apiFetch("/api/context/prompt", {
      method: "POST",
      body: JSON.stringify(opts),
    });
    const promptText = result.prompt || result.text || "(empty)";
    previewEl.innerHTML = `
      <pre class="prompt-text">${escText(promptText)}</pre>
      <button class="btn btn-primary btn-sm prompt-copy-btn">Copy to Clipboard</button>
    `;
    previewEl
      .querySelector(".prompt-copy-btn")
      .addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(promptText);
          showToast("Prompt copied!");
        } catch {
          showToast("Copy failed", "error");
        }
      });
  } catch (err) {
    previewEl.innerHTML = `<span style="color:var(--danger)">Error: ${escText(err.message)}</span>`;
  }
}

async function generateAndShowReviewPrompt(opts, previewEl) {
  previewEl.classList.remove("hidden");
  previewEl.innerHTML =
    '<span style="color:var(--text-muted)">Generating review prompt (includes QMD queries)...</span>';
  try {
    const result = await apiFetch("/api/context/review", {
      method: "POST",
      body: JSON.stringify(opts),
    });
    const promptText = result.prompt || "(empty)";
    previewEl.innerHTML = `
      <pre class="prompt-text">${escText(promptText)}</pre>
      <button class="btn btn-primary btn-sm prompt-copy-btn">Copy to Clipboard</button>
    `;
    previewEl
      .querySelector(".prompt-copy-btn")
      .addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(promptText);
          showToast("Review prompt copied!");
        } catch {
          showToast("Copy failed", "error");
        }
      });
  } catch (err) {
    previewEl.innerHTML = `<span style="color:var(--danger)">Error: ${escText(err.message)}</span>`;
  }
}

/**
 * Show a prompt preview with copy button in the given container.
 * @param {string} text - The prompt text to display
 * @param {HTMLElement} previewEl - Container element (e.g. promptPreview div)
 */
function showPromptPreview(text, previewEl) {
  previewEl.classList.remove("hidden");
  previewEl.innerHTML = `
    <pre class="prompt-text">${escText(text)}</pre>
    <button class="btn btn-primary btn-sm prompt-copy-btn">Copy to Clipboard</button>
  `;
  previewEl
    .querySelector(".prompt-copy-btn")
    .addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        showToast("Prompt copied!");
      } catch {
        showToast("Copy failed", "error");
      }
    });
}

/**
 * Copy text to clipboard and show a toast.
 */
async function copyToClipboard(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(message || "Copied to clipboard");
  } catch {
    showToast("Copy failed", "error");
  }
}

// ─────────────────────────────────────────────────────────── Sprint dossier overlay

async function showSprintDossier(sprintId) {
  const overlay = document.getElementById("detailOverlay");
  const content = document.getElementById("detailContent");
  if (!overlay || !content) return;

  pushRoute(`/dossier/${sprintId}`);
  content.classList.add("dossier-view");
  content.innerHTML = `
    <div class="detail-main">
      <div class="overlay-header">
        <h2>Sprint Dossier</h2>
        <button class="overlay-close" onclick="closeDetailOverlay()">&times;</button>
      </div>
      <div style="padding:20px 0;color:var(--text-muted)">Generating...</div>
    </div>
  `;
  overlay.classList.remove("hidden");

  try {
    const result = await apiFetch(`/api/sprints/${sprintId}/explore`, {
      method: "POST",
    });
    const dossierText = result.dossier || "(empty dossier)";

    content.innerHTML = `
      <div class="detail-main">
        <div class="overlay-header">
          <h2>Sprint Dossier</h2>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn btn-primary btn-sm" id="dossierCopyBtn">Copy to Clipboard</button>
            <button class="overlay-close" id="dossierCloseBtn">&times;</button>
          </div>
        </div>
        <div class="detail-body">${mdToHtml(dossierText)}</div>
      </div>
    `;

    document.getElementById("dossierCopyBtn").addEventListener("click", () => {
      copyToClipboard(dossierText, "Dossier copied!");
    });
    document
      .getElementById("dossierCloseBtn")
      .addEventListener("click", closeDetailOverlay);
  } catch (err) {
    content.innerHTML = `<div style="padding:40px;color:var(--danger)">Error: ${escText(err.message)}</div>`;
  }
}

// ─────────────────────────────────────────────────────────── Detail overlay (items)

function showDetailOverlay(itemId) {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;

  const overlay = document.getElementById("detailOverlay");
  const content = document.getElementById("detailContent");
  if (!overlay || !content) return;

  pushRoute(`/item/${itemId}`);

  // Stage dropdown options
  const stageOptions = STAGES_FOR_ITEMS.map(
    (s) =>
      `<option value="${s}"${item.stage === s ? " selected" : ""}>${s}</option>`,
  ).join("");

  // Priority dropdown options
  const priorityOptions = ["", ...PRIORITIES]
    .map(
      (p) =>
        `<option value="${p}"${(item.priority || "") === p ? " selected" : ""}>${p || "--"}</option>`,
    )
    .join("");

  // Type badge
  const typeBadge = item.type
    ? `<span class="badge badge-type">${escText(item.type)}</span>`
    : "";

  // Body rendered as HTML
  const bodyHTML = item.body
    ? mdToHtml(item.body)
    : '<p style="color:var(--text-muted)">No description</p>';

  // Affected files
  const filesHTML =
    (item.affectedFiles || []).length > 0
      ? `<ul class="file-list">${item.affectedFiles.map((f) => `<li>${escText(f)}</li>`).join("")}</ul>`
      : '<span style="color:var(--text-muted)">None</span>';

  // Related items
  const relatedItems = (item.related || [])
    .map((rid) => state.items.find((i) => i.id === rid))
    .filter(Boolean);
  const relatedHTML =
    relatedItems.length > 0
      ? relatedItems
          .map(
            (r) => `
        <div class="related-item" data-id="${escAttr(r.id)}">
          <span class="item-id">${escText(r.id)}</span>
          <span>${escText(r.title)}</span>
        </div>
      `,
          )
          .join("")
      : '<span style="color:var(--text-muted)">None</span>';

  // Exploration prompt button (only for items in exploring stage)
  const explorationBtn =
    item.stage === "exploring"
      ? '<button class="btn btn-primary btn-sm" id="explorePromptBtn">Generate Exploration Prompt</button>'
      : "";

  content.innerHTML = `
    <div class="detail-main">
      <button class="detail-back" id="detailBack">&larr; Back</button>
      <div class="detail-id">${escText(item.id)}${item.updatedAt ? `<span class="detail-updated" title="${escAttr(new Date(item.updatedAt).toLocaleString())}">updated ${relativeTime(item.updatedAt)}</span>` : ""}</div>
      <div class="detail-title">
        <input type="text" id="detailTitleInput" value="${escAttr(item.title)}" />
      </div>
      <div class="detail-meta">
        <div class="meta-item">
          <span>Stage:</span>
          <select id="detailStageSelect">${stageOptions}</select>
        </div>
        <div class="meta-item">
          <span>Priority:</span>
          <select id="detailPrioritySelect">${priorityOptions}</select>
        </div>
        <div class="meta-item">
          <span>Sprint:</span>
          <select id="detailSprintSelect">${buildSprintOptions(item.sprintId)}</select>
        </div>
        <div class="meta-item">${typeBadge}</div>
        ${parsePillars(item.pillar)
          .map((p) => `<span class="badge badge-pillar">${escText(p)}</span>`)
          .join("")}
      </div>
      <div class="detail-body-wrapper">
        <div class="detail-body-toolbar">
          <button class="btn btn-secondary btn-sm" id="editBodyBtn">Edit</button>
        </div>
        <div class="detail-body" id="detailBody">${bodyHTML}</div>
        <div class="detail-body-edit hidden" id="detailBodyEdit">
          <textarea id="detailBodyTextarea" rows="12" placeholder="Markdown supported — drop or paste images">${escText(item.body || "")}</textarea>
          <div class="detail-body-edit-actions">
            <button class="btn btn-secondary btn-sm" id="cancelBodyBtn">Cancel</button>
            <button class="btn btn-primary btn-sm" id="saveBodyBtn">Save</button>
          </div>
        </div>
      </div>
      ${item.type === "decision" ? renderTestsWidget(item.tests) : ""}
      <div class="detail-section">
        <div class="detail-section-title">Affected Files</div>
        ${filesHTML}
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Related Items</div>
        <div id="detailRelated">${relatedHTML}</div>
      </div>
    </div>
    <div class="detail-sidebar">
      <div id="commentThread"></div>
      <div class="sidebar-actions">
        <button class="btn btn-primary btn-sm" id="generatePromptBtn">Generate Prompt</button>
        ${explorationBtn}
        <div class="prompt-preview hidden" id="promptPreview"></div>
        <button class="btn btn-danger btn-sm" id="archiveBtn">Archive</button>
      </div>
    </div>
  `;

  // Render comment thread via shared helper
  renderComments(
    item.comments || [],
    "items",
    item.id,
    document.getElementById("commentThread"),
    () => showDetailOverlay(item.id),
  );

  overlay.classList.remove("hidden");

  // ── Wire overlay events

  // Back button
  document
    .getElementById("detailBack")
    .addEventListener("click", () => closeDetailOverlay());

  // Title edit on blur
  const titleInput = document.getElementById("detailTitleInput");
  const originalTitle = item.title;
  titleInput.addEventListener("blur", async () => {
    const newTitle = titleInput.value.trim();
    if (newTitle && newTitle !== originalTitle) {
      try {
        await apiFetch(`/api/items/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: newTitle }),
        });
        showToast("Title updated");
      } catch (err) {
        /* toasted by apiFetch */
      }
    }
  });

  // Body edit toggle
  const bodyDisplay = document.getElementById("detailBody");
  const bodyEditWrap = document.getElementById("detailBodyEdit");
  const bodyTextarea = document.getElementById("detailBodyTextarea");
  const editBodyBtn = document.getElementById("editBodyBtn");

  editBodyBtn.addEventListener("click", () => {
    bodyDisplay.classList.add("hidden");
    bodyEditWrap.classList.remove("hidden");
    editBodyBtn.classList.add("hidden");
    bodyTextarea.focus();
  });

  document.getElementById("cancelBodyBtn").addEventListener("click", () => {
    bodyTextarea.value = item.body || "";
    bodyEditWrap.classList.add("hidden");
    bodyDisplay.classList.remove("hidden");
    editBodyBtn.classList.remove("hidden");
  });

  document.getElementById("saveBodyBtn").addEventListener("click", async () => {
    const newBody = bodyTextarea.value;
    try {
      const updated = await apiFetch(`/api/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ body: newBody }),
      });
      upsertInState("item", item.id, updated);
      showToast("Description updated");
      showDetailOverlay(item.id);
    } catch (err) {
      /* toasted */
    }
  });

  // Image upload on body edit textarea
  initImageUpload(bodyTextarea);

  // Stage change
  document
    .getElementById("detailStageSelect")
    .addEventListener("change", async (e) => {
      try {
        await apiFetch(`/api/items/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ stage: e.target.value }),
        });
        showToast(`Stage updated to ${e.target.value}`);
      } catch (err) {
        /* toasted */
      }
    });

  // Priority change
  document
    .getElementById("detailPrioritySelect")
    .addEventListener("change", async (e) => {
      try {
        await apiFetch(`/api/items/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ priority: e.target.value || null }),
        });
        showToast("Priority updated");
      } catch (err) {
        /* toasted */
      }
    });

  // Sprint change
  document
    .getElementById("detailSprintSelect")
    .addEventListener("change", async (e) => {
      try {
        await apiFetch(`/api/items/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sprintId: e.target.value || null }),
        });
        showToast(e.target.value ? `Moved to ${e.target.value}` : "Removed from sprint");
      } catch (err) {
        /* toasted */
      }
    });

  // Related item clicks
  content.querySelectorAll(".related-item[data-id]").forEach((el) => {
    el.addEventListener("click", () => showDetailOverlay(el.dataset.id));
  });

  // Generate prompt
  document.getElementById("generatePromptBtn").addEventListener("click", () => {
    generateAndShowPrompt(
      { entityType: "item", entityId: item.id, includeQmd: true },
      document.getElementById("promptPreview"),
    );
  });

  // Generate exploration prompt (items in exploring stage)
  const exploreBtn = document.getElementById("explorePromptBtn");
  if (exploreBtn) {
    exploreBtn.addEventListener("click", () => {
      const prompt = [
        `# Exploration Prompt for ${item.id}: ${item.title}`,
        "",
        `## Objective`,
        `Investigate and explore the following item to gather enough information for SDD creation.`,
        "",
        `## Item Details`,
        `- **ID:** ${item.id}`,
        `- **Title:** ${item.title}`,
        `- **Type:** ${item.type || "N/A"}`,
        `- **Priority:** ${item.priority || "N/A"}`,
        "",
        `## Description`,
        item.body || "(no description)",
        "",
        `## Affected Files`,
        (item.affectedFiles || []).map((f) => `- ${f}`).join("\n") || "(none)",
        "",
        `## Investigation Tasks`,
        `1. Identify the root cause or core requirements`,
        `2. Map affected code paths and dependencies`,
        `3. Document edge cases and constraints`,
        `4. Propose solution approaches with trade-offs`,
        `5. Recommend next steps (SDD creation or further exploration)`,
      ].join("\n");
      showPromptPreview(prompt, document.getElementById("promptPreview"));
    });
  }

  // Archive button — moves item to archive.json
  document.getElementById("archiveBtn").addEventListener("click", async () => {
    try {
      await apiFetch("/api/items/archive", {
        method: "POST",
        body: JSON.stringify({ ids: [item.id] }),
      });
      closeDetailOverlay();
      showToast(`${item.id} archived`);
    } catch (err) {
      /* toasted */
    }
  });
}

function closeDetailOverlay() {
  const overlay = document.getElementById("detailOverlay");
  const wasOpen = overlay && !overlay.classList.contains("hidden");
  if (overlay) overlay.classList.add("hidden");
  const content = document.getElementById("detailContent");
  if (content) content.classList.remove("dossier-view");
  if (wasOpen) pushRoute(currentBoardPath());
}

// ─────────────────────────────────────────────────────────── SDD Detail overlay

function showSddDetail(sddId) {
  const sdd = state.designs.find((d) => d.id === sddId);
  if (!sdd) return;

  pushRoute(`/sdd/${sddId}`);
  const overlay = document.getElementById("detailOverlay");
  const content = document.getElementById("detailContent");
  if (!overlay || !content) return;

  const bodyHTML = sdd.body
    ? mdToHtml(sdd.body)
    : '<p style="color:var(--text-muted)">No description</p>';

  // Linked items
  const linkedItemIds = sdd.linkedItems || sdd.itemIds || [];
  const linkedEntities = linkedItemIds
    .map((lid) => state.items.find((i) => i.id === lid))
    .filter(Boolean);
  const linkedHTML =
    linkedEntities.length > 0
      ? linkedEntities
          .map(
            (r) => `
        <div class="related-item" data-id="${escAttr(r.id)}" data-type="item">
          <span class="item-id">${escText(r.id)}</span>
          <span>${escText(r.title)}</span>
        </div>
      `,
          )
          .join("")
      : '<span style="color:var(--text-muted)">No linked items</span>';

  content.innerHTML = `
    <div class="detail-main">
      <button class="detail-back" id="detailBack">&larr; Back</button>
      <div class="detail-id"><span class="badge badge-type">SDD</span> ${escText(sdd.id)}${sdd.updatedAt ? `<span class="detail-updated" title="${escAttr(new Date(sdd.updatedAt).toLocaleString())}">updated ${relativeTime(sdd.updatedAt)}</span>` : ""}</div>
      <div class="detail-title">
        <input type="text" id="detailTitleInput" value="${escAttr(sdd.title || sdd.name || "")}" />
      </div>
      <div class="detail-meta">
        <div class="meta-item">
          <span>Sprint:</span>
          <select id="detailSprintSelect">${buildSprintOptions(sdd.sprintId)}</select>
        </div>
      </div>
      <div class="detail-body">${bodyHTML}</div>
      ${renderTestsWidget(sdd.tests)}
      <div class="detail-section">
        <div class="detail-section-title">Linked Items</div>
        <div id="detailLinked">${linkedHTML}</div>
      </div>
    </div>
    <div class="detail-sidebar">
      <div id="commentThread"></div>
      <div class="sidebar-actions">
        <button class="btn btn-primary btn-sm" id="generatePromptBtn">Generate Prompt</button>
        <button class="btn btn-primary btn-sm" id="generateSddPromptBtn">Generate SDD Prompt</button>
        <button class="btn btn-secondary btn-sm" id="reviewPromptBtn">Review Prompt</button>
        <button class="btn btn-primary btn-sm" id="createPlanBtn">Create Plan</button>
        ${sdd.body ? '<button class="btn btn-accent btn-sm" id="graduateDdBtn">Graduate to DD</button>' : ""}
        <div class="prompt-preview hidden" id="promptPreview"></div>
      </div>
    </div>
  `;

  overlay.classList.remove("hidden");

  // Render comment thread
  renderComments(
    sdd.comments || [],
    "designs",
    sdd.id,
    document.getElementById("commentThread"),
    () => showSddDetail(sdd.id),
  );

  // Back button
  document
    .getElementById("detailBack")
    .addEventListener("click", () => closeDetailOverlay());

  // Title edit on blur
  const titleInput = document.getElementById("detailTitleInput");
  const originalTitle = sdd.title || sdd.name || "";
  titleInput.addEventListener("blur", async () => {
    const newTitle = titleInput.value.trim();
    if (newTitle && newTitle !== originalTitle) {
      try {
        await apiFetch(`/api/designs/${sdd.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: newTitle }),
        });
        showToast("Title updated");
      } catch (err) {
        /* toasted */
      }
    }
  });

  // Sprint change
  document
    .getElementById("detailSprintSelect")
    .addEventListener("change", async (e) => {
      try {
        await apiFetch(`/api/designs/${sdd.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sprintId: e.target.value || null }),
        });
        showToast(e.target.value ? `Moved to ${e.target.value}` : "Removed from sprint");
      } catch (err) {
        /* toasted */
      }
    });

  // Linked item clicks → navigate to item detail
  content.querySelectorAll(".related-item[data-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const type = el.dataset.type;
      if (type === "item") showDetailOverlay(el.dataset.id);
    });
  });

  // Generate Prompt
  document.getElementById("generatePromptBtn").addEventListener("click", () => {
    generateAndShowPrompt(
      { entityType: "sdd", entityId: sdd.id, includeQmd: true },
      document.getElementById("promptPreview"),
    );
  });

  // Generate SDD Prompt (template for writing an SDD from linked items)
  document
    .getElementById("generateSddPromptBtn")
    .addEventListener("click", () => {
      const linkedInfo = linkedEntities
        .map(
          (item) =>
            `- **${item.id}**: ${item.title}${item.body ? "\n  " + item.body.split("\n")[0] : ""}`,
        )
        .join("\n");
      const prompt = [
        `# SDD Generation Prompt`,
        "",
        `## Task`,
        `Write a Software Design Document (SDD) for: **${sdd.title || sdd.name || sdd.id}**`,
        "",
        `## Linked Items`,
        linkedInfo || "(no linked items)",
        "",
        `## Current SDD Body`,
        sdd.body || "(empty — write from scratch)",
        "",
        `## SDD Template`,
        `Please produce an SDD with:`,
        `1. **Problem Statement** — what problem does this solve?`,
        `2. **Proposed Solution** — high-level approach`,
        `3. **Technical Design** — data structures, APIs, algorithms`,
        `4. **Affected Files** — which files need changes`,
        `5. **Testing Strategy** — how to verify correctness`,
        `6. **Open Questions** — unresolved decisions`,
      ].join("\n");
      showPromptPreview(prompt, document.getElementById("promptPreview"));
    });

  // Review Prompt (critical review of SDD)
  document.getElementById("reviewPromptBtn").addEventListener("click", () => {
    generateAndShowReviewPrompt(
      { entityType: "sdd", entityId: sdd.id },
      document.getElementById("promptPreview"),
    );
  });

  // Create Plan (copies a plan creation prompt to clipboard)
  document.getElementById("createPlanBtn").addEventListener("click", () => {
    // Find sprint context
    const activeSprint = state.sprints?.find(
      (s) => s.status === "active",
    );
    const linkedItemIds = sdd.linkedItems || sdd.itemIds || [];

    const lines = [`/plan ${sdd.id}`];

    // Add sprint context if relevant
    if (activeSprint) {
      lines.push("", `Sprint: ${activeSprint.id} — ${activeSprint.title || activeSprint.problem || ""}`);
    }

    // Add linked items as context for the planner
    if (linkedItemIds.length > 0) {
      lines.push("", `Linked items: ${linkedItemIds.join(", ")}`);
    }

    const prompt = lines.join("\n");
    showPromptPreview(prompt, document.getElementById("promptPreview"));
  });

  // Graduate to DD
  const graduateBtn = document.getElementById("graduateDdBtn");
  if (graduateBtn) {
    graduateBtn.addEventListener("click", () => {
      const backdrop = document.getElementById("modalBackdrop");
      const modal = backdrop.querySelector(".modal");
      modal.innerHTML = `
        <div class="modal-header">
          <h2>Graduate to Decision</h2>
          <button class="modal-close" id="graduateClose">&times;</button>
        </div>
        <form id="graduateForm">
          <div class="form-row">
            <label>Title *</label>
            <input type="text" name="title" required value="${escAttr(sdd.title || sdd.name || "")}">
          </div>
          <div class="form-row">
            <label>Pillar</label>
            <select name="pillar">
              <option value="">--</option>
              ${["Satisfying Growth", "Nudging creates tension", "Reproducibility", "Tooling"]
                .map((p) => `<option value="${escAttr(p)}">${escText(p)}</option>`)
                .join("")}
            </select>
          </div>
          <div class="form-row">
            <label>Body</label>
            <textarea name="body" rows="8">${escText(sdd.body || "")}</textarea>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-secondary" id="graduateCancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Create Decision</button>
          </div>
        </form>
      `;
      backdrop.classList.remove("hidden");

      document.getElementById("graduateClose").addEventListener("click", () => backdrop.classList.add("hidden"));
      document.getElementById("graduateCancel").addEventListener("click", () => backdrop.classList.add("hidden"));

      document.getElementById("graduateForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await apiFetch("/api/items", {
            method: "POST",
            body: JSON.stringify({
              type: "decision",
              title: fd.get("title"),
              body: fd.get("body"),
              pillar: fd.get("pillar") || undefined,
            }),
          });
          await apiFetch(`/api/designs/${sdd.id}`, {
            method: "PATCH",
            body: JSON.stringify({ stage: "done" }),
          });
          backdrop.classList.add("hidden");
          closeDetailOverlay();
          showToast("Decision created, SDD marked done");
        } catch (err) {
          showToast("Error: " + err.message, "error");
        }
      });
    });
  }
}

// ─────────────────────────────────────────────────────────── Plan Detail overlay

async function showPlanDetail(planId) {
  const plan = state.plans.find((p) => p.id === planId);
  if (!plan) return;

  pushRoute(`/plan/${planId}`);
  const overlay = document.getElementById("detailOverlay");
  const content = document.getElementById("detailContent");
  if (!overlay || !content) return;

  // Fetch ralph status for this plan
  let ralphStatus = null;
  try {
    const loops = await apiFetch("/api/ralph");
    ralphStatus = loops.find((l) => l.planId === planId) || null;
  } catch { /* ralph API unavailable */ }

  // Context info
  const ctx = plan.context || {};
  let contextHTML = "";
  if (ctx.setupNotes || ctx.relevantFiles || ctx.designDecisions) {
    const parts = [];
    if (ctx.setupNotes) {
      parts.push(
        `<div class="context-block"><strong>Setup Notes:</strong><div>${mdToHtml(ctx.setupNotes)}</div></div>`,
      );
    }
    if (ctx.relevantFiles && ctx.relevantFiles.length > 0) {
      parts.push(
        `<div class="context-block"><strong>Relevant Files:</strong><ul class="file-list">${ctx.relevantFiles.map((f) => `<li>${escText(f)}</li>`).join("")}</ul></div>`,
      );
    }
    if (ctx.designDecisions) {
      const ddText = Array.isArray(ctx.designDecisions) ? ctx.designDecisions.join("\n") : ctx.designDecisions;
      parts.push(
        `<div class="context-block"><strong>Design Decisions:</strong><div>${mdToHtml(ddText)}</div></div>`,
      );
    }
    contextHTML = `
      <div class="detail-section">
        <div class="detail-section-title">Context</div>
        ${parts.join("")}
      </div>
    `;
  }

  // Task list
  const tasks = plan.tasks || [];
  const taskListHTML =
    tasks.length > 0
      ? tasks
          .map((task, idx) => {
            const statusClass = `task-status-${task.status || "pending"}`;
            const checkedAttr = task.passes ? "checked" : "";
            const blockedBy = (task.blockedBy || []).filter((b) => b);
            const blockedHTML =
              blockedBy.length > 0
                ? `<span class="task-blocked">Blocked by: ${blockedBy.map((b) => escText(b)).join(", ")}</span>`
                : "";

            // Expanded details (hidden by default)
            const stepsHTML =
              (task.steps || []).length > 0
                ? `<ol class="task-steps">${task.steps.map((s) => `<li>${escText(s)}</li>`).join("")}</ol>`
                : "";
            const verificationHTML = task.verification
              ? `<div class="task-verification"><strong>Verification:</strong> ${escText(task.verification)}</div>`
              : "";
            const progressHTML =
              (task.progressNotes || []).length > 0
                ? `<div class="task-progress-notes"><strong>Progress:</strong><ul>${task.progressNotes.map((n) => `<li>${escText(typeof n === "string" ? n : n.text || "")}${n.timestamp ? ` <span style="color:var(--text-muted);font-size:11px">${new Date(n.timestamp).toLocaleString()}</span>` : ""}</li>`).join("")}</ul></div>`
                : "";

            return `
          <div class="task-item" data-task-idx="${idx}" data-task-id="${escAttr(task.id || "")}">
            <div class="task-header">
              <input type="checkbox" class="task-checkbox" data-task-idx="${idx}" ${checkedAttr} />
              <span class="task-title">${escText(task.title || `Task ${idx + 1}`)}</span>
              <span class="badge ${statusClass}">${escText(task.status || "pending")}</span>
              ${blockedHTML}
            </div>
            <div class="task-details hidden">
              ${task.description ? `<div class="task-description">${mdToHtml(task.description)}</div>` : ""}
              ${stepsHTML}
              ${verificationHTML}
              ${progressHTML}
            </div>
          </div>
        `;
          })
          .join("")
      : '<span style="color:var(--text-muted)">No tasks</span>';

  content.innerHTML = `
    <div class="detail-main">
      <button class="detail-back" id="detailBack">&larr; Back</button>
      <div class="detail-id"><span class="badge badge-type">Plan</span> ${escText(plan.id)}${plan.updatedAt ? `<span class="detail-updated" title="${escAttr(new Date(plan.updatedAt).toLocaleString())}">updated ${relativeTime(plan.updatedAt)}</span>` : ""}</div>
      <div class="detail-title">
        <span class="detail-title-text">${escText(plan.title || plan.name || "(untitled)")}</span>
      </div>
      <div class="detail-meta">
        <div class="meta-item">
          <span>Sprint:</span>
          <select id="detailSprintSelect">${buildSprintOptions(plan.sprintId)}</select>
        </div>
      </div>
      ${contextHTML}
      <div class="detail-section">
        <div class="detail-section-title">Tasks (${tasks.filter((t) => t.status === "done").length}/${tasks.length})</div>
        <div class="task-list" id="planTaskList">${taskListHTML}</div>
      </div>
    </div>
    <div class="detail-sidebar">
      <div id="commentThread"></div>
      <div class="sidebar-actions">
        ${ralphStatus && ralphStatus.alive ? `
          <div class="ralph-status ralph-running">
            <span class="ralph-dot"></span>
            Ralph running${ralphStatus.iteration ? ` (iteration ${ralphStatus.iteration})` : ""}
            ${ralphStatus.stopping ? " — stopping..." : ""}
          </div>
          <button class="btn btn-danger btn-sm" id="ralphStopBtn" ${ralphStatus.stopping ? "disabled" : ""}>
            ${ralphStatus.stopping ? "Stopping..." : "Stop Ralph"}
          </button>
        ` : ralphStatus && !ralphStatus.alive && ralphStatus.pid !== null ? `
          <div class="ralph-status ralph-stopped">
            Worktree exists (branch: ralph/${escText(plan.id)})
          </div>
        ` : ""}
        <button class="btn btn-primary btn-sm" id="generatePromptBtn">Generate Prompt</button>
        <button class="btn btn-secondary btn-sm" id="reviewPromptBtn">Review Prompt</button>
        <button class="btn btn-primary btn-sm" id="exportRalphBtn">Copy Ralph Command</button>
        <div class="prompt-preview hidden" id="promptPreview"></div>
      </div>
    </div>
  `;

  overlay.classList.remove("hidden");

  // Render comment thread
  renderComments(
    plan.comments || [],
    "plans",
    plan.id,
    document.getElementById("commentThread"),
    () => showPlanDetail(plan.id),
  );

  // Back button
  document
    .getElementById("detailBack")
    .addEventListener("click", () => closeDetailOverlay());

  // Sprint change
  document
    .getElementById("detailSprintSelect")
    .addEventListener("change", async (e) => {
      try {
        await apiFetch(`/api/plans/${plan.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sprintId: e.target.value || null }),
        });
        showToast(e.target.value ? `Moved to ${e.target.value}` : "Removed from sprint");
      } catch (err) {
        /* toasted */
      }
    });

  // Task item click → toggle expanded
  content.querySelectorAll(".task-item").forEach((taskEl) => {
    const header = taskEl.querySelector(".task-header");
    const details = taskEl.querySelector(".task-details");
    header.addEventListener("click", (e) => {
      // Don't toggle when clicking checkbox
      if (e.target.classList.contains("task-checkbox")) return;
      details.classList.toggle("hidden");
    });
  });

  // Task checkbox → mark done
  content.querySelectorAll(".task-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", async (e) => {
      const idx = parseInt(e.target.dataset.taskIdx, 10);
      const task = tasks[idx];
      if (!task) return;
      const taskId = task.id || idx;
      const newPasses = e.target.checked;
      const newStatus = newPasses ? "done" : "pending";
      try {
        const updated = await apiFetch(`/api/plans/${plan.id}/tasks/${taskId}`, {
          method: "PATCH",
          body: JSON.stringify({ passes: newPasses, status: newStatus }),
        });
        // Update task in local state so overlay re-renders with fresh data
        const localPlan = state.plans.find(p => p.id === plan.id);
        if (localPlan) {
          const localTask = localPlan.tasks.find(t => t.id === taskId);
          if (localTask) Object.assign(localTask, updated);
        }
        showPlanDetail(plan.id);
        showToast(`Task ${newPasses ? "completed" : "reopened"}`);
      } catch (err) {
        /* toasted */
      }
    });
  });

  // Generate Prompt
  document.getElementById("generatePromptBtn").addEventListener("click", () => {
    generateAndShowPrompt(
      { entityType: "plan", entityId: plan.id, includeQmd: true },
      document.getElementById("promptPreview"),
    );
  });

  // Review Prompt (critical review of plan)
  document.getElementById("reviewPromptBtn").addEventListener("click", () => {
    generateAndShowReviewPrompt(
      { entityType: "plan", entityId: plan.id },
      document.getElementById("promptPreview"),
    );
  });

  // Export for Ralph — copy the ralph.sh command for this plan
  document.getElementById("exportRalphBtn").addEventListener("click", () => {
    const cmd = `./ralph.sh 10 ${plan.id}`;
    copyToClipboard(cmd, "Ralph command copied!");
  });

  // Ralph stop button
  const ralphStopBtn = document.getElementById("ralphStopBtn");
  if (ralphStopBtn) {
    ralphStopBtn.addEventListener("click", async () => {
      try {
        await apiFetch(`/api/ralph/${plan.id}/stop`, { method: "POST" });
        showToast("Stop signal sent to Ralph");
        ralphStopBtn.disabled = true;
        ralphStopBtn.textContent = "Stopping...";
      } catch (err) {
        showToast("Failed to stop Ralph", "error");
      }
    });
  }
}

// ─────────────────────────────────────────────────────────── New Item Modal

function openNewItemModal(stage) {
  const backdrop = document.getElementById("modalBackdrop");
  if (backdrop) backdrop.classList.remove("hidden");
  const form = document.getElementById("newItemForm");
  if (form) form.reset();
  // Store target stage for the submit handler
  state._newItemStage = stage || "inbox";
  // Populate pillar select with normalized unique pillars
  const pillarSelect = document.getElementById("fieldPillar");
  if (pillarSelect) {
    const pillars = allUniquePillars();
    pillarSelect.innerHTML =
      '<option value="">--</option>' +
      pillars
        .map((p) => `<option value="${escAttr(p)}">${escText(p)}</option>`)
        .join("");
  }
}

function closeNewItemModal() {
  const backdrop = document.getElementById("modalBackdrop");
  if (backdrop) backdrop.classList.add("hidden");
}

// ─────────────────────────────────────────────────────────── Sprint Modal

function openSprintModal() {
  const backdrop = document.getElementById("sprintModalBackdrop");
  if (backdrop) backdrop.classList.remove("hidden");
  const form = document.getElementById("sprintForm");
  if (form) form.reset();
}

function closeSprintModal() {
  const backdrop = document.getElementById("sprintModalBackdrop");
  if (backdrop) backdrop.classList.add("hidden");
}

// ─────────────────────────────────────────────────────────── Event wiring

function initEvents() {
  // Search input
  const searchBox = document.getElementById("searchBox");
  if (searchBox) {
    const doSearch = debounce((val) => {
      state.search = val.trim();
      if (state.view === "decisions") renderDecisionsView();
      else renderBoard();
    }, 200);
    searchBox.addEventListener("input", (e) => doSearch(e.target.value));
  }

  // Type filter chips
  document.querySelectorAll(".type-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const t = chip.dataset.type;
      if (state.typeFilter.has(t)) {
        state.typeFilter.delete(t);
        chip.classList.remove("active");
      } else {
        state.typeFilter.add(t);
        chip.classList.add("active");
      }
      renderBoard();
    });
  });

  // Column add buttons
  document.querySelectorAll(".col-add-btn").forEach((btn) => {
    btn.addEventListener("click", () => openNewItemModal(btn.dataset.stage));
  });
  document
    .getElementById("modalClose")
    ?.addEventListener("click", closeNewItemModal);
  document
    .getElementById("modalCancel")
    ?.addEventListener("click", closeNewItemModal);

  document.getElementById("modalBackdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeNewItemModal();
  });

  // New item form submit
  document
    .getElementById("newItemForm")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      // Clean empty fields
      Object.keys(data).forEach((k) => {
        if (!data[k]) delete data[k];
      });
      // Use the stage from whichever column's + button was clicked
      data.stage = state._newItemStage || "inbox";
      // Assign to active sprint if one is selected
      if (state.selectedSprintId) {
        data.sprintId = state.selectedSprintId;
      }
      try {
        const created = await apiFetch("/api/items", {
          method: "POST",
          body: JSON.stringify(data),
        });
        closeNewItemModal();
        showToast(`Created ${created.id}`);
      } catch (err) {
        /* toasted */
      }
    });

  // Image upload on textarea (drag-drop + paste)
  initImageUpload(document.querySelector('#newItemForm textarea[name="body"]'));

  // Sprint button — toggle between start and end sprint
  document.getElementById("sprintBtn")?.addEventListener("click", () => {
    if (state.selectedSprintId) {
      endActiveSprint();
    } else {
      openSprintModal();
    }
  });
  // Explore sprint button — generate dossier in overlay
  document.getElementById("exploreSprintBtn")?.addEventListener("click", () => {
    if (state.selectedSprintId) showSprintDossier(state.selectedSprintId);
  });

  document
    .getElementById("sprintModalClose")
    ?.addEventListener("click", closeSprintModal);
  document
    .getElementById("sprintModalCancel")
    ?.addEventListener("click", closeSprintModal);

  document
    .getElementById("sprintModalBackdrop")
    ?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeSprintModal();
    });

  // Sprint form submit
  document
    .getElementById("sprintForm")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      Object.keys(data).forEach((k) => {
        if (!data[k]) delete data[k];
      });
      try {
        const created = await apiFetch("/api/sprints", {
          method: "POST",
          body: JSON.stringify(data),
        });
        closeSprintModal();
        if (created && created.id) {
          state.selectedSprintId = created.id;
        }
        showToast("Sprint started");
      } catch (err) {
        /* toasted */
      }
    });

  // Click backdrop to close detail overlay
  document.getElementById("detailOverlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeDetailOverlay();
  });

  // Escape to close overlays/modals
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const overlay = document.getElementById("detailOverlay");
      if (overlay && !overlay.classList.contains("hidden")) {
        closeDetailOverlay();
        return;
      }
      const modal = document.getElementById("modalBackdrop");
      if (modal && !modal.classList.contains("hidden")) {
        closeNewItemModal();
        return;
      }
      const sprintModal = document.getElementById("sprintModalBackdrop");
      if (sprintModal && !sprintModal.classList.contains("hidden")) {
        closeSprintModal();
      }
    }
  });
}

// ─────────────────────────────────────────────────────── Dynamic UI builders

function buildKanbanColumns(stages) {
  const board = document.getElementById("kanbanBoard");
  board.innerHTML = "";
  for (const stage of stages) {
    const label = stage.charAt(0).toUpperCase() + stage.slice(1);
    const isLast = stage === stages[stages.length - 1];
    const col = document.createElement("div");
    col.className = `kanban-col${isLast ? " collapsed" : ""}`;
    col.dataset.stage = stage;
    col.innerHTML = `
      <div class="col-header">
        <span class="col-title">${label}</span>
        <div class="col-header-right">
          ${!isLast ? `<button class="col-add-btn" data-stage="${stage}" title="New item in ${label}">+</button>` : ""}
          <span class="col-count" id="count-${stage}">0</span>
        </div>
      </div>
      <div class="col-cards" id="cards-${stage}"></div>`;
    board.appendChild(col);
  }
}

function buildTypeFilters(entityTypes) {
  const container = document.getElementById("typeFilters");
  container.innerHTML = "";
  // Item-level types only (not SDD, PLAN, SPRINT, TASK, MILESTONE)
  const structuralPrefixes = new Set(["SDD", "PLAN", "SPRINT", "TASK", "MILESTONE"]);
  for (const [prefix, meta] of Object.entries(entityTypes)) {
    if (structuralPrefixes.has(prefix)) continue;
    const label = meta.label || prefix;
    const typeName = label.toLowerCase();
    const btn = document.createElement("button");
    btn.className = "type-chip";
    btn.dataset.type = typeName;
    btn.innerHTML = `<span class="type-dot type-dot-${typeName}"></span>${label}`;
    container.appendChild(btn);
  }
}

function buildItemTypeSelect(entityTypes) {
  const select = document.getElementById("itemTypeSelect");
  if (!select) return;
  select.innerHTML = "";
  const structuralPrefixes = new Set(["SDD", "PLAN", "SPRINT", "TASK", "MILESTONE"]);
  for (const [prefix, meta] of Object.entries(entityTypes)) {
    if (structuralPrefixes.has(prefix)) continue;
    const label = meta.label || prefix;
    const opt = document.createElement("option");
    opt.value = label.toLowerCase();
    opt.textContent = label;
    select.appendChild(opt);
  }
}

// ─────────────────────────────────────────────────────────── Bootstrap

async function init() {
  // Load config from server and apply to UI
  try {
    pmConfig = await apiFetch("/api/config");
    document.getElementById("projectTitle").textContent = pmConfig.name + " PM";
    document.title = pmConfig.name + " PM";
    buildKanbanColumns(pmConfig.stages);
    buildTypeFilters(pmConfig.entityTypes);
    buildItemTypeSelect(pmConfig.entityTypes);
  } catch (err) {
    console.warn("Config load failed, using defaults:", err.message);
  }

  initEvents();
  initDragAndDrop();

  try {
    await loadAll();
    applyRoute();
  } catch (err) {
    console.error("Init failed:", err);
    showToast(`Load failed: ${err.message}`, "error");
  }

  // SSE: incremental updates from server
  const es = new EventSource("/api/events");
  let sseConnected = false;
  es.onopen = () => {
    sseConnected = true;
  };
  es.onmessage = async (e) => {
    const { entity, id, action } = JSON.parse(e.data);
    if (action === "delete" || action === "archive") {
      removeFromState(entity, id);
      removeCard(id);
    } else {
      try {
        const updated = await apiFetch(`/api/${entity}s/${id}`);
        upsertInState(entity, id, updated);
        patchCard(updated, entity);
      } catch {
        // Entity may have been deleted between event and fetch
        return;
      }
    }
    // Refresh open plan detail overlay if the updated entity is the displayed plan
    if (entity === "plan") {
      const overlay = document.getElementById("detailOverlay");
      if (overlay && !overlay.classList.contains("hidden")) {
        const displayedId = overlay.querySelector(".detail-id")?.textContent;
        if (displayedId && displayedId.includes(id)) {
          showPlanDetail(id);
        }
      }
    }
    // Recompute sprint tabs if sprint data changed
    if (entity === "sprint") {
      state.activeSprints = state.sprints.filter((s) => s.status === "active").reverse();
      if (
        state.selectedSprintId &&
        !state.activeSprints.find((s) => s.id === state.selectedSprintId)
      ) {
        state.selectedSprintId = state.activeSprints[0]?.id ?? null;
      }
      renderSprintTabs();
    }
  };
  es.onerror = async () => {
    // Only reload on actual reconnect, not initial connection
    if (!sseConnected) return;
    sseConnected = false;
    try {
      await loadAll();
      renderBoard();
    } catch {
      /* retry will happen via EventSource auto-reconnect */
    }
  };

  // Ralph status polling — update plan cards with running indicators
  async function pollRalphStatus() {
    try {
      state.ralphLoops = await apiFetch("/api/ralph");
    } catch { state.ralphLoops = []; }
    annotateRalphCards();
  }
  await pollRalphStatus();
  setInterval(pollRalphStatus, 10000);
}

/** Add/remove ralph running indicators on plan cards in the board */
function annotateRalphCards() {
  const activeIds = new Set(
    state.ralphLoops.filter((l) => l.alive).map((l) => l.planId)
  );
  document.querySelectorAll('.card-plan').forEach((card) => {
    const id = card.dataset.entityId;
    if (activeIds.has(id)) {
      if (!card.querySelector('.ralph-card-dot')) {
        const dot = document.createElement('span');
        dot.className = 'ralph-card-dot';
        dot.title = 'Ralph running';
        card.querySelector('.card-id')?.prepend(dot);
      }
    } else {
      card.querySelector('.ralph-card-dot')?.remove();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
