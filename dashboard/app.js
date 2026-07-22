/* ══════════════════════════════════════════════════════════════════════════
   PM Board — tickets · documents · projects
   app.js — sidebar nav, computed frontier boards, slide-over detail,
   decisions reader, activity rail
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
  archived: null, // lazy-loaded from /api/items/archived
  selectedProjectId: null, // sprint id or design id
  projectMode: "map", // 'map' | 'board' — toggle inside the project view
  search: "",
  kindFilter: new Set(),
  draggedCard: null,
  view: "tickets", // tickets | project | inbox | documents | decisions | tests | archive
  ralphLoops: [],
  testsCatalogue: null,
  testsFilter: "all",
  testsSearch: "",
  testsSort: "directory",
  stripsExpanded: null, // project id whose doc/exec strips are expanded
};

// Column stages in board order (overwritten from config at init)
let COLUMNS = ["inbox", "exploring", "sdd", "planned", "done"];
const PRIORITIES = ["critical", "balance", "feature", "polish"];
let STAGES_FOR_ITEMS = ["inbox", "exploring", "sdd", "planned", "done"];

// Valid drop targets per entity type
const VALID_DROPS = {
  item: ["inbox", "exploring", "sdd", "planned", "done"],
  design: ["sdd", "planned", "done"],
  plan: ["planned", "done"],
};

// ─────────────────────────────────────────────────────────── Kinds

const KINDS = ["research", "probe", "grill", "task", "gap"];
const KIND_COLORS = {
  research: "#52a9ff",
  probe: "#c084fc",
  grill: "#f0883e",
  task: "#46c288",
  gap: "#e2c541",
};
const HITL_KINDS = new Set(["grill", "probe"]);

/** Derive a ticket's kind: [research]/[probe]/[grill]/[task] title prefix, or gap type. */
function ticketKind(item) {
  if (!item) return null;
  if (item.type === "gap") return "gap";
  const m = /^\[(research|probe|grill|task)\]\s*/i.exec(item.title || "");
  return m ? m[1].toLowerCase() : null;
}

/** Title with the [kind] prefix stripped for display. */
function displayTitle(entity) {
  const t = entity.title || entity.name || "(untitled)";
  return t.replace(/^\[(research|probe|grill|task)\]\s*/i, "");
}

function kindColor(kind) {
  return KIND_COLORS[kind] || "#9b9fad";
}

function isTicket(item) {
  return item.type !== "decision";
}

// ─────────────────────────────────────────────────────────── Resolution / frontier

function isResolvedStage(stage) {
  return stage === "done" || stage === "closed";
}

function itemsById() {
  const map = new Map();
  for (const i of state.items) map.set(i.id, i);
  return map;
}

/**
 * Unresolved blockers for an item. Mirrors the server's frontier semantics:
 * blockers that are done, archived, or unknown ids do not block.
 */
function unresolvedBlockers(item, byId) {
  const blockers = Array.isArray(item.blockedBy) ? item.blockedBy : [];
  return blockers.filter((id) => {
    const blocker = byId.get(id);
    return blocker && !isResolvedStage(blocker.stage);
  });
}

/** Split a ticket list into { frontier, blocked, resolved }. */
function splitByFrontier(tickets) {
  const byId = itemsById();
  const frontier = [];
  const blocked = [];
  const resolved = [];
  for (const t of tickets) {
    if (isResolvedStage(t.stage)) {
      resolved.push(t);
    } else if (unresolvedBlockers(t, byId).length > 0) {
      blocked.push(t);
    } else {
      frontier.push(t);
    }
  }
  const byUpdated = (a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "");
  frontier.sort(byUpdated);
  blocked.sort(byUpdated);
  resolved.sort(byUpdated);
  return { frontier, blocked, resolved };
}

// ─────────────────────────────────────────────────────────── Projects
// A project IS a sprint (id SPRINT-NNN, labelled "Project"): the container for
// tickets, designs, and plans via their sprintId. SDDs are design documents,
// never project containers.

function computeProjects() {
  const projects = state.sprints.map((s) => ({
    id: s.id,
    name: s.name || s.id,
    destination: s.problemStatement || "",
    status: s.status,
    tickets: state.items.filter((i) => i.sprintId === s.id && isTicket(i)),
    sprint: s,
  }));
  // Active first, then most recently created
  projects.sort((a, b) => {
    const aa = a.status === "active" ? 0 : 1;
    const bb = b.status === "active" ? 0 : 1;
    if (aa !== bb) return aa - bb;
    return (b.sprint.createdAt || "").localeCompare(a.sprint.createdAt || "");
  });
  return projects;
}

function findProject(id) {
  return computeProjects().find((p) => p.id === id) || null;
}

/** Progress = resolved/total over the project's tickets. */
function projectProgress(p) {
  return {
    resolved: p.tickets.filter((t) => isResolvedStage(t.stage)).length,
    total: p.tickets.length,
  };
}

/** Plans executing a project. */
function projectPlans(p) {
  return state.plans.filter((plan) => plan.sprintId === p.id);
}

// ─────────────────────────────────────────────────────────── Router

let _skipPush = false; // prevent pushRoute during applyRoute-triggered renders

function currentBoardPath() {
  switch (state.view) {
    case "decisions": return "/decisions";
    case "tests": return "/tests";
    case "inbox": return "/inbox";
    case "documents": return "/documents";
    case "plans": return "/plans";
    case "archive": return "/archive";
    case "project": return state.selectedProjectId ? `/project/${state.selectedProjectId}` : "/tickets";
    default: return "/tickets";
  }
}

function pushRoute(path) {
  if (_skipPush) return;
  if (window.location.pathname === path) return;
  history.pushState({}, "", path);
}

const VIEW_CONTAINERS = {
  tickets: "kanbanBoard",
  project: "projectView",
  inbox: "inboxView",
  documents: "documentsView",
  plans: "plansView",
  decisions: "decisionsView",
  tests: "testsView",
  archive: "archiveView",
};

function showViewContainer(view) {
  for (const [name, elId] of Object.entries(VIEW_CONTAINERS)) {
    const el = document.getElementById(elId);
    if (el) el.classList.toggle("hidden", name !== view);
  }
  const strip = document.getElementById("projectStrip");
  if (strip) strip.classList.toggle("hidden", view !== "project");
  document.body.dataset.view = view;
  // Board view lives inside the project view when projectMode === 'board'
  if (view === "project" && state.projectMode === "board") {
    document.getElementById("kanbanBoard")?.classList.remove("hidden");
    document.getElementById("projectView")?.classList.add("hidden");
  }
}

function renderCurrentView() {
  showViewContainer(state.view);
  renderTopbar();
  switch (state.view) {
    case "decisions": renderDecisionsView(); break;
    case "tests": renderTestsView(); break;
    case "inbox": renderInboxView(); break;
    case "documents": renderDocumentsView(); break;
    case "plans": renderPlansView(); break;
    case "archive": renderArchiveView(); break;
    case "project":
      if (state.projectMode === "board") renderBoard();
      else renderProjectView();
      renderProjectStrip();
      break;
    default: renderBoard(); break;
  }
  renderSidebar();
  renderRail();
}

function setView(view, opts = {}) {
  state.view = view;
  if (view === "project") {
    if (opts.projectId) state.selectedProjectId = opts.projectId;
  }
  renderCurrentView();
  pushRoute(currentBoardPath());
}

function applyRoute() {
  _skipPush = true;
  closeDetailOverlay();

  const path = window.location.pathname;
  const parts = path.split("/").filter(Boolean);
  const section = parts[0] || "";
  const id = parts[1] || "";

  if (section === "decisions") state.view = "decisions";
  else if (section === "tests") state.view = "tests";
  else if (section === "inbox") state.view = "inbox";
  else if (section === "documents") state.view = "documents";
  else if (section === "plans") state.view = "plans";
  else if (section === "archive") state.view = "archive";
  else if ((section === "project" || section === "sprint") && id) {
    state.view = "project";
    state.selectedProjectId = id;
  } else if (section === "tickets" || section === "board") {
    state.view = "tickets";
  } else if (["item", "sdd", "plan", "dossier"].includes(section)) {
    // Overlay routes — keep current base view, show overlay after render
  } else {
    // "/" — default: most recent active project, else tickets
    const projects = computeProjects().filter((p) => p.status === "active");
    if (projects.length > 0) {
      state.view = "project";
      state.selectedProjectId = state.selectedProjectId || projects[0].id;
    } else {
      state.view = "tickets";
    }
  }

  renderCurrentView();
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

// ─────────────────────────────────────────────────────────── Pillar helpers (legacy metadata)

const PILLAR_ALIASES = {
  "nudging creates meaningful tension": "Nudging creates tension",
  "satisfying growth": "Satisfying Growth",
  "reproducibility / workflow": "Reproducibility",
  reproducibility: "Reproducibility",
  "n/a (tooling)": "Tooling",
  "n/a (tooling/diagnostics)": "Tooling",
  "n/a — data quality": "Tooling",
};

function parsePillars(raw) {
  if (!raw) return [];
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => PILLAR_ALIASES[s.toLowerCase()] || s);
}

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

/** Short relative time for card corners: 4d, 2h, 1mo */
function shortTime(dateString) {
  if (!dateString) return "";
  const diff = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

/**
 * Render the VERIFIED CLAIMS widget for a DD/SDD detail pane.
 */
function renderTestsWidget(tests) {
  const list = Array.isArray(tests) ? tests : [];
  if (list.length === 0) {
    return `
      <div class="detail-section detail-tests">
        <h3 class="detail-section-title">Verified claims</h3>
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
      <h3 class="detail-section-title">Verified claims</h3>
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
    // Entity id cross-links (SB-123, DD-101, SDD-090, PLAN-108…) → quick-openable spans
    s = s.replace(/\b([A-Z]{2,10}-\d{2,5})\b(?![^<]*<\/(?:code|a)>)/g, (m, id) => {
      return `<span class="md-entity-ref" data-ref-id="${id}">${id}</span>`;
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

/** Wire clicks on SB-123-style refs inside rendered markdown. */
function wireEntityRefs(container) {
  if (!container) return;
  container.querySelectorAll(".md-entity-ref[data-ref-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openEntityById(el.dataset.refId);
    });
  });
}

/** Open the right detail surface for any known entity id. */
function openEntityById(id) {
  if (state.items.find((i) => i.id === id)) return showDetailOverlay(id);
  if (state.designs.find((d) => d.id === id)) return showSddDetail(id);
  if (state.plans.find((p) => p.id === id)) return showPlanDetail(id);
  if (state.sprints.find((s) => s.id === id)) return showSprintDossier(id);
}

// ─────────────────────────────────────────────────────────── Start-work commands
// Copy-to-paste commands come from pm.config.json `commands` — the project's
// own vocabulary ({id}/{title} placeholders). The dashboard knows nothing
// about specific skills; no template configured → no button.

function startCommand(entity, type) {
  const cmds = pmConfig.commands || {};
  let tpl = null;
  if (type === "item") {
    const t = cmds.ticket || {};
    tpl = t[ticketKind(entity)] || t.default || null;
  } else if (type === "design") tpl = cmds.sdd || null;
  else if (type === "plan") tpl = cmds.plan || null;
  else if (type === "project") tpl = cmds.project || null;
  if (!tpl) return null;
  return tpl
    .replaceAll("{id}", entity.id || "")
    .replaceAll("{title}", displayTitle(entity));
}

function startButtonHTML(entity, type) {
  const cmd = startCommand(entity, type);
  if (!cmd) return "";
  return `<button class="btn btn-primary btn-sm" id="startCmdBtn" title="${escAttr(cmd)}">⧉ Start</button>`;
}

function wireStartButton(entity, type) {
  const btn = document.getElementById("startCmdBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const cmd = startCommand(entity, type);
    if (cmd) copyToClipboard(cmd, `Copied: ${cmd}`);
  });
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

/** Silent ralph status fetch — the route may not exist; never toast. */
async function fetchRalphLoops() {
  try {
    const res = await fetch("/api/ralph", { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const type = res.headers.get("content-type") || "";
    if (!type.includes("application/json")) return [];
    const loops = await res.json();
    return Array.isArray(loops) ? loops : [];
  } catch {
    return [];
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
}

// ─────────────────────────────────────────────────────────── Sidebar

function navCounts() {
  const openTickets = state.items.filter((i) => isTicket(i) && !isResolvedStage(i.stage));
  return {
    inbox: openTickets.filter((i) => i.stage === "inbox").length,
    tickets: openTickets.length,
    documents: state.designs.filter((d) => d.stage !== "done").length,
    plans: state.plans.filter((p) => p.stage !== "done").length,
    decisions: state.items.filter((i) => i.type === "decision").length,
  };
}

function renderSidebar() {
  const nav = document.getElementById("sidebarNav");
  if (!nav) return;
  const counts = navCounts();

  const navRows = [
    { view: "inbox", label: "Inbox", count: counts.inbox, swatch: "swatch-dashed" },
    { view: "tickets", label: "Tickets", count: counts.tickets, swatch: "swatch-neutral" },
    { view: "documents", label: "Documents", count: counts.documents, swatch: "swatch-indigo" },
    { view: "plans", label: "Plans", count: counts.plans, swatch: "swatch-green" },
    { view: "decisions", label: "Decisions", count: counts.decisions, swatch: "swatch-blue" },
    { view: "tests", label: "Tests", count: null, swatch: "swatch-neutral" },
    { view: "archive", label: "Archive", count: null, swatch: "swatch-neutral" },
  ];

  nav.innerHTML = navRows
    .map(
      (r) => `
    <button class="nav-row${state.view === r.view ? " nav-active" : ""}" data-view="${r.view}">
      <span class="nav-swatch ${r.swatch}"></span>
      <span class="nav-label">${r.label}</span>
      ${r.count !== null ? `<span class="nav-count">${r.count}</span>` : ""}
    </button>`,
    )
    .join("");

  nav.querySelectorAll(".nav-row").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  // Projects — only ones with open work (or the selected one), capped
  const projEl = document.getElementById("sidebarProjects");
  if (projEl) {
    const all = computeProjects();
    let projects = all.filter((p) => {
      if (p.id === state.selectedProjectId) return true;
      if (p.status !== "active") return false;
      const { resolved, total } = projectProgress(p);
      return total === 0 || resolved < total;
    });
    const overflow = projects.length - 12;
    if (overflow > 0) projects = projects.slice(0, 12);
    projEl.innerHTML = projects
      .map((p) => {
        const { resolved, total } = projectProgress(p);
        const active = state.view === "project" && state.selectedProjectId === p.id;
        const done = p.status !== "active";
        const dotStyle = done
          ? "background:#3b3e4d"
          : active
            ? "background:#7b83eb;box-shadow:0 0 6px rgba(123,131,235,.6)"
            : "background:#46c288";
        const meta = done
          ? '<span class="proj-check">✓</span>'
          : `<span class="proj-progress">${resolved}/${total}</span>`;
        return `
        <button class="proj-row${active ? " proj-active" : ""}${done ? " proj-done" : ""}" data-project-id="${escAttr(p.id)}">
          <span class="proj-dot" style="${dotStyle}"></span>
          <span class="proj-name">${escText(p.name)}</span>
          ${meta}
        </button>`;
      })
      .join("") + (overflow > 0 ? `<div class="proj-overflow">+ ${overflow} more — ⌘K to jump</div>` : "");
    projEl.querySelectorAll(".proj-row").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.projectMode = "map";
        setView("project", { projectId: btn.dataset.projectId });
      });
    });
  }

  // Kinds (open tickets only) — click toggles filter
  const kindsEl = document.getElementById("sidebarKinds");
  if (kindsEl) {
    const open = state.items.filter((i) => isTicket(i) && !isResolvedStage(i.stage));
    kindsEl.innerHTML = KINDS.map((k) => {
      const count = open.filter((i) => ticketKind(i) === k).length;
      const active = state.kindFilter.has(k);
      return `
        <button class="kind-row${active ? " kind-active" : ""}" data-kind="${k}">
          <span class="kind-dot" style="background:${kindColor(k)}"></span>
          <span class="kind-label">${k}</span>
          <span class="kind-count">${count}</span>
        </button>`;
    }).join("");
    kindsEl.querySelectorAll(".kind-row").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.kind;
        if (state.kindFilter.has(k)) state.kindFilter.delete(k);
        else state.kindFilter.add(k);
        renderCurrentView();
      });
    });
  }
}

// ─────────────────────────────────────────────────────────── Topbar

const VIEW_TITLES = {
  tickets: "Tickets",
  inbox: "Inbox",
  documents: "Documents",
  plans: "Plans",
  decisions: "Decisions",
  tests: "Tests",
  archive: "Archive",
};

function renderTopbar() {
  const bar = document.getElementById("topbar");
  if (!bar) return;

  let leftHTML = "";
  let togglesHTML = "";
  let extraActions = "";

  if (state.view === "project") {
    const p = findProject(state.selectedProjectId);
    if (!p) {
      leftHTML = `<span class="topbar-title">Project</span>`;
    } else {
      leftHTML = `<span class="topbar-title">${escText(p.name)}</span><button class="topbar-doclink" id="topbarProjectDoc">${escText(p.id)} ↗</button>`;
      togglesHTML = `
        <div class="seg-toggle">
          <button class="seg${state.projectMode === "map" ? " seg-active" : ""}" data-mode="map">Map</button>
          <button class="seg${state.projectMode === "board" ? " seg-active" : ""}" data-mode="board">Board</button>
        </div>`;
      if (p.status === "active") {
        extraActions = `
          <button class="btn btn-ghost btn-sm" id="exploreSprintBtn">Explore</button>
          <button class="btn btn-ghost btn-sm" id="endSprintBtn">End</button>`;
      }
    }
  } else {
    const counts = navCounts();
    const sub =
      state.view === "tickets" ? `<span class="topbar-sub">${counts.tickets} open</span>` :
      state.view === "inbox" ? `<span class="topbar-sub">${counts.inbox} waiting</span>` :
      state.view === "plans" ? `<span class="topbar-sub">${counts.plans} in flight</span>` :
      state.view === "decisions" ? `<span class="topbar-sub">${counts.decisions} · newest carry the weight</span>` :
      "";
    leftHTML = `<span class="topbar-title">${VIEW_TITLES[state.view] || ""}</span>${sub}`;
  }

  bar.innerHTML = `
    ${leftHTML}
    <div class="topbar-actions">
      ${togglesHTML}
      <input type="search" class="topbar-search" id="searchBox" placeholder="Filter…" value="${escAttr(state.search)}">
      ${extraActions}
      <button class="btn btn-primary btn-sm" id="newItemBtn">New ticket</button>
    </div>
  `;

  // Wire
  const searchBox = document.getElementById("searchBox");
  if (searchBox) {
    const doSearch = debounce((val) => {
      state.search = val.trim();
      renderActiveContent();
    }, 200);
    searchBox.addEventListener("input", (e) => doSearch(e.target.value));
  }
  document.getElementById("newItemBtn")?.addEventListener("click", () => openNewItemModal("inbox"));
  bar.querySelectorAll(".seg-toggle .seg").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.projectMode = btn.dataset.mode;
      renderCurrentView();
    });
  });
  document.getElementById("topbarProjectDoc")?.addEventListener("click", () => {
    showProjectDoc(state.selectedProjectId);
  });
  document.getElementById("exploreSprintBtn")?.addEventListener("click", () => {
    if (state.selectedProjectId) showSprintDossier(state.selectedProjectId);
  });
  document.getElementById("endSprintBtn")?.addEventListener("click", endActiveSprint);
}

/** Re-render just the content pane (search etc.), keeping topbar focus intact. */
function renderActiveContent() {
  switch (state.view) {
    case "decisions": renderDecisionsView(); break;
    case "tests": applyTestsFilters(); break;
    case "inbox": renderInboxView(); break;
    case "documents": renderDocumentsView(); break;
    case "plans": renderPlansView(); break;
    case "archive": renderArchiveView(); break;
    case "project":
      if (state.projectMode === "board") renderBoard();
      else renderProjectView();
      break;
    default: renderBoard(); break;
  }
}

// ─────────────────────────────────────────────────────────── Sprint end

async function endActiveSprint() {
  const p = findProject(state.selectedProjectId);
  if (!p) return;
  const { resolved, total } = projectProgress(p);
  if (total - resolved > 0 && !confirm(`Complete ${p.id}? ${total - resolved} open ticket(s) will be marked done.`)) return;
  try {
    await apiFetch(`/api/sprints/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });
    showToast("Project completed");
  } catch (err) {
    /* toasted */
  }
}

// ─────────────────────────────────────────────────────────── Shared filters

function matchesSearch(entity) {
  if (!state.search) return true;
  const q = state.search.toLowerCase();
  const title = (entity.title || entity.name || "").toLowerCase();
  const id = (entity.id || "").toLowerCase();
  return title.includes(q) || id.includes(q);
}

function matchesKindFilter(item) {
  if (state.kindFilter.size === 0) return true;
  return state.kindFilter.has(ticketKind(item));
}

// ─────────────────────────────────────────────────────────── Card builder (kanban board)

function buildCardHTML(entity, type) {
  const id = entity.id || "";
  const title = displayTitle(entity);
  const kind = type === "item" ? ticketKind(entity) : null;
  const idColor = kind ? kindColor(kind) : type === "design" ? "#7b83eb" : type === "plan" ? "#46c288" : "#62667a";

  // Kind / type label
  let kindLabel = "";
  if (kind) {
    kindLabel = `<span class="card-kind" style="color:${kindColor(kind)}">${kind.toUpperCase()}</span>`;
  } else if (type === "design") {
    kindLabel = '<span class="card-kind" style="color:#7b83eb">MAP</span>';
  } else if (type === "plan") {
    kindLabel = '<span class="card-kind" style="color:#46c288">PLAN</span>';
  }

  // Priority pill (items only)
  let priorityPill = "";
  if (type === "item" && entity.priority) {
    priorityPill = `<span class="card-priority card-priority-${escAttr(entity.priority)}">${escText(entity.priority).toUpperCase()}</span>`;
  }

  // Blocked-by chips
  let blockedChips = "";
  if (type === "item") {
    const blockers = unresolvedBlockers(entity, itemsById());
    if (blockers.length > 0) {
      blockedChips = `<span class="card-blocked">⊘ ${blockers.map(escText).join(" · ")}</span>`;
    }
  }

  // Comment count
  const commentCount = (entity.comments || []).length;
  const commentBadge =
    commentCount > 0
      ? `<span class="card-note">${commentCount} comment${commentCount !== 1 ? "s" : ""}</span>`
      : "";

  // Task progress (plans)
  let taskProgress = "";
  if (type === "plan" && entity.tasks && entity.tasks.length > 0) {
    const done = entity.tasks.filter((t) => t.status === "done").length;
    const total = entity.tasks.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    taskProgress = `
      <span class="card-taskbar"><span style="width:${pct}%"></span></span>
      <span class="card-progress">${done}/${total}</span>`;
  }

  // Linked item count (SDDs)
  let linkedCount = "";
  if (type === "design" && entity.linkedItems && entity.linkedItems.length > 0) {
    linkedCount = `<span class="card-note">${entity.linkedItems.length} linked</span>`;
  }

  let cardClass = "card";
  if (type === "design") cardClass += " card-sdd";
  if (type === "plan") cardClass += " card-plan";
  if (kind) cardClass += ` card-kind-${kind}`;

  return `
    <div class="${cardClass}"
         draggable="true"
         data-entity-type="${escAttr(type)}"
         data-entity-id="${escAttr(id)}"
         tabindex="0">
      <div class="card-top">
        <span class="card-id" style="color:${idColor}">${escText(id)}</span>
        ${kindLabel}
        ${priorityPill}
        <span class="card-age">${shortTime(entity.updatedAt || entity.createdAt)}</span>
      </div>
      <div class="card-title">${escText(title)}</div>
      <div class="card-meta">
        ${blockedChips}
        ${commentBadge}
        ${linkedCount}
        ${taskProgress}
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────── Board (stage kanban)

function boardScopeTickets() {
  // In project-board mode, restrict to the project's entities
  if (state.view === "project") {
    const p = findProject(state.selectedProjectId);
    if (p) return { project: p };
  }
  return { project: null };
}

function renderBoard() {
  const scope = boardScopeTickets();

  COLUMNS.forEach((stage) => {
    const cardsContainer = document.getElementById(`cards-${stage}`);
    const countEl = document.getElementById(`count-${stage}`);
    if (!cardsContainer) return;

    const cards = [];

    if (stage === "done") {
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
      state.items.forEach((item) => {
        if (item.stage === "sdd") cards.push({ entity: item, type: "item" });
      });
      state.designs.forEach((d) => {
        if (d.stage !== "done") cards.push({ entity: d, type: "design" });
      });
    } else if (stage === "planned") {
      state.items.forEach((item) => {
        if (item.stage === "planned")
          cards.push({ entity: item, type: "item" });
      });
      state.plans.forEach((p) => {
        if (p.stage !== "done") cards.push({ entity: p, type: "plan" });
      });
    } else {
      state.items.forEach((item) => {
        if (item.stage === stage) cards.push({ entity: item, type: "item" });
      });
    }

    // Decisions live in the Decisions view
    let filtered = cards.filter((c) => c.type !== "item" || c.entity.type !== "decision");

    // Project scope: project entities + unassigned inbox tickets (draggable into the project)
    if (scope.project) {
      filtered = filtered.filter((c) => {
        const e = c.entity;
        if (e.sprintId === scope.project.id) return true;
        if (stage === "inbox" && !e.sprintId) return true;
        return false;
      });
    }

    filtered = filtered.filter((c) => matchesSearch(c.entity));
    filtered = filtered.filter((c) => c.type !== "item" || matchesKindFilter(c.entity));

    filtered.sort((a, b) => {
      const ta = a.entity.createdAt || "";
      const tb = b.entity.createdAt || "";
      return tb.localeCompare(ta);
    });

    if (countEl) countEl.textContent = filtered.length;

    cardsContainer.innerHTML = filtered
      .map((c) => buildCardHTML(c.entity, c.type))
      .join("");

    cardsContainer.querySelectorAll(".card").forEach((cardEl, i) => {
      cardEl.style.setProperty("--i", i);
    });
  });

  annotateRalphCards();
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

// ─────────────────────────────────────────────────────────── Drag and Drop

function initDragAndDrop() {
  const board = document.getElementById("kanbanBoard");
  if (!board) return;

  board.addEventListener("click", handleCardClick);

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
    board
      .querySelectorAll(".kanban-col.drag-over")
      .forEach((col) => col.classList.remove("drag-over"));
  });

  board.querySelectorAll(".kanban-col").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      col.classList.add("drag-over");
    });

    col.addEventListener("dragleave", (e) => {
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

      let endpoint;
      if (data.type === "item") endpoint = `/api/items/${data.id}`;
      else if (data.type === "design") endpoint = `/api/designs/${data.id}`;
      else if (data.type === "plan") endpoint = `/api/plans/${data.id}`;

      try {
        const patchData = { stage: targetStage };
        // Dragging within a project board assigns unassigned entities to it
        const scope = boardScopeTickets();
        if (scope.project) {
          let entity = null;
          if (data.type === "item") entity = state.items.find((i) => i.id === data.id);
          else if (data.type === "design") entity = state.designs.find((d) => d.id === data.id);
          else if (data.type === "plan") entity = state.plans.find((p) => p.id === data.id);
          if (entity && !entity.sprintId) {
            patchData.sprintId = scope.project.id;
          }
        }

        await apiFetch(endpoint, {
          method: "PATCH",
          body: JSON.stringify(patchData),
        });
        showToast(`Moved to ${targetStage}`);
      } catch (err) {
        /* toasted */
      }

      state.draggedCard = null;
    });
  });
}

// ─────────────────────────────────────────────────────────── Project view (Frontier / Blocked / Resolved)

function projectTicketCardHTML(t, column) {
  const kind = ticketKind(t);
  const color = kindColor(kind);
  const byId = itemsById();
  const kindLabel = kind
    ? `<span class="pcard-kind" style="color:${color}">${kind.toUpperCase()}</span>`
    : "";

  if (column === "frontier") {
    const hitl = HITL_KINDS.has(kind);
    const hint = hitl
      ? `<span class="pcard-hint" style="color:${color}">needs a session</span>`
      : `<span class="pcard-hint">${escText(t.stage)}</span>`;
    return `
      <div class="pcard pcard-frontier" data-id="${escAttr(t.id)}" style="border-color:${color}55">
        <div class="pcard-top">
          <span class="pcard-id" style="color:${color}">${escText(t.id)}</span>
          ${kindLabel}
          <span class="pcard-age">${shortTime(t.updatedAt || t.createdAt)}</span>
        </div>
        <div class="pcard-title">${escText(displayTitle(t))}</div>
        <div class="pcard-foot">
          ${hint}
          <button class="pcard-open" data-id="${escAttr(t.id)}">Open</button>
        </div>
      </div>`;
  }

  if (column === "blocked") {
    const blockers = unresolvedBlockers(t, byId);
    const chips = blockers
      .map((id) => {
        const b = byId.get(id);
        const c = kindColor(ticketKind(b));
        return `<span class="pcard-waitchip" style="color:${c};background:${c}14">${escText(id)}</span>`;
      })
      .join("");
    return `
      <div class="pcard pcard-blocked" data-id="${escAttr(t.id)}">
        <div class="pcard-top">
          <span class="pcard-id" style="color:${color}">${escText(t.id)}</span>
          ${kindLabel}
        </div>
        <div class="pcard-title">${escText(displayTitle(t))}</div>
        <div class="pcard-foot"><span class="pcard-hint">waits on</span>${chips}</div>
      </div>`;
  }

  // resolved
  const lastComment = (t.comments || [])[t.comments?.length - 1];
  const outcome = lastComment
    ? `<div class="pcard-outcome">→ ${escText(lastComment.text.split("\n")[0].slice(0, 110))}</div>`
    : "";
  return `
    <div class="pcard pcard-resolved" data-id="${escAttr(t.id)}">
      <div class="pcard-top">
        <span class="pcard-id" style="color:${color}">${escText(t.id)}</span>
        <span class="pcard-check">✓</span>
      </div>
      <div class="pcard-title">${escText(displayTitle(t))}</div>
      ${outcome}
    </div>`;
}

function renderProjectView() {
  const container = document.getElementById("projectView");
  if (!container) return;
  const p = findProject(state.selectedProjectId);
  if (!p) {
    container.innerHTML = '<div class="view-empty">Project not found — it may have been archived.</div>';
    return;
  }

  let tickets = p.tickets.filter(matchesSearch).filter(matchesKindFilter);
  const { frontier, blocked, resolved } = splitByFrontier(tickets);

  // Pacing hint when several frontier tickets need human judgment
  const hitl = frontier.filter((t) => HITL_KINDS.has(ticketKind(t)));
  const pacingHTML =
    hitl.length >= 2
      ? `<div class="pacing-hint">Pacing: <strong>one judgment ticket per session</strong> — ${hitl
          .map((t) => escText(t.id))
          .join(" and ")} all need you; don't batch them.</div>`
      : "";

  const resolvedShown = resolved.slice(0, 8);
  const resolvedMore = resolved.length - resolvedShown.length;

  // Docs & execution strips — the project's own SDDs and plans (via sprintId).
  // Plans are agent machinery: compact chips, done ones dimmed at the end.
  // Old-structure projects can hold dozens — cap at 4 until expanded.
  const STRIP_CAP = 4;
  const expanded = state.stripsExpanded === p.id;
  const capChips = (arr) => (expanded ? arr : arr.slice(0, STRIP_CAP));
  const moreChip = (arr, kindLabel) =>
    !expanded && arr.length > STRIP_CAP
      ? `<button class="exec-plan exec-more" data-expand-strips="1">+ ${arr.length - STRIP_CAP} more ${kindLabel}</button>`
      : "";
  const projDesigns = state.designs
    .filter((d) => d.sprintId === p.id)
    .sort((a, b) => (a.stage === "done") - (b.stage === "done") || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const docsHTML = projDesigns.length
    ? `<div class="exec-strip">
        <span class="exec-label">Documents</span>
        ${capChips(projDesigns)
          .map(
            (d) => `
            <button class="exec-plan exec-doc${d.stage === "done" ? " exec-done" : ""}" data-sdd-id="${escAttr(d.id)}">
              <span class="exec-id" style="color:#7b83eb">${escText(d.id)}</span>
              <span class="exec-title">${escText(displayTitle(d))}</span>
            </button>`,
          )
          .join("")}
        ${moreChip(projDesigns, "docs")}
      </div>`
    : "";

  const plans = projectPlans(p).sort(
    (a, b) => (a.stage === "done") - (b.stage === "done") || (b.updatedAt || "").localeCompare(a.updatedAt || ""),
  );
  const execHTML = plans.length
    ? `<div class="exec-strip">
        <span class="exec-label">Execution</span>
        ${capChips(plans)
          .map((pl) => {
            const tasks = pl.tasks || [];
            const done = tasks.filter((t) => t.status === "done").length;
            const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
            const ralphLive = state.ralphLoops.some((l) => l.alive && l.planId === pl.id);
            return `
            <button class="exec-plan${pl.stage === "done" ? " exec-done" : ""}" data-plan-id="${escAttr(pl.id)}">
              ${ralphLive ? '<span class="ralph-dot"></span>' : ""}
              <span class="exec-id">${escText(pl.id)}</span>
              <span class="exec-title">${escText(displayTitle(pl))}</span>
              <span class="exec-bar"><span style="width:${pct}%"></span></span>
              <span class="exec-nums">${done}/${tasks.length}</span>
            </button>`;
          })
          .join("")}
        ${moreChip(plans, "plans")}
      </div>`
    : "";

  container.innerHTML = `
    ${docsHTML}
    ${execHTML}
    <div class="pcols">
    <div class="pcol">
      <div class="pcol-header">
        <span class="pcol-dot pcol-dot-frontier"></span>
        <span class="pcol-title">Frontier</span>
        <span class="pcol-count">${frontier.length}</span>
        <span class="pcol-hint">unblocked · unclaimed</span>
      </div>
      <div class="pcol-cards">
        ${frontier.map((t) => projectTicketCardHTML(t, "frontier")).join("") || '<div class="pcol-empty">Nothing on the frontier — resolve a blocker or pull a ticket in.</div>'}
        ${pacingHTML}
      </div>
    </div>
    <div class="pcol">
      <div class="pcol-header">
        <span class="pcol-dot pcol-dot-blocked"></span>
        <span class="pcol-title pcol-title-dim">Blocked</span>
        <span class="pcol-count">${blocked.length}</span>
        <span class="pcol-hint">behind the fog</span>
      </div>
      <div class="pcol-cards">
        ${blocked.map((t) => projectTicketCardHTML(t, "blocked")).join("") || '<div class="pcol-empty">No blocked tickets.</div>'}
      </div>
    </div>
    <div class="pcol pcol-narrow">
      <div class="pcol-header">
        <span class="pcol-dot pcol-dot-resolved"></span>
        <span class="pcol-title pcol-title-dim">Resolved</span>
        <span class="pcol-count">${resolved.length}</span>
      </div>
      <div class="pcol-cards pcol-cards-resolved">
        ${resolvedShown.map((t) => projectTicketCardHTML(t, "resolved")).join("") || '<div class="pcol-empty">Nothing resolved yet.</div>'}
        ${resolvedMore > 0 ? `<div class="pcol-more">+ ${resolvedMore} more</div>` : ""}
      </div>
    </div>
    </div>
  `;

  container.querySelectorAll(".pcard[data-id]").forEach((el) => {
    el.addEventListener("click", () => showDetailOverlay(el.dataset.id));
  });
  container.querySelectorAll(".exec-plan[data-plan-id]").forEach((el) => {
    el.addEventListener("click", () => showPlanDetail(el.dataset.planId));
  });
  container.querySelectorAll(".exec-doc[data-sdd-id]").forEach((el) => {
    el.addEventListener("click", () => showSddDetail(el.dataset.sddId));
  });
  container.querySelectorAll("[data-expand-strips]").forEach((el) => {
    el.addEventListener("click", () => {
      state.stripsExpanded = p.id;
      renderProjectView();
    });
  });
}

function renderProjectStrip() {
  const strip = document.getElementById("projectStrip");
  if (!strip) return;
  const p = findProject(state.selectedProjectId);
  if (!p) {
    strip.classList.add("hidden");
    return;
  }
  strip.classList.remove("hidden");
  const { resolved, total } = projectProgress(p);
  const pct = total > 0 ? Math.round((resolved / total) * 100) : 0;
  strip.innerHTML = `
    <div class="strip-text"><strong>Destination:</strong> ${escText(p.destination || "(no destination set — edit the project)")}</div>
    <div class="strip-progress">
      <div class="strip-bar"><div style="width:${pct}%"></div></div>
      <span class="strip-nums">${resolved}/${total} resolved</span>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────── Inbox view

function renderInboxView() {
  const container = document.getElementById("inboxView");
  if (!container) return;
  const items = state.items
    .filter((i) => isTicket(i) && i.stage === "inbox")
    .filter(matchesSearch)
    .filter(matchesKindFilter)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  if (items.length === 0) {
    container.innerHTML = '<div class="view-empty">Inbox zero.</div>';
    return;
  }

  const byId = itemsById();
  container.innerHTML = `
    <div class="list-pane">
      ${items
        .map((t) => {
          const kind = ticketKind(t);
          const color = kindColor(kind);
          const blockers = unresolvedBlockers(t, byId);
          const lastComment = (t.comments || [])[t.comments?.length - 1];
          const metaBits = [];
          if (kind) metaBits.push(`<span style="color:${color};font-weight:600">${kind}</span>`);
          if (t.priority) metaBits.push(`<span class="lrow-priority">${escText(t.priority).toUpperCase()}</span>`);
          if (blockers.length) metaBits.push(`<span class="lrow-blocked">⊘ ${blockers.map(escText).join(" · ")}</span>`);
          if (lastComment) metaBits.push(`<span class="lrow-comment">${escText(lastComment.author || "")} commented</span>`);
          return `
          <div class="lrow" data-id="${escAttr(t.id)}">
            <span class="lrow-id" style="color:${kind ? color : "#62667a"}">${escText(t.id)}</span>
            <span class="lrow-title">${escText(displayTitle(t))}</span>
            <span class="lrow-meta">${metaBits.join('<span class="lrow-sep">·</span>')}</span>
            <span class="lrow-age">${shortTime(t.createdAt)}</span>
          </div>`;
        })
        .join("")}
    </div>
  `;
  container.querySelectorAll(".lrow[data-id]").forEach((el) => {
    el.addEventListener("click", () => showDetailOverlay(el.dataset.id));
  });
}

// ─────────────────────────────────────────────────────────── Documents view

function renderDocumentsView() {
  const container = document.getElementById("documentsView");
  if (!container) return;

  // Plans are project machinery, not documents — they live on the project home
  // (execution strip) and via ⌘K, never here.
  const designs = state.designs.filter(matchesSearch);

  const designRows = designs
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .map((d) => {
      const linked = d.linkedItems || d.itemIds || [];
      const done = d.stage === "done";
      return `
      <div class="lrow${done ? " lrow-done" : ""}" data-id="${escAttr(d.id)}" data-kind="design">
        <span class="lrow-id" style="color:#7b83eb">${escText(d.id)}</span>
        <span class="lrow-title">${escText(displayTitle(d))}</span>
        <span class="lrow-meta">${linked.length ? `${linked.length} linked` : ""}${done ? '<span class="lrow-sep">·</span>done' : ""}</span>
        <span class="lrow-age">${shortTime(d.updatedAt)}</span>
      </div>`;
    })
    .join("");

  container.innerHTML = `
    <div class="list-pane">
      <div class="list-group-title"><span class="list-group-dot" style="background:#7b83eb"></span>Maps &amp; designs <span class="list-group-count">${designs.length}</span></div>
      ${designRows || '<div class="view-empty-inline">No design documents.</div>'}
    </div>
  `;

  container.querySelectorAll(".lrow[data-id]").forEach((el) => {
    el.addEventListener("click", () => showSddDetail(el.dataset.id));
  });
}

// ─────────────────────────────────────────────────────────── Plans view

function renderPlansView() {
  const container = document.getElementById("plansView");
  if (!container) return;

  const plans = state.plans.filter(matchesSearch);
  if (plans.length === 0) {
    container.innerHTML = '<div class="view-empty">No plans.</div>';
    return;
  }

  const projectName = (sprintId) => {
    const s = state.sprints.find((sp) => sp.id === sprintId);
    return s ? s.name : null;
  };

  const active = plans.filter((p) => p.stage !== "done");
  const done = plans.filter((p) => p.stage === "done");

  const row = (p) => {
    const tasks = p.tasks || [];
    const doneCount = tasks.filter((t) => t.status === "done").length;
    const ralphLive = state.ralphLoops.some((l) => l.alive && l.planId === p.id);
    const proj = projectName(p.sprintId);
    const metaBits = [];
    if (tasks.length) metaBits.push(`${doneCount}/${tasks.length} tasks`);
    if (ralphLive) metaBits.push('<span class="lrow-ralph">ralph live</span>');
    if (proj) metaBits.push(escText(proj));
    return `
    <div class="lrow${p.stage === "done" ? " lrow-done" : ""}" data-id="${escAttr(p.id)}">
      <span class="lrow-id" style="color:#46c288">${escText(p.id)}</span>
      <span class="lrow-title">${escText(displayTitle(p))}</span>
      <span class="lrow-meta">${metaBits.join('<span class="lrow-sep">·</span>')}</span>
      <span class="lrow-age">${shortTime(p.updatedAt)}</span>
    </div>`;
  };

  const sortRows = (arr) =>
    arr.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).map(row).join("");

  container.innerHTML = `
    <div class="list-pane">
      <div class="list-group-title"><span class="list-group-dot" style="background:#46c288"></span>In flight <span class="list-group-count">${active.length}</span></div>
      ${sortRows(active) || '<div class="view-empty-inline">Nothing executing.</div>'}
      ${done.length ? `<div class="list-group-title"><span class="list-group-dot" style="background:#3b3e4d"></span>Done <span class="list-group-count">${done.length}</span></div>${sortRows(done)}` : ""}
    </div>
  `;

  container.querySelectorAll(".lrow[data-id]").forEach((el) => {
    el.addEventListener("click", () => showPlanDetail(el.dataset.id));
  });
}

// ─────────────────────────────────────────────────────────── Decisions reader

function decisionWeekGroups(decisions) {
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const groups = { thisWeek: [], lastWeek: [], older: {} };
  for (const d of decisions) {
    const t = new Date(d.updatedAt || d.createdAt || 0).getTime();
    const age = now - t;
    if (age < week) groups.thisWeek.push(d);
    else if (age < 2 * week) groups.lastWeek.push(d);
    else {
      const dt = new Date(t);
      const key = dt.toLocaleString(undefined, { month: "long", year: "numeric" });
      (groups.older[key] = groups.older[key] || []).push(d);
    }
  }
  return groups;
}

function renderDecisionsView() {
  const container = document.getElementById("decisionsView");
  if (!container) return;

  const searchQuery = state.search.toLowerCase();
  const decisions = state.items
    .filter((item) => {
      if (item.type !== "decision") return false;
      if (!searchQuery) return true;
      const title = (item.title || "").toLowerCase();
      const id = (item.id || "").toLowerCase();
      const body = (item.body || "").toLowerCase();
      return title.includes(searchQuery) || id.includes(searchQuery) || body.includes(searchQuery);
    })
    .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));

  if (decisions.length === 0) {
    container.innerHTML = '<div class="view-empty">No decisions found.</div>';
    return;
  }

  const groups = decisionWeekGroups(decisions);
  const newest = groups.thisWeek[0] || null;

  function featuredHTML(d) {
    const related = (d.related || []).map(
      (r) => `<span class="dd-chip dd-chip-ref" data-id="${escAttr(r)}">${escText(r)}</span>`,
    );
    const commentCount = (d.comments || []).length;
    const bodyPreview = d.body ? mdToHtml(d.body.split("\n\n").slice(0, 2).join("\n\n")) : "";
    return `
      <div class="dd-featured" data-id="${escAttr(d.id)}">
        <div class="dd-featured-head">
          <span class="dd-id">${escText(d.id)}</span>
          <span class="dd-featured-title">${escText(displayTitle(d))}</span>
          <span class="dd-age">${shortTime(d.updatedAt || d.createdAt)}</span>
        </div>
        ${bodyPreview ? `<div class="dd-featured-body">${bodyPreview}</div>` : ""}
        <div class="dd-featured-chips">
          ${related.join("")}
          ${commentCount ? `<span class="dd-chip">${commentCount} refinement${commentCount !== 1 ? "s" : ""} in thread</span>` : ""}
        </div>
      </div>`;
  }

  function rowHTML(d, faded) {
    return `
      <div class="dd-row${faded ? " dd-row-faded" : ""}" data-id="${escAttr(d.id)}">
        <span class="dd-id">${escText(d.id)}</span>
        <span class="dd-row-title">${escText(displayTitle(d))}</span>
        <span class="dd-age">${shortTime(d.updatedAt || d.createdAt)}</span>
      </div>`;
  }

  const parts = ['<div class="dd-reader">'];
  if (groups.thisWeek.length > 0) {
    parts.push('<div class="dd-group-label">This week</div>');
    for (const d of groups.thisWeek) {
      parts.push(d === newest ? featuredHTML(d) : rowHTML(d, false));
    }
  }
  if (groups.lastWeek.length > 0) {
    parts.push('<div class="dd-group-label">Last week</div>');
    for (const d of groups.lastWeek) parts.push(rowHTML(d, false));
  }
  const olderKeys = Object.keys(groups.older);
  for (const key of olderKeys) {
    parts.push(`<div class="dd-group-label dd-group-label-faded">${escText(key)} · fading by design</div>`);
    for (const d of groups.older[key]) parts.push(rowHTML(d, true));
  }
  parts.push("</div>");

  container.innerHTML = parts.join("");

  container.querySelectorAll("[data-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      showDetailOverlay(el.dataset.id);
    });
  });
  wireEntityRefs(container);
}

// ─────────────────────────────────────────────────────────── Archive view

async function renderArchiveView() {
  const container = document.getElementById("archiveView");
  if (!container) return;
  if (state.archived === null) {
    container.innerHTML = '<div class="view-empty">Loading archive…</div>';
    try {
      state.archived = await apiFetch("/api/items/archived");
    } catch {
      state.archived = [];
    }
  }
  const rows = (state.archived || [])
    .filter(matchesSearch)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  if (rows.length === 0) {
    container.innerHTML = '<div class="view-empty">Archive is empty.</div>';
    return;
  }

  container.innerHTML = `
    <div class="list-pane">
      ${rows
        .map((t) => {
          const kind = ticketKind(t);
          return `
        <div class="lrow lrow-done archive-row" data-id="${escAttr(t.id)}">
          <span class="lrow-id" style="color:${kind ? kindColor(kind) : "#4a4e5e"}">${escText(t.id)}</span>
          <span class="lrow-title">${escText(displayTitle(t))}</span>
          <span class="lrow-age">${shortTime(t.updatedAt)}</span>
        </div>
        <div class="archive-body hidden" data-body-for="${escAttr(t.id)}"></div>`;
        })
        .join("")}
    </div>
  `;

  container.querySelectorAll(".archive-row").forEach((el) => {
    el.addEventListener("click", () => {
      const body = container.querySelector(`[data-body-for="${CSS.escape(el.dataset.id)}"]`);
      if (!body) return;
      if (body.classList.contains("hidden")) {
        const entity = (state.archived || []).find((a) => a.id === el.dataset.id);
        body.innerHTML = `<div class="detail-body">${mdToHtml(entity?.body || "(no description)")}</div>`;
        body.classList.remove("hidden");
      } else {
        body.classList.add("hidden");
      }
    });
  });
}

// ─────────────────────────────────────────────────────────── Right rail (needs you + activity)

function authorAvatar(author) {
  const a = (author || "").toLowerCase();
  if (/terje/.test(a) || a === "user") return { initial: "T", cls: "avatar-terje" };
  if (/claude/.test(a)) return { initial: "C", cls: "avatar-claude" };
  if (/ralph|agent/.test(a)) return { initial: "R", cls: "avatar-agent" };
  return { initial: (author || "?").charAt(0).toUpperCase(), cls: "avatar-neutral" };
}

function collectActivity() {
  const events = [];
  const pushComment = (entity, entityKind, c) => {
    if (!c || !c.createdAt) return;
    events.push({
      when: c.createdAt,
      author: c.author || "unknown",
      text: (c.text || "").split("\n")[0].slice(0, 120),
      refId: entity.id,
      refKind: entityKind,
      verb: "commented on",
    });
  };
  for (const i of state.items) (i.comments || []).forEach((c) => pushComment(i, "item", c));
  for (const d of state.designs) (d.comments || []).forEach((c) => pushComment(d, "design", c));
  for (const p of state.plans) {
    (p.comments || []).forEach((c) => pushComment(p, "plan", c));
    for (const t of p.tasks || []) {
      for (const n of t.progressNotes || []) {
        if (!n || !n.timestamp) continue;
        events.push({
          when: n.timestamp,
          author: "agent",
          text: `${t.title ? t.title.split(":")[0] : t.id} — ${(n.text || "").split("\n")[0].slice(0, 110)}`,
          refId: p.id,
          refKind: "plan",
          verb: "progressed",
        });
      }
    }
  }
  // Recently resolved tickets
  for (const i of state.items) {
    if (isTicket(i) && isResolvedStage(i.stage) && i.updatedAt) {
      events.push({
        when: i.updatedAt,
        author: "board",
        text: displayTitle(i).slice(0, 110),
        refId: i.id,
        refKind: "item",
        verb: "resolved",
      });
    }
  }
  events.sort((a, b) => (b.when || "").localeCompare(a.when || ""));
  return events.slice(0, 30);
}

function collectNeedsYou() {
  const needs = [];
  const byId = itemsById();

  // Frontier judgment tickets (grill / probe)
  for (const t of state.items) {
    if (!isTicket(t) || isResolvedStage(t.stage)) continue;
    const kind = ticketKind(t);
    if (!HITL_KINDS.has(kind)) continue;
    if (unresolvedBlockers(t, byId).length > 0) continue;
    needs.push({
      label: `${kind === "grill" ? "Grill" : "Probe"} session on`,
      refId: t.id,
      color: kindColor(kind),
    });
  }

  // Plans waiting on a human gate
  for (const p of state.plans) {
    if (p.stage === "done") continue;
    for (const t of p.tasks || []) {
      if (t.status === "in_progress" && /terje|feel.?gate|play session/i.test(`${t.verification || ""} ${t.title || ""}`)) {
        needs.push({ label: "Feel-gate on", refId: p.id, color: "#46c288" });
        break;
      }
    }
  }

  // Tickets whose last word was the agent's, waiting on a ruling
  for (const t of state.items) {
    if (!isTicket(t) || isResolvedStage(t.stage)) continue;
    const comments = t.comments || [];
    const last = comments[comments.length - 1];
    if (!last) continue;
    const av = authorAvatar(last.author);
    if (av.cls !== "avatar-terje" && /ruling|options for|awaiting|needs terje/i.test(`${t.title} ${last.text || ""}`)) {
      needs.push({ label: "Ruling on", refId: t.id, color: "#e6e7ec" });
    }
  }

  // Dedup by refId, cap 5
  const seen = new Set();
  return needs.filter((n) => (seen.has(n.refId) ? false : (seen.add(n.refId), true))).slice(0, 5);
}

function renderRail() {
  const needsEl = document.getElementById("railNeeds");
  const actEl = document.getElementById("railActivity");
  if (!needsEl || !actEl) return;

  const needs = collectNeedsYou();
  if (needs.length === 0) {
    needsEl.classList.add("hidden");
  } else {
    needsEl.classList.remove("hidden");
    needsEl.innerHTML = `
      <div class="needs-title">Needs you · ${needs.length}</div>
      <div class="needs-list">
        ${needs
          .map(
            (n) =>
              `<div class="needs-row" data-id="${escAttr(n.refId)}">${escText(n.label)} <span class="needs-ref" style="color:${n.color}">${escText(n.refId)}</span></div>`,
          )
          .join("")}
      </div>`;
    needsEl.querySelectorAll(".needs-row").forEach((el) => {
      el.addEventListener("click", () => openEntityById(el.dataset.id));
    });
  }

  const events = collectActivity();
  actEl.innerHTML = events
    .map((ev) => {
      const av = authorAvatar(ev.author);
      const refColor = kindColor(ticketKind(state.items.find((i) => i.id === ev.refId)));
      return `
      <div class="act-row" data-id="${escAttr(ev.refId)}">
        <span class="act-avatar ${av.cls}">${av.initial}</span>
        <div class="act-body">
          <div class="act-line"><strong>${escText(ev.author)}</strong> ${escText(ev.verb)} <span class="act-ref" style="color:${refColor}">${escText(ev.refId)}</span></div>
          <div class="act-text">${escText(ev.text)}</div>
          <div class="act-when">${relativeTime(ev.when)}</div>
        </div>
      </div>`;
    })
    .join("") || '<div class="act-empty">No activity yet.</div>';

  actEl.querySelectorAll(".act-row").forEach((el) => {
    el.addEventListener("click", () => openEntityById(el.dataset.id));
  });
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
  failing: "Failing",
  drifted: "Drifted",
  stale: "Stale",
  guarded: "Guarded",
};

const TESTS_SORT_LABELS = {
  directory: "Directory",
  name: "Name",
  drift: "Drift severity",
  recency: "Last run",
};

const DRIFT_SEVERITY_WEIGHT = { broken: 3, suspect: 2, warn: 1 };

function testCategory(test) {
  const file = test.file || "";
  const parts = file.split("/");
  if (parts.length > 1) return parts.slice(0, -1).join("/");
  return "(root)";
}

function testIsStale(test) {
  if (!test.last_run_at) return true;
  return Date.now() - new Date(test.last_run_at).getTime() > 24 * 60 * 60 * 1000;
}

function testMaxDriftWeight(test) {
  let max = 0;
  for (const d of test.drift || []) {
    const w = DRIFT_SEVERITY_WEIGHT[d.severity] || 1;
    if (w > max) max = w;
  }
  return max;
}

function testMatchesFilter(test, filter) {
  if (filter === "all") return true;
  if (filter === "failing") return test.status === "failing" || test.status === "broken";
  if (filter === "drifted") return (test.drift || []).length > 0;
  if (filter === "stale") return testIsStale(test);
  if (filter === "guarded") return (test.guards || []).length > 0;
  return true;
}

function testMatchesSearch(test, needle) {
  if (!needle) return true;
  const q = needle.toLowerCase();
  return (
    (test.name || "").toLowerCase().includes(q) ||
    (test.file || "").toLowerCase().includes(q) ||
    (test.guards || []).some((g) => g.toLowerCase().includes(q))
  );
}

function sortTests(tests, sort) {
  const copy = [...tests];
  if (sort === "name") {
    copy.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  } else if (sort === "drift") {
    copy.sort((a, b) => testMaxDriftWeight(b) - testMaxDriftWeight(a) || (a.name || "").localeCompare(b.name || ""));
  } else if (sort === "recency") {
    copy.sort((a, b) => (b.last_run_at || "").localeCompare(a.last_run_at || ""));
  } else {
    copy.sort((a, b) => (a.file || "").localeCompare(b.file || "") || (a.name || "").localeCompare(b.name || ""));
  }
  return copy;
}

function computeFilteredTests(cat) {
  const tests = cat.tests || [];
  return sortTests(
    tests.filter((t) => testMatchesFilter(t, state.testsFilter) && testMatchesSearch(t, state.testsSearch)),
    state.testsSort,
  );
}

function renderTestsCountsLine(cat, filtered) {
  const tests = cat.tests || [];
  const failing = tests.filter((t) => testMatchesFilter(t, "failing")).length;
  const drifted = tests.filter((t) => testMatchesFilter(t, "drifted")).length;
  const stale = tests.filter((t) => testMatchesFilter(t, "stale")).length;
  const bits = [`${filtered.length} of ${tests.length} tests`];
  if (failing) bits.push(`${failing} failing`);
  if (drifted) bits.push(`${drifted} drifted`);
  if (stale) bits.push(`${stale} stale`);
  return `<div class="tests-counts">${bits.join(" · ")}</div>`;
}

function renderCategoryChips(cat, filtered) {
  return "";
}

function renderFilterChips() {
  return Object.entries(TESTS_FILTER_LABELS)
    .map(
      ([key, label]) =>
        `<button class="tests-chip${state.testsFilter === key ? " tests-chip-active" : ""}" data-filter="${key}">${label}</button>`,
    )
    .join("");
}

function renderSortSelect() {
  return `<select class="tests-sort" id="testsSortSelect">${Object.entries(TESTS_SORT_LABELS)
    .map(
      ([key, label]) =>
        `<option value="${key}"${state.testsSort === key ? " selected" : ""}>${label}</option>`,
    )
    .join("")}</select>`;
}

function renderTestsGroupsHTML(filtered) {
  if (filtered.length === 0) {
    return '<div class="tests-empty">No tests match the current filter.</div>';
  }
  if (state.testsSort !== "directory") {
    return filtered.map(renderTestRow).join("");
  }
  const groups = new Map();
  for (const t of filtered) {
    const cat = testCategory(t);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(t);
  }
  const parts = [];
  for (const [cat, tests] of groups) {
    parts.push(`<div class="tests-group"><div class="tests-group-title">${escText(cat)} <span class="tests-group-count">${tests.length}</span></div>${tests.map(renderTestRow).join("")}</div>`);
  }
  return parts.join("");
}

function renderTestsHTML(cat) {
  const filtered = computeFilteredTests(cat);
  return `
    <div class="tests-toolbar">
      <input type="search" class="tests-search" id="testsSearchInput" placeholder="Search tests…" value="${escAttr(state.testsSearch)}">
      <div class="tests-chips" id="testsChipRow">${renderFilterChips()}</div>
      ${renderSortSelect()}
    </div>
    ${renderTestsCountsLine(cat, filtered)}
    ${renderCodebaseDriftSection(cat.codebaseDrift)}
    <div class="tests-groups" id="testsGroups">${renderTestsGroupsHTML(filtered)}</div>
  `;
}

function applyTestsFilters() {
  const cat = state.testsCatalogue;
  if (!cat) return;
  const filtered = computeFilteredTests(cat);
  const groups = document.getElementById("testsGroups");
  if (groups) groups.innerHTML = renderTestsGroupsHTML(filtered);
  const counts = document.querySelector(".tests-counts");
  if (counts) counts.outerHTML = renderTestsCountsLine(cat, filtered);
  const chipRow = document.getElementById("testsChipRow");
  if (chipRow) chipRow.innerHTML = renderFilterChips();
}

function bindTestsViewHandlers(container) {
  const searchInput = container.querySelector("#testsSearchInput");
  if (searchInput) {
    const onSearch = debounce(() => {
      state.testsSearch = searchInput.value.trim();
      applyTestsFilters();
    }, 200);
    searchInput.addEventListener("input", onSearch);
  }
  const chipRow = container.querySelector("#testsChipRow");
  if (chipRow) {
    chipRow.addEventListener("click", (e) => {
      const chip = e.target.closest(".tests-chip");
      if (!chip) return;
      state.testsFilter = chip.dataset.filter;
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

// ─────────────────────────────────────────────────────────── Shared comment thread helper

function renderComments(
  comments,
  entityType,
  entityId,
  container,
  onCommentAdded,
) {
  const commentsHTML = (comments || [])
    .map((c) => {
      const av = authorAvatar(c.author);
      return `
      <div class="comment">
        <span class="act-avatar ${av.cls}">${av.initial}</span>
        <div class="comment-main">
          <div class="comment-head">
            <span class="comment-author">${escText(c.author || "Unknown")}</span>
            <span class="comment-time">${relativeTime(c.createdAt)}</span>
          </div>
          <div class="comment-text">${mdToHtml(c.text || "")}</div>
        </div>
      </div>
    `;
    })
    .join("");

  container.innerHTML = `
    <div class="comments-section">
      <div class="comments-title">Thread${comments && comments.length ? ` · ${comments.length}` : ""}</div>
      <div class="comment-list" id="commentList">${commentsHTML || '<div class="comments-empty">No messages yet.</div>'}</div>
      <div class="comment-form">
        <textarea id="commentInput" placeholder="Comment — markdown, drop images…" rows="2"></textarea>
        <button class="btn btn-primary btn-sm" id="addCommentBtn">Send</button>
      </div>
    </div>
  `;

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

  // Cmd+Enter submits
  const input = container.querySelector("#commentInput");
  input?.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      container.querySelector("#addCommentBtn")?.click();
    }
  });
  initImageUpload(input);

  const commentList = container.querySelector("#commentList");
  if (commentList) commentList.scrollTop = commentList.scrollHeight;
  wireEntityRefs(commentList);
}

// ─────────────────────────────────────────────────────────── Prompt generation helpers

async function generateAndShowPrompt(opts, previewEl) {
  previewEl.classList.remove("hidden");
  previewEl.innerHTML =
    '<span style="color:var(--text-3)">Generating...</span>';
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
    <div class="slide-header">
      <span class="slide-id">${escText(sprintId)}</span>
      <span class="slide-typechip" style="color:#7b83eb;background:rgba(123,131,235,.12)">Dossier</span>
      <div class="slide-actions">
        <button class="slide-close" onclick="closeDetailOverlay()">&times;</button>
      </div>
    </div>
    <div class="slide-body"><div style="padding:20px 0;color:var(--text-3)">Generating…</div></div>
  `;
  overlay.classList.remove("hidden");

  try {
    const result = await apiFetch(`/api/sprints/${sprintId}/explore`, {
      method: "POST",
    });
    const dossierText = result.dossier || "(empty dossier)";

    content.innerHTML = `
      <div class="slide-header">
        <span class="slide-id">${escText(sprintId)}</span>
        <span class="slide-typechip" style="color:#7b83eb;background:rgba(123,131,235,.12)">Dossier</span>
        <div class="slide-actions">
          <button class="btn btn-ghost btn-sm" id="dossierCopyBtn">Copy</button>
          <button class="slide-close" id="dossierCloseBtn">&times;</button>
        </div>
      </div>
      <div class="slide-body"><div class="detail-body">${mdToHtml(dossierText)}</div></div>
    `;

    document.getElementById("dossierCopyBtn").addEventListener("click", () => {
      copyToClipboard(dossierText, "Dossier copied!");
    });
    document
      .getElementById("dossierCloseBtn")
      .addEventListener("click", closeDetailOverlay);
    wireEntityRefs(content);
  } catch (err) {
    content.innerHTML = `<div style="padding:40px;color:var(--danger)">Error: ${escText(err.message)}</div>`;
  }
}

// ─────────────────────────────────────────────────────────── Project doc slide-over
// The project's own document: destination + markdown body (decisions log,
// out-of-scope, …) + comment thread. This is what map SDDs used to carry.

function showProjectDoc(sprintId) {
  const sprint = state.sprints.find((s) => s.id === sprintId);
  if (!sprint) return;
  const overlay = document.getElementById("detailOverlay");
  const content = document.getElementById("detailContent");
  if (!overlay || !content) return;

  const p = findProject(sprintId);
  const { resolved, total } = projectProgress(p);

  const destHTML = sprint.problemStatement
    ? `<div class="detail-body"><blockquote><p><strong>Destination:</strong> ${escText(sprint.problemStatement)}</p></blockquote></div>`
    : "";
  const bodyHTML = sprint.body
    ? mdToHtml(sprint.body)
    : '<p style="color:var(--text-3)">No project doc yet — decisions log and out-of-scope live here.</p>';

  content.innerHTML = `
    <div class="slide-header">
      <span class="slide-id" style="color:#7b83eb">${escText(sprint.id)}</span>
      <span class="slide-typechip" style="color:#7b83eb;background:rgba(123,131,235,.12)">Project</span>
      <span class="slide-updated">${resolved}/${total} resolved${sprint.status === "completed" ? " · completed" : ""}</span>
      <div class="slide-actions">
        ${startButtonHTML(sprint, "project")}
        <button class="slide-close" id="detailBack">&times;</button>
      </div>
    </div>
    <div class="slide-body">
      <h1 class="slide-doc-title">${escText(sprint.name || sprint.id)}</h1>
      ${destHTML}
      <div class="detail-body-wrapper">
        <div class="detail-body-toolbar">
          <button class="btn btn-ghost btn-sm" id="editBodyBtn">Edit</button>
        </div>
        <div class="detail-body" id="detailBody">${bodyHTML}</div>
        <div class="detail-body-edit hidden" id="detailBodyEdit">
          <textarea id="detailBodyTextarea" rows="14" placeholder="Markdown — decisions log, out of scope…">${escText(sprint.body || "")}</textarea>
          <div class="detail-body-edit-actions">
            <button class="btn btn-secondary btn-sm" id="cancelBodyBtn">Cancel</button>
            <button class="btn btn-primary btn-sm" id="saveBodyBtn">Save</button>
          </div>
        </div>
      </div>
    </div>
    <div class="slide-thread" id="commentThread"></div>
  `;

  overlay.classList.remove("hidden");
  wireEntityRefs(document.getElementById("detailBody"));

  renderComments(
    sprint.comments || [],
    "sprints",
    sprint.id,
    document.getElementById("commentThread"),
    async () => {
      try {
        const updated = await apiFetch(`/api/sprints/${sprint.id}`);
        upsertInState("sprint", sprint.id, updated);
      } catch { /* fall through */ }
      showProjectDoc(sprint.id);
    },
  );

  wireStartButton(sprint, "project");
  document.getElementById("detailBack").addEventListener("click", () => closeDetailOverlay());

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
    bodyTextarea.value = sprint.body || "";
    bodyEditWrap.classList.add("hidden");
    bodyDisplay.classList.remove("hidden");
    editBodyBtn.classList.remove("hidden");
  });
  document.getElementById("saveBodyBtn").addEventListener("click", async () => {
    try {
      const updated = await apiFetch(`/api/sprints/${sprint.id}`, {
        method: "PATCH",
        body: JSON.stringify({ body: bodyTextarea.value }),
      });
      upsertInState("sprint", sprint.id, updated);
      showToast("Project doc updated");
      showProjectDoc(sprint.id);
    } catch (err) {
      /* toasted */
    }
  });
  initImageUpload(bodyTextarea);
}

// ─────────────────────────────────────────────────────────── Slide-over detail (items)

function showDetailOverlay(itemId) {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;

  const overlay = document.getElementById("detailOverlay");
  const content = document.getElementById("detailContent");
  if (!overlay || !content) return;

  pushRoute(`/item/${itemId}`);

  const kind = ticketKind(item);
  const isDecision = item.type === "decision";
  const chipColor = isDecision ? "#52a9ff" : kind ? kindColor(kind) : "#9b9fad";
  const chipLabel = isDecision ? "Decision" : kind || item.type || "ticket";

  const stageOptions = STAGES_FOR_ITEMS.map(
    (s) =>
      `<option value="${s}"${item.stage === s ? " selected" : ""}>${s}</option>`,
  ).join("");

  const priorityOptions = ["", ...PRIORITIES]
    .map(
      (p) =>
        `<option value="${p}"${(item.priority || "") === p ? " selected" : ""}>${p || "--"}</option>`,
    )
    .join("");

  const bodyHTML = item.body
    ? mdToHtml(item.body)
    : '<p style="color:var(--text-3)">No description</p>';

  const filesHTML =
    (item.affectedFiles || []).length > 0
      ? `<ul class="file-list">${item.affectedFiles.map((f) => `<li>${escText(f)}</li>`).join("")}</ul>`
      : "";

  const byId = itemsById();
  const blockers = Array.isArray(item.blockedBy) ? item.blockedBy : [];
  const blockersHTML = blockers.length
    ? `<div class="slide-chips-row"><span class="slide-chips-label">waits on</span>${blockers
        .map((id) => {
          const b = byId.get(id);
          const c = kindColor(ticketKind(b));
          const done = !b || isResolvedStage(b.stage);
          return `<span class="pcard-waitchip${done ? " waitchip-done" : ""}" style="color:${done ? "#62667a" : c};background:${done ? "transparent" : c + "14"}" data-ref="${escAttr(id)}">${escText(id)}${done ? " ✓" : ""}</span>`;
        })
        .join("")}</div>`
    : "";

  const relatedItems = (item.related || []);
  const relatedHTML = relatedItems.length
    ? `<div class="slide-chips-row"><span class="slide-chips-label">related</span>${relatedItems
        .map((rid) => `<span class="slide-refchip" data-ref="${escAttr(rid)}">${escText(rid)}</span>`)
        .join("")}</div>`
    : "";

  content.innerHTML = `
    <div class="slide-header">
      <span class="slide-id" style="color:${chipColor}">${escText(item.id)}</span>
      <span class="slide-typechip" style="color:${chipColor};background:${chipColor}1f">${escText(chipLabel)}</span>
      <span class="slide-updated">updated ${relativeTime(item.updatedAt)}</span>
      <div class="slide-actions">
        ${startButtonHTML(item, "item")}
        <button class="btn btn-ghost btn-sm" id="generatePromptBtn">/prompt</button>
        <button class="btn btn-ghost btn-sm btn-danger-ghost" id="archiveBtn">Archive</button>
        <button class="slide-close" id="detailBack">&times;</button>
      </div>
    </div>
    <div class="slide-body">
      <div class="detail-title">
        <input type="text" id="detailTitleInput" value="${escAttr(item.title)}" />
      </div>
      <div class="detail-meta">
        <label class="meta-item"><span>Stage</span><select id="detailStageSelect">${stageOptions}</select></label>
        <label class="meta-item"><span>Priority</span><select id="detailPrioritySelect">${priorityOptions}</select></label>
        <label class="meta-item"><span>Project</span><select id="detailSprintSelect">${buildSprintOptions(item.sprintId)}</select></label>
      </div>
      ${blockersHTML}
      ${relatedHTML}
      <div class="detail-body-wrapper">
        <div class="detail-body-toolbar">
          <button class="btn btn-ghost btn-sm" id="editBodyBtn">Edit</button>
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
      ${isDecision ? renderTestsWidget(item.tests) : ""}
      ${filesHTML ? `<div class="detail-section"><div class="detail-section-title">Affected files</div>${filesHTML}</div>` : ""}
      <div class="prompt-preview hidden" id="promptPreview"></div>
    </div>
    <div class="slide-thread" id="commentThread"></div>
  `;

  renderComments(
    item.comments || [],
    "items",
    item.id,
    document.getElementById("commentThread"),
    async () => {
      try {
        const updated = await apiFetch(`/api/items/${item.id}`);
        upsertInState("item", item.id, updated);
      } catch { /* fall through */ }
      showDetailOverlay(item.id);
    },
  );

  overlay.classList.remove("hidden");
  wireEntityRefs(document.getElementById("detailBody"));

  // ── Wire slide-over events

  document
    .getElementById("detailBack")
    .addEventListener("click", () => closeDetailOverlay());

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
        /* toasted */
      }
    }
  });

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

  initImageUpload(bodyTextarea);

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

  document
    .getElementById("detailSprintSelect")
    .addEventListener("change", async (e) => {
      try {
        await apiFetch(`/api/items/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sprintId: e.target.value || null }),
        });
        showToast(e.target.value ? `Moved to ${e.target.value}` : "Removed from project");
      } catch (err) {
        /* toasted */
      }
    });

  content.querySelectorAll("[data-ref]").forEach((el) => {
    el.addEventListener("click", () => openEntityById(el.dataset.ref));
  });

  wireStartButton(item, "item");
  document.getElementById("generatePromptBtn").addEventListener("click", () => {
    generateAndShowPrompt(
      { entityType: "item", entityId: item.id, includeQmd: true },
      document.getElementById("promptPreview"),
    );
  });


  document.getElementById("archiveBtn").addEventListener("click", async () => {
    try {
      await apiFetch("/api/items/archive", {
        method: "POST",
        body: JSON.stringify({ ids: [item.id] }),
      });
      state.archived = null; // invalidate cache
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

// ─────────────────────────────────────────────────────────── SDD slide-over

function showSddDetail(sddId) {
  const sdd = state.designs.find((d) => d.id === sddId);
  if (!sdd) return;

  pushRoute(`/sdd/${sddId}`);
  const overlay = document.getElementById("detailOverlay");
  const content = document.getElementById("detailContent");
  if (!overlay || !content) return;

  const bodyHTML = sdd.body
    ? mdToHtml(sdd.body)
    : '<p style="color:var(--text-3)">No description</p>';

  // Linked tickets rendered as a checklist (map document style)
  const linkedItemIds = sdd.linkedItems || sdd.itemIds || [];
  const byId = itemsById();
  const linkedEntities = linkedItemIds
    .map((lid) => byId.get(lid))
    .filter(Boolean);
  const { frontier } = splitByFrontier(linkedEntities);
  const frontierIds = new Set(frontier.map((t) => t.id));

  const linkedHTML = linkedEntities.length
    ? `<div class="map-tickets">${linkedEntities
        .map((t) => {
          const kind = ticketKind(t);
          const color = kindColor(kind);
          const done = isResolvedStage(t.stage);
          const onFrontier = frontierIds.has(t.id);
          const blockers = unresolvedBlockers(t, byId);
          const statusIcon = done
            ? '<span class="mt-check">✓</span>'
            : onFrontier
              ? `<span class="mt-ring" style="border-color:${color}"></span>`
              : '<span class="mt-ring mt-ring-fog"></span>';
          const tail = done
            ? ""
            : onFrontier
              ? `<span class="mt-frontier" style="color:${color}">FRONTIER</span>`
              : blockers.length
                ? `<span class="mt-waits">⊘ ${blockers.map((b) => escText(b.replace(/^[A-Z]+-/, ""))).join(" · ")}</span>`
                : "";
          return `
          <div class="mt-row${done ? " mt-done" : ""}${onFrontier ? " mt-hot" : ""}" data-ref="${escAttr(t.id)}"${onFrontier ? ` style="background:${color}0a"` : ""}>
            ${statusIcon}
            <span class="mt-id" style="color:${color}">${escText(t.id)}</span>
            <span class="mt-title">${escText(displayTitle(t))}</span>
            ${tail}
          </div>`;
        })
        .join("")}</div>`
    : '<span style="color:var(--text-3)">No linked tickets</span>';

  const resolvedCount = linkedEntities.filter((t) => isResolvedStage(t.stage)).length;

  content.innerHTML = `
    <div class="slide-header">
      <span class="slide-id" style="color:#7b83eb">${escText(sdd.id)}</span>
      <span class="slide-typechip" style="color:#7b83eb;background:rgba(123,131,235,.12)">Map</span>
      <span class="slide-updated">updated ${relativeTime(sdd.updatedAt)}</span>
      <div class="slide-actions">
        ${startButtonHTML(sdd, "design")}
        <button class="btn btn-ghost btn-sm" id="generatePromptBtn">/prompt</button>
        ${sdd.body ? '<button class="btn btn-ghost btn-sm" id="graduateDdBtn">Graduate → DD</button>' : ""}
        <button class="slide-close" id="detailBack">&times;</button>
      </div>
    </div>
    <div class="slide-body">
      <div class="detail-title">
        <input type="text" id="detailTitleInput" value="${escAttr(sdd.title || sdd.name || "")}" />
      </div>
      <div class="detail-meta">
        <label class="meta-item"><span>Project</span><select id="detailSprintSelect">${buildSprintOptions(sdd.sprintId)}</select></label>
      </div>
      ${linkedEntities.length ? `
      <div class="map-section-head">
        <span class="map-section-dot" style="background:#f0883e"></span>
        <span class="map-section-title">Tickets</span>
        <span class="map-section-count">${linkedEntities.length} · ${resolvedCount} resolved</span>
      </div>
      ${linkedHTML}` : ""}
      <div class="detail-body">${bodyHTML}</div>
      ${renderTestsWidget(sdd.tests)}
      <div class="prompt-preview hidden" id="promptPreview"></div>
    </div>
    <div class="slide-thread" id="commentThread"></div>
  `;

  overlay.classList.remove("hidden");
  wireEntityRefs(content.querySelector(".detail-body"));

  renderComments(
    sdd.comments || [],
    "designs",
    sdd.id,
    document.getElementById("commentThread"),
    async () => {
      try {
        const updated = await apiFetch(`/api/designs/${sdd.id}`);
        upsertInState("design", sdd.id, updated);
      } catch { /* fall through */ }
      showSddDetail(sdd.id);
    },
  );

  document
    .getElementById("detailBack")
    .addEventListener("click", () => closeDetailOverlay());

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

  document
    .getElementById("detailSprintSelect")
    .addEventListener("change", async (e) => {
      try {
        await apiFetch(`/api/designs/${sdd.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sprintId: e.target.value || null }),
        });
        showToast(e.target.value ? `Moved to ${e.target.value}` : "Removed from project");
      } catch (err) {
        /* toasted */
      }
    });

  content.querySelectorAll(".mt-row[data-ref]").forEach((el) => {
    el.addEventListener("click", () => showDetailOverlay(el.dataset.ref));
  });

  wireStartButton(sdd, "design");
  document.getElementById("generatePromptBtn").addEventListener("click", () => {
    generateAndShowPrompt(
      { entityType: "sdd", entityId: sdd.id, includeQmd: true },
      document.getElementById("promptPreview"),
    );
  });




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

// ─────────────────────────────────────────────────────────── Plan slide-over

async function showPlanDetail(planId) {
  const plan = state.plans.find((p) => p.id === planId);
  if (!plan) return;

  pushRoute(`/plan/${planId}`);
  const overlay = document.getElementById("detailOverlay");
  const content = document.getElementById("detailContent");
  if (!overlay || !content) return;

  let ralphStatus = null;
  try {
    const loops = await fetchRalphLoops();
    ralphStatus = loops.find((l) => l.planId === planId) || null;
  } catch { /* ralph API unavailable */ }

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
      const ddText = Array.isArray(ctx.designDecisions) ? ctx.designDecisions.map((d) => `- ${d}`).join("\n") : ctx.designDecisions;
      parts.push(
        `<div class="context-block"><strong>Design Decisions:</strong><div>${mdToHtml(ddText)}</div></div>`,
      );
    }
    contextHTML = `
      <details class="detail-section plan-context">
        <summary class="detail-section-title">Context</summary>
        ${parts.join("")}
      </details>
    `;
  }

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
                ? `<span class="task-blocked">⊘ ${blockedBy.map((b) => escText(b)).join(", ")}</span>`
                : "";

            const stepsHTML =
              (task.steps || []).length > 0
                ? `<ol class="task-steps">${task.steps.map((s) => `<li>${escText(s)}</li>`).join("")}</ol>`
                : "";
            const verificationHTML = task.verification
              ? `<div class="task-verification"><strong>Verification:</strong> ${escText(task.verification)}</div>`
              : "";
            const progressHTML =
              (task.progressNotes || []).length > 0
                ? `<div class="task-progress-notes"><strong>Progress:</strong><ul>${task.progressNotes.map((n) => `<li>${escText(typeof n === "string" ? n : n.text || "")}${n.timestamp ? ` <span style="color:var(--text-3);font-size:11px">${new Date(n.timestamp).toLocaleString()}</span>` : ""}</li>`).join("")}</ul></div>`
                : "";

            return `
          <div class="task-item" data-task-idx="${idx}" data-task-id="${escAttr(task.id || "")}">
            <div class="task-header">
              <input type="checkbox" class="task-checkbox" data-task-idx="${idx}" ${checkedAttr} />
              <span class="task-title">${escText(task.title || `Task ${idx + 1}`)}</span>
              <span class="task-status ${statusClass}">${escText(task.status || "pending")}</span>
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
      : '<span style="color:var(--text-3)">No tasks</span>';

  const doneCount = tasks.filter((t) => t.status === "done").length;
  const ralphHTML = ralphStatus && ralphStatus.alive
    ? `<span class="ralph-live"><span class="ralph-dot"></span>Ralph live${ralphStatus.iteration ? ` · iter ${ralphStatus.iteration}` : ""}${ralphStatus.stopping ? " · stopping…" : ""}</span>
       <button class="btn btn-ghost btn-sm btn-danger-ghost" id="ralphStopBtn" ${ralphStatus.stopping ? "disabled" : ""}>${ralphStatus.stopping ? "Stopping…" : "Stop"}</button>`
    : ralphStatus && !ralphStatus.alive && ralphStatus.pid !== null
      ? `<span class="ralph-idle">worktree: ralph/${escText(plan.id)}</span>`
      : "";

  content.innerHTML = `
    <div class="slide-header">
      <span class="slide-id" style="color:#46c288">${escText(plan.id)}</span>
      <span class="slide-typechip" style="color:#46c288;background:rgba(70,194,136,.12)">Plan</span>
      <span class="slide-updated">updated ${relativeTime(plan.updatedAt)}</span>
      ${ralphHTML}
      <div class="slide-actions">
        ${startButtonHTML(plan, "plan")}
        <button class="btn btn-ghost btn-sm" id="generatePromptBtn">/prompt</button>
        <button class="slide-close" id="detailBack">&times;</button>
      </div>
    </div>
    <div class="slide-body">
      <h1 class="slide-doc-title">${escText(displayTitle(plan))}</h1>
      <div class="detail-meta">
        <label class="meta-item"><span>Project</span><select id="detailSprintSelect">${buildSprintOptions(plan.sprintId)}</select></label>
      </div>
      ${contextHTML}
      <div class="detail-section">
        <div class="detail-section-title">Tasks (${doneCount}/${tasks.length})</div>
        <div class="task-list" id="planTaskList">${taskListHTML}</div>
      </div>
      <div class="prompt-preview hidden" id="promptPreview"></div>
    </div>
    <div class="slide-thread" id="commentThread"></div>
  `;

  overlay.classList.remove("hidden");

  renderComments(
    plan.comments || [],
    "plans",
    plan.id,
    document.getElementById("commentThread"),
    async () => {
      try {
        const updated = await apiFetch(`/api/plans/${plan.id}`);
        upsertInState("plan", plan.id, updated);
      } catch { /* fall through */ }
      showPlanDetail(plan.id);
    },
  );

  document
    .getElementById("detailBack")
    .addEventListener("click", () => closeDetailOverlay());

  document
    .getElementById("detailSprintSelect")
    .addEventListener("change", async (e) => {
      try {
        await apiFetch(`/api/plans/${plan.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sprintId: e.target.value || null }),
        });
        showToast(e.target.value ? `Moved to ${e.target.value}` : "Removed from project");
      } catch (err) {
        /* toasted */
      }
    });

  content.querySelectorAll(".task-item").forEach((taskEl) => {
    const header = taskEl.querySelector(".task-header");
    const details = taskEl.querySelector(".task-details");
    header.addEventListener("click", (e) => {
      if (e.target.classList.contains("task-checkbox")) return;
      details.classList.toggle("hidden");
    });
  });

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

  wireStartButton(plan, "plan");
  document.getElementById("generatePromptBtn").addEventListener("click", () => {
    generateAndShowPrompt(
      { entityType: "plan", entityId: plan.id, includeQmd: true },
      document.getElementById("promptPreview"),
    );
  });



  const ralphStopBtn = document.getElementById("ralphStopBtn");
  if (ralphStopBtn) {
    ralphStopBtn.addEventListener("click", async () => {
      try {
        await apiFetch(`/api/ralph/${plan.id}/stop`, { method: "POST" });
        showToast("Stop signal sent to Ralph");
        ralphStopBtn.disabled = true;
        ralphStopBtn.textContent = "Stopping…";
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
  state._newItemStage = stage || "inbox";
  const pillarSelect = document.getElementById("fieldPillar");
  if (pillarSelect) {
    const pillars = allUniquePillars();
    pillarSelect.innerHTML =
      '<option value="">--</option>' +
      pillars
        .map((p) => `<option value="${escAttr(p)}">${escText(p)}</option>`)
        .join("");
  }
  form?.querySelector('[name="title"]')?.focus();
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

// ─────────────────────────────────────────────── Quick-open palette (Cmd+K)

let qoResults = [];
let qoIndex = 0;

/** All openable entities, ignoring filters. */
function quickOpenCandidates() {
  const out = [];
  for (const i of state.items)
    out.push({ id: i.id, title: displayTitle(i), kind: "item", label: ticketKind(i) || i.type || "item" });
  for (const d of state.designs)
    out.push({ id: d.id, title: d.title || "", kind: "sdd", label: "map" });
  for (const p of state.plans)
    out.push({ id: p.id, title: p.title || p.name || "", kind: "plan", label: "plan" });
  for (const s of state.sprints)
    out.push({ id: s.id, title: s.name || "", kind: "sprint", label: "project" });
  return out;
}

function quickOpenFilter(query) {
  const cands = quickOpenCandidates();
  if (!query) return cands.slice(0, 20);
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const qn = norm(query);
  const ql = query.toLowerCase();
  const scored = [];
  for (const c of cands) {
    const idn = norm(c.id);
    const title = c.title.toLowerCase();
    let score = -1;
    if (qn && idn === qn) score = 0;
    else if (qn && idn.startsWith(qn)) score = 1;
    else if (qn && idn.includes(qn)) score = 2;
    else if (title.startsWith(ql)) score = 3;
    else if (title.includes(ql)) score = 4;
    if (score >= 0) scored.push({ c, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.c.id.localeCompare(b.c.id, undefined, { numeric: true }),
  );
  return scored.slice(0, 20).map((s) => s.c);
}

function renderQuickOpenResults() {
  const box = document.getElementById("quickOpenResults");
  const input = document.getElementById("quickOpenInput");
  if (!box || !input) return;
  qoResults = quickOpenFilter(input.value.trim());
  if (qoIndex >= qoResults.length) qoIndex = 0;
  if (qoResults.length === 0) {
    box.innerHTML = `<div class="quick-open-empty">No matches</div>`;
    return;
  }
  box.innerHTML = qoResults
    .map(
      (c, i) => `
      <div class="quick-open-row${i === qoIndex ? " selected" : ""}" data-index="${i}">
        <span class="quick-open-id">${escText(c.id)}</span>
        <span class="quick-open-title">${escText(c.title)}</span>
        <span class="quick-open-kind">${escText(c.label)}</span>
      </div>`,
    )
    .join("");
}

function updateQuickOpenSelection() {
  const box = document.getElementById("quickOpenResults");
  if (!box) return;
  box.querySelectorAll(".quick-open-row").forEach((row) => {
    const selected = Number(row.dataset.index) === qoIndex;
    row.classList.toggle("selected", selected);
    if (selected) row.scrollIntoView({ block: "nearest" });
  });
}

function openQuickOpen() {
  const backdrop = document.getElementById("quickOpenBackdrop");
  const input = document.getElementById("quickOpenInput");
  if (!backdrop || !input) return;
  backdrop.classList.remove("hidden");
  input.value = "";
  qoIndex = 0;
  renderQuickOpenResults();
  input.focus();
}

function closeQuickOpen() {
  document.getElementById("quickOpenBackdrop")?.classList.add("hidden");
}

function quickOpenEntity(c) {
  closeQuickOpen();
  if (c.kind === "sdd") showSddDetail(c.id);
  else if (c.kind === "plan") showPlanDetail(c.id);
  else if (c.kind === "sprint") {
    state.projectMode = "map";
    setView("project", { projectId: c.id });
  } else showDetailOverlay(c.id);
}

// ─────────────────────────────────────────────────────────── Event wiring

function initEvents() {
  // Sidebar search button → quick open
  document.getElementById("sidebarSearchBtn")?.addEventListener("click", openQuickOpen);

  // New project (sprint) button
  document.getElementById("newProjectBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openSprintModal();
  });

  // New item modal
  document
    .getElementById("modalClose")
    ?.addEventListener("click", closeNewItemModal);
  document
    .getElementById("modalCancel")
    ?.addEventListener("click", closeNewItemModal);

  document.getElementById("modalBackdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeNewItemModal();
  });

  document
    .getElementById("newItemForm")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      Object.keys(data).forEach((k) => {
        if (!data[k]) delete data[k];
      });
      // Kind becomes a [kind] title prefix
      if (data.kind) {
        data.title = `[${data.kind}] ${data.title || ""}`.trim();
        delete data.kind;
      }
      data.stage = state._newItemStage || "inbox";
      // Assign to the open sprint-project
      if (state.view === "project") {
        const p = findProject(state.selectedProjectId);
        if (p) data.sprintId = p.id;
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

  initImageUpload(document.querySelector('#newItemForm textarea[name="body"]'));

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
          state.projectMode = "map";
          setView("project", { projectId: created.id });
        }
        showToast("Project started");
      } catch (err) {
        /* toasted */
      }
    });

  // Click backdrop to close detail slide-over
  document.getElementById("detailOverlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeDetailOverlay();
  });

  // Quick-open palette: Cmd+K / Ctrl+K
  document.addEventListener("keydown", (e) => {
    if (
      (e.metaKey || e.ctrlKey) &&
      !e.shiftKey &&
      !e.altKey &&
      e.key.toLowerCase() === "k"
    ) {
      e.preventDefault();
      openQuickOpen();
    }
  });

  const qoInput = document.getElementById("quickOpenInput");
  qoInput?.addEventListener("input", () => {
    qoIndex = 0;
    renderQuickOpenResults();
  });
  qoInput?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      qoIndex = Math.min(qoIndex + 1, qoResults.length - 1);
      updateQuickOpenSelection();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      qoIndex = Math.max(qoIndex - 1, 0);
      updateQuickOpenSelection();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = qoResults[qoIndex];
      if (c) quickOpenEntity(c);
    }
  });
  document.getElementById("quickOpenResults")?.addEventListener("click", (e) => {
    const row = e.target.closest(".quick-open-row");
    if (!row) return;
    const c = qoResults[Number(row.dataset.index)];
    if (c) quickOpenEntity(c);
  });
  document
    .getElementById("quickOpenBackdrop")
    ?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeQuickOpen();
    });

  // Escape to close overlays/modals
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const quickOpen = document.getElementById("quickOpenBackdrop");
      if (quickOpen && !quickOpen.classList.contains("hidden")) {
        closeQuickOpen();
        return;
      }
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
        <span class="col-dot col-dot-${stage}"></span>
        <span class="col-title">${label}</span>
        <span class="col-count" id="count-${stage}">0</span>
        <div class="col-header-right">
          ${!isLast ? `<button class="col-add-btn" data-stage="${stage}" title="New ticket in ${label}">+</button>` : ""}
        </div>
      </div>
      <div class="col-cards" id="cards-${stage}"></div>`;
    board.appendChild(col);
  }
  board.querySelectorAll(".col-add-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openNewItemModal(btn.dataset.stage);
    });
  });
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
  try {
    pmConfig = await apiFetch("/api/config");
    document.getElementById("projectTitle").textContent = pmConfig.name;
    document.title = pmConfig.name + " PM";
    COLUMNS = pmConfig.stages || COLUMNS;
    STAGES_FOR_ITEMS = COLUMNS;
    buildKanbanColumns(COLUMNS);
    buildItemTypeSelect(pmConfig.entityTypes);
  } catch (err) {
    console.warn("Config load failed, using defaults:", err.message);
    buildKanbanColumns(COLUMNS);
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
  const rerender = debounce(() => {
    renderActiveContent();
    renderSidebar();
    renderRail();
    if (state.view === "project") renderProjectStrip();
  }, 100);
  es.onmessage = async (e) => {
    const { entity, id, action } = JSON.parse(e.data);
    if (action === "delete" || action === "archive") {
      removeFromState(entity, id);
      if (action === "archive") state.archived = null;
    } else {
      try {
        const updated = await apiFetch(`/api/${entity}s/${id}`);
        upsertInState(entity, id, updated);
      } catch {
        return;
      }
    }
    rerender();
    // Refresh open plan slide-over if the updated entity is the displayed plan
    if (entity === "plan") {
      const overlay = document.getElementById("detailOverlay");
      if (overlay && !overlay.classList.contains("hidden")) {
        const displayedId = overlay.querySelector(".slide-id")?.textContent;
        if (displayedId && displayedId.includes(id)) {
          showPlanDetail(id);
        }
      }
    }
  };
  es.onerror = async () => {
    if (!sseConnected) return;
    sseConnected = false;
    try {
      await loadAll();
      rerender();
    } catch {
      /* retry via EventSource auto-reconnect */
    }
  };

  // Ralph status polling
  async function pollRalphStatus() {
    state.ralphLoops = await fetchRalphLoops();
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
        card.querySelector('.card-top')?.prepend(dot);
      }
    } else {
      card.querySelector('.ralph-card-dot')?.remove();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
