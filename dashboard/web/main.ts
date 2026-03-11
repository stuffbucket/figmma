interface LogMessage {
  timestamp: string;
  level: string;
  category: string;
  summary: string;
  detail?: unknown;
}

const logContainer = document.getElementById("log-container")!;
const statusEl = document.getElementById("status")!;
const clearBtn = document.getElementById("clear-btn")!;
const userProfileEl = document.getElementById("user-profile")!;
const userAvatarEl = document.getElementById("user-avatar") as HTMLImageElement;
const userNameEl = document.getElementById("user-name")!;
const userEmailEl = document.getElementById("user-email")!;

// Setup overlay elements
const setupOverlay = document.getElementById("setup-overlay")!;
const tokenInput = document.getElementById("token-input") as HTMLInputElement;
const tokenToggle = document.getElementById("token-toggle")!;
const tokenSubmit = document.getElementById("token-submit")!;
const tokenFeedback = document.getElementById("token-feedback")!;
const tokenBadge = document.getElementById("token-status-badge")!;
const teamInput = document.getElementById("team-input") as HTMLInputElement;
const teamSubmit = document.getElementById("team-submit")!;
const teamFeedback = document.getElementById("team-feedback")!;
const teamBadge = document.getElementById("team-status-badge")!;
const setupDone = document.getElementById("setup-done")!;
const setupConfigPath = document.getElementById("setup-config-path")!;
const configInfoTokenEl = document.getElementById("token-status")!;
const configInfoOrgEl = document.getElementById("org-display")!;
const configInfoTeamEl = document.getElementById("team-display")!;
const settingsBtn = document.getElementById("settings-btn")!;
const setupCloseBtn = document.getElementById("setup-close")!;

let activeFilter = "all";
let autoScroll = true;
let seqNum = 0;
let activeView: "log" | "chat" = "log";

// ---- Chat view elements ----
const chatView = document.getElementById("chat-view")!;
const chatContainer = document.getElementById("chat-container")!;
const chatScroll = document.getElementById("chat-scroll")!;
const chatTypingEl = document.getElementById("chat-typing")!;
const chatParticipantsEl = document.getElementById("chat-participants")!;
const logHeader = document.getElementById("log-header")!;

// ---- Filters ----
document.querySelectorAll<HTMLButtonElement>(".filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelector(".filter.active")?.classList.remove("active");
    btn.classList.add("active");
    activeFilter = btn.dataset.level ?? "all";
    applyFilter();
  });
});

function applyFilter(): void {
  document.querySelectorAll<HTMLElement>(".log-entry").forEach((el) => {
    if (activeFilter === "all" || el.dataset.level === activeFilter) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
}

// ---- Clear ----
clearBtn.addEventListener("click", () => {
  logContainer.innerHTML = "";
  seqNum = 0;
  showEmptyState();
  // Also clear chat view
  chatContainer.innerHTML =
    '<div class="chat-empty"><div class="chat-empty-icon">💬</div><div>Waiting for messages…</div></div>';
  lastChatSender = "";
  lastChatTimestamp = "";
  seenParticipants.clear();
  chatParticipantsEl.innerHTML = "";
});

// ---- Column resize ----
const rootStyle = document.documentElement.style;
document.querySelectorAll<HTMLElement>(".col-resize").forEach((handle) => {
  const cell = handle.parentElement!;
  const colIndex = cell.dataset.col!;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    handle.classList.add("dragging");
    const startX = e.clientX;
    const startWidth = cell.getBoundingClientRect().width;

    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(30, startWidth + delta);
      rootStyle.setProperty(`--col${colIndex}`, `${newWidth}px`);
    }

    function onUp() {
      handle.classList.remove("dragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
});

// ---- Auto-scroll detection ----
logContainer.addEventListener("scroll", () => {
  const { scrollTop, scrollHeight, clientHeight } = logContainer;
  autoScroll = scrollHeight - scrollTop - clientHeight < 40;
});

// ---- Empty state ----
function showEmptyState(): void {
  if (logContainer.querySelector(".empty-state")) return;
  logContainer.innerHTML = `
    <div class="empty-state">
      <div class="icon">📡</div>
      <div>Waiting for MCP activity…</div>
    </div>`;
}

function removeEmptyState(): void {
  logContainer.querySelector(".empty-state")?.remove();
}

// ---- User profile display ----
interface FigmaUserProfile {
  id: string;
  handle: string;
  email?: string;
  img_url?: string;
}

function showUserProfile(user: FigmaUserProfile): void {
  userNameEl.textContent = user.handle;
  userEmailEl.textContent = user.email ?? `ID: ${user.id}`;
  if (user.img_url) {
    userAvatarEl.src = user.img_url;
    userAvatarEl.alt = user.handle;
  } else {
    // Generate initials fallback
    userAvatarEl.style.display = "none";
  }
  userProfileEl.classList.remove("hidden");
}

function isUserProfileMessage(msg: LogMessage): msg is LogMessage & { detail: FigmaUserProfile } {
  return (
    msg.category === "user-profile" &&
    msg.detail != null &&
    typeof msg.detail === "object" &&
    "handle" in (msg.detail as Record<string, unknown>)
  );
}

// ---- Render a log entry ----
function renderEntry(msg: LogMessage): void {
  removeEmptyState();

  const row = document.createElement("div");
  row.className = "log-entry";
  row.dataset.level = msg.level;

  if (activeFilter !== "all" && msg.level !== activeFilter) {
    row.classList.add("hidden");
  }

  const seq = ++seqNum;

  // Apply REPL run banding class if a REPL run is active
  if (replRunActive) {
    row.classList.add(replRunBand % 2 === 0 ? "repl-band-even" : "repl-band-odd");
  }

  row.innerHTML = `
    <span class="log-time">${seq}</span>
    <span class="log-level ${msg.level}">${msg.level}</span>
    <span class="log-category" title="${escapeHtml(msg.category)}">${escapeHtml(msg.category)}</span>
    <span class="log-summary">${escapeHtml(msg.summary).replace(/ \u2014 /g, "\u00a0\u2014<wbr> ")}</span>
    ${msg.detail != null ? `<div class="log-detail">${escapeHtml(typeof msg.detail === "string" ? msg.detail : JSON.stringify(msg.detail, null, 2))}</div>` : ""}
  `;

  if (msg.detail != null) {
    row.style.cursor = "pointer";
    row.addEventListener("click", () => {
      // Don't toggle if the user is selecting text
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;
      row.classList.toggle("expanded");
    });
  }

  logContainer.prepend(row);
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- WebSocket connection to dashboard ----
function connect(): void {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  // Connect to the dashboard relay on port 5183, /ui path
  const ws = new WebSocket(`${protocol}//127.0.0.1:5183/ui`);

  ws.addEventListener("open", () => {
    statusEl.textContent = "connected";
    statusEl.className = "status connected";
    userProfileEl.classList.remove("dimmed");
  });

  ws.addEventListener("close", () => {
    statusEl.textContent = "disconnected";
    statusEl.className = "status disconnected";
    userProfileEl.classList.add("dimmed");
    // Reconnect after a short delay
    setTimeout(connect, 2000);
  });

  ws.addEventListener("error", () => {
    ws.close();
  });

  ws.addEventListener("message", (event) => {
    try {
      const msg: LogMessage = JSON.parse(event.data as string);
      if (isUserProfileMessage(msg)) {
        showUserProfile(msg.detail);
      }
      renderEntry(msg);

      // Also render in chat view (always, so switching doesn't lose messages)
      showTypingIndicator();
      // Small delay to simulate "typing → delivered" feel
      setTimeout(() => renderChatBubble(msg), 150);
    } catch {
      // Ignore malformed messages
    }
  });
}

// ---- Setup panel ----
const API_BASE = "http://127.0.0.1:5183";
let tokenOk = false;
let teamOk = false;

const tokenCard = document.getElementById("setup-token-card")!;
const teamCard = document.getElementById("setup-team-card")!;

function collapseCard(card: HTMLElement): void {
  card.classList.add("configured");
}

function updateSetupDone(): void {
  // Only the token is required — team ID is optional
  if (tokenOk) {
    setupDone.classList.remove("hidden");
  }
}

function setFeedback(el: HTMLElement, msg: string, type: "success" | "error" | "loading"): void {
  el.textContent = msg;
  el.className = `setup-feedback ${type}`;
}

async function checkConfigStatus(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/config/status`);
    const data = await res.json();
    if (data.configPath) {
      setupConfigPath.textContent = `Config: ${data.configPath}`;
    }
    if (data.hasToken) {
      tokenOk = true;
      tokenBadge.textContent = "saved";
      tokenBadge.className = "badge badge-ok";
      setFeedback(tokenFeedback, `Token configured (${data.tokenPreview})`, "success");
      collapseCard(tokenCard);
    }
    if (data.hasTeamId) {
      teamOk = true;
      teamBadge.textContent = "saved";
      teamBadge.className = "badge badge-ok";
      setFeedback(teamFeedback, `Team ID: ${data.teamId}`, "success");
      collapseCard(teamCard);
    }
    if (tokenOk && teamOk) {
      // Both configured — skip setup entirely
      return;
    }
    if (tokenOk) {
      // Token is set but no team — show overlay only for team
      // (team is optional, so also show the done button)
      setupDone.classList.remove("hidden");
    }
    setupOverlay.classList.remove("hidden");
    updateSetupDone();
  } catch {
    // Dashboard server not reachable — skip setup, show log view
  }
}

tokenToggle.addEventListener("click", () => {
  tokenInput.type = tokenInput.type === "password" ? "text" : "password";
});

tokenSubmit.addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  if (!token) return;
  tokenSubmit.setAttribute("disabled", "");
  setFeedback(tokenFeedback, "Validating with Figma…", "loading");
  try {
    const res = await fetch(`${API_BASE}/api/config/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback(tokenFeedback, data.error ?? "Validation failed", "error");
      tokenBadge.textContent = "invalid";
      tokenBadge.className = "badge badge-error";
      return;
    }
    tokenOk = true;
    tokenBadge.textContent = "valid";
    tokenBadge.className = "badge badge-ok";
    setFeedback(tokenFeedback, `Authenticated as ${data.user?.handle ?? "unknown"}`, "success");
    tokenInput.value = "";
    collapseCard(tokenCard);
    updateSetupDone();
    refreshConfigInfo();
  } catch (err) {
    setFeedback(
      tokenFeedback,
      `Network error: ${err instanceof Error ? err.message : err}`,
      "error",
    );
  } finally {
    tokenSubmit.removeAttribute("disabled");
  }
});

teamSubmit.addEventListener("click", async () => {
  const input = teamInput.value.trim();
  if (!input) return;
  teamSubmit.setAttribute("disabled", "");
  setFeedback(teamFeedback, "Saving…", "loading");

  // Determine if it's a URL or raw ID
  const isUrl = input.includes("figma.com");
  const body = isUrl ? { team_url: input } : { team_id: input };

  try {
    const res = await fetch(`${API_BASE}/api/config/team`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      // Even on error, the org may have been saved
      const orgNote = data.orgId ? ` (org ${data.orgId} saved)` : "";
      setFeedback(teamFeedback, (data.error ?? "Validation failed") + orgNote, "error");
      teamBadge.textContent = "invalid";
      teamBadge.className = "badge badge-error";
      refreshConfigInfo();
      return;
    }
    teamOk = true;
    const projectCount = data.projects?.length;
    const orgNote = data.orgId ? `, org ${data.orgId}` : "";
    if (data.validated) {
      teamBadge.textContent = "valid";
      teamBadge.className = "badge badge-ok";
      setFeedback(
        teamFeedback,
        `Team ${data.teamId}${orgNote} — ${projectCount} project(s) found`,
        "success",
      );
    } else {
      teamBadge.textContent = "saved";
      teamBadge.className = "badge badge-pending";
      const warn = data.warning ? ` (${data.warning})` : "";
      setFeedback(
        teamFeedback,
        `Team ${data.teamId}${orgNote} saved — could not validate${warn}`,
        "error",
      );
    }
    collapseCard(teamCard);
    updateSetupDone();
    refreshConfigInfo();
  } catch (err) {
    setFeedback(
      teamFeedback,
      `Network error: ${err instanceof Error ? err.message : err}`,
      "error",
    );
  } finally {
    teamSubmit.removeAttribute("disabled");
  }
});

// Allow Enter key to submit
tokenInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tokenSubmit.click();
});
teamInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") teamSubmit.click();
});

setupDone.addEventListener("click", () => {
  setupOverlay.classList.add("hidden");
});

// ---- Settings button ----
settingsBtn.addEventListener("click", () => {
  tokenCard.classList.remove("configured");
  teamCard.classList.remove("configured");
  setupOverlay.classList.remove("hidden");
});

setupCloseBtn.addEventListener("click", () => {
  setupOverlay.classList.add("hidden");
});

// ---- REPL panel ----
const splitToggle = document.getElementById("split-toggle")!;
const replPanel = document.getElementById("repl-panel")!;
const replToolSelect = document.getElementById("repl-tool") as HTMLSelectElement;
const replRunBtn = document.getElementById("repl-run")!;
const replParamsEl = document.getElementById("repl-params")!;
const replOutputEl = document.getElementById("repl-output")!;
const workspace = document.querySelector(".workspace")!;

interface McpToolParam {
  type?: string;
  description?: string;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, McpToolParam>;
    required?: string[];
  };
}

let replTools: McpTool[] = [];
let replToolsLoaded = false;

// Key/value map: collects returned values across queries to auto-populate optional params
interface KnownEntry {
  value: string;
  label: string;
}
const replKnownValues: Map<string, KnownEntry[]> = new Map();

function addKnownValue(key: string, value: string, label?: string): void {
  if (!value) return;
  const existing = replKnownValues.get(key) ?? [];
  if (!existing.some((e) => e.value === value)) {
    existing.push({ value, label: label ?? value });
    replKnownValues.set(key, existing);
  }
}

function extractKnownValues(text: string): void {
  let m: RegExpExecArray | null;

  // Project IDs with names: "• ProjectName (ID: 12345)"
  const projectRe = /•\s+(.+?)\s+\(ID:\s*(\d+)\)/g;
  while ((m = projectRe.exec(text)) !== null) {
    addKnownValue("project_id", m[2], m[1]);
  }

  // File keys with names: "• FileName\n  Key: abc123"
  const fileRe = /•\s+(.+?)\n\s+Key:\s*([A-Za-z0-9]+)/g;
  while ((m = fileRe.exec(text)) !== null) {
    addKnownValue("file_key_or_url", m[2], m[1]);
  }

  // Standalone file key: "Name: ...\n...File key: abc123"
  const standaloneFileRe = /Name:\s*(.+?)\n[\s\S]*?File key:\s*([A-Za-z0-9]+)/g;
  while ((m = standaloneFileRe.exec(text)) !== null) {
    addKnownValue("file_key_or_url", m[2], m[1]);
  }

  // User IDs: "Authenticated as: Name\n...User ID: 12345"
  const userRe = /Authenticated as:\s*(.+?)\n[\s\S]*?User ID:\s*(\d+)/g;
  while ((m = userRe.exec(text)) !== null) {
    addKnownValue("user_id", m[2], m[1]);
  }

  // Team IDs (no friendly name available)
  const teamRe = /\bTeam\s+(\d+)/gi;
  while ((m = teamRe.exec(text)) !== null) {
    addKnownValue("team_id", m[1]);
  }
}

// REPL run banding — tracks current band parity for log coloring
let replRunBand = 0;
let replRunActive = false;

splitToggle.addEventListener("click", () => {
  const isOpen = splitToggle.classList.toggle("open");
  if (isOpen) {
    replPanel.classList.remove("hidden");
    workspace.classList.add("split");
    if (!replToolsLoaded) loadReplTools();
  } else {
    replPanel.classList.add("hidden");
    workspace.classList.remove("split");
  }
});

async function loadReplTools(): Promise<void> {
  replToolSelect.innerHTML = '<option value="">Loading tools…</option>';
  replRunBtn.setAttribute("disabled", "");
  try {
    const res = await fetch(`${API_BASE}/api/mcp/tools`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load tools");
    replTools = data.tools ?? [];
    replToolsLoaded = true;

    replToolSelect.innerHTML = '<option value="">— select a tool —</option>';
    for (const tool of replTools) {
      const opt = document.createElement("option");
      opt.value = tool.name;
      opt.textContent = tool.name;
      if (tool.description) opt.title = tool.description;
      replToolSelect.appendChild(opt);
    }
  } catch (err) {
    replToolSelect.innerHTML = '<option value="">Error loading tools</option>';
    replToolsLoaded = false;
  }
}

replToolSelect.addEventListener("change", () => {
  const toolName = replToolSelect.value;
  replParamsEl.innerHTML = "";
  if (!toolName) {
    replRunBtn.setAttribute("disabled", "");
    return;
  }
  replRunBtn.removeAttribute("disabled");

  const tool = replTools.find((t) => t.name === toolName);
  if (!tool?.inputSchema?.properties) return;

  const required = new Set(tool.inputSchema.required ?? []);
  for (const [key, param] of Object.entries(tool.inputSchema.properties)) {
    const row = document.createElement("div");
    row.className = "repl-param-row";

    const label = document.createElement("label");
    label.className = "repl-param-label";
    label.textContent = key;
    if (!required.has(key)) {
      const opt = document.createElement("span");
      opt.className = "optional";
      opt.textContent = " (opt)";
      label.appendChild(opt);
    }
    label.title = param.description ?? key;

    const input = document.createElement("input");
    input.className = "repl-param-input";
    input.name = key;
    input.placeholder = param.description ?? "";
    input.type = param.type === "boolean" ? "checkbox" : "text";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") replRunBtn.click();
    });

    // Auto-populate from known values via datalist
    const known = replKnownValues.get(key);
    if (known && known.length > 0 && param.type !== "boolean") {
      const listId = `dl-${key}-${Date.now()}`;
      const datalist = document.createElement("datalist");
      datalist.id = listId;
      for (const entry of known) {
        const o = document.createElement("option");
        o.value = entry.value;
        if (entry.label !== entry.value) {
          o.textContent = entry.label;
        }
        datalist.appendChild(o);
      }
      input.setAttribute("list", listId);
      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(datalist);
    } else {
      row.appendChild(label);
      row.appendChild(input);
    }
    replParamsEl.appendChild(row);
  }
});

replRunBtn.addEventListener("click", async () => {
  const toolName = replToolSelect.value;
  if (!toolName) return;

  // Gather arguments from param inputs
  const args: Record<string, unknown> = {};
  replParamsEl.querySelectorAll<HTMLInputElement>(".repl-param-input").forEach((input) => {
    const val = input.type === "checkbox" ? input.checked : input.value.trim();
    if (val !== "" && val !== false) {
      args[input.name] = val;
    }
  });

  replRunBtn.setAttribute("disabled", "");
  replRunBtn.textContent = "⏳ Running…";

  // Clear "Select a tool" empty state
  replOutputEl.querySelector(".repl-empty")?.remove();

  // Start log banding for this run
  replRunBand++;
  replRunActive = true;

  try {
    const res = await fetch(`${API_BASE}/api/mcp/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: toolName, arguments: args }),
    });
    const data = await res.json();

    const resultEl = document.createElement("div");
    resultEl.className = "repl-result";

    const isError = !res.ok || data.result?.isError;
    const statusLabel = isError ? "error" : "ok";
    const statusClass = isError ? "err" : "ok";

    let bodyText: string;
    if (!res.ok) {
      bodyText = data.error ?? "Unknown error";
    } else if (data.result?.content) {
      bodyText = data.result.content
        .map((c: { type: string; text?: string }) => c.text ?? JSON.stringify(c))
        .join("\n");
    } else {
      bodyText = JSON.stringify(data.result, null, 2);
    }

    // Extract known values for auto-populating future params
    if (!isError) {
      extractKnownValues(bodyText);
    }

    resultEl.innerHTML = `
      <div class="repl-result-header">
        <span class="repl-result-tool">${escapeHtml(toolName)}</span>
        ${Object.keys(args).length ? `<span>${escapeHtml(JSON.stringify(args))}</span>` : ""}
        <span class="repl-result-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="repl-result-body">${escapeHtml(bodyText)}</div>
    `;

    // Newest first
    replOutputEl.prepend(resultEl);
  } catch (err) {
    const resultEl = document.createElement("div");
    resultEl.className = "repl-result";
    resultEl.innerHTML = `
      <div class="repl-result-header">
        <span class="repl-result-tool">${escapeHtml(toolName)}</span>
        <span class="repl-result-status err">error</span>
      </div>
      <div class="repl-result-body">${escapeHtml(err instanceof Error ? err.message : String(err))}</div>
    `;
    replOutputEl.prepend(resultEl);
  } finally {
    replRunActive = false;
    replRunBtn.removeAttribute("disabled");
    replRunBtn.textContent = "▶ Run";
    // Refresh param inputs to show newly discovered datalist values
    replToolSelect.dispatchEvent(new Event("change"));
  }
});

// ---- View Switcher ----
document.querySelectorAll<HTMLButtonElement>(".view-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelector(".view-btn.active")?.classList.remove("active");
    btn.classList.add("active");
    const view = btn.dataset.view as "log" | "chat";
    activeView = view;

    const workspaceEl = document.querySelector(".workspace")! as HTMLElement;

    if (view === "chat") {
      logHeader.classList.add("hidden");
      workspaceEl.style.display = "none";
      chatView.classList.remove("hidden");
    } else {
      logHeader.classList.remove("hidden");
      workspaceEl.style.display = "";
      chatView.classList.add("hidden");
    }
  });
});

// ---- iMessage Chat View ----

// Map category → display name and side (outgoing = right/blue, incoming = left/gray)
const CHAT_ACTORS: Record<string, { name: string; side: "left" | "right"; cssClass: string }> = {
  server: { name: "MCP Server", side: "left", cssClass: "cat-server" },
  auth: { name: "Auth", side: "left", cssClass: "cat-auth" },
  connection: { name: "Connection", side: "left", cssClass: "cat-connection" },
  "figma-api": { name: "Figma API", side: "right", cssClass: "cat-figma-api" },
  "user-profile": { name: "User Profile", side: "left", cssClass: "cat-user-profile" },
  setup: { name: "Setup", side: "left", cssClass: "cat-setup" },
  // Tool calls are requests going OUT to Figma
};

function getChatActor(msg: LogMessage) {
  // Tools and requests go out (right/blue), responses come back (left/gray)
  if (msg.level === "tool" || msg.level === "request") {
    return {
      name: msg.category.replace(/_/g, " "),
      side: "right" as const,
      cssClass: "cat-tool",
    };
  }
  if (msg.level === "response") {
    return {
      name: "Figma API",
      side: "left" as const,
      cssClass: "cat-figma-api",
    };
  }
  if (msg.level === "error") {
    return {
      name: msg.category.replace(/_/g, " "),
      side: msg.category in CHAT_ACTORS ? CHAT_ACTORS[msg.category].side : ("left" as const),
      cssClass: msg.category in CHAT_ACTORS ? CHAT_ACTORS[msg.category].cssClass : "cat-default",
    };
  }
  return (
    CHAT_ACTORS[msg.category] ?? {
      name: msg.category.replace(/_/g, " "),
      side: "left" as const,
      cssClass: "cat-default",
    }
  );
}

const seenParticipants = new Set<string>();
let lastChatSender = "";
let lastChatTimestamp = "";

function addChatParticipant(category: string, actor: { name: string; cssClass: string }): void {
  if (seenParticipants.has(category)) return;
  seenParticipants.add(category);
  const chip = document.createElement("span");
  chip.className = `chat-participant-chip ${actor.cssClass}`;
  chip.textContent = actor.name;
  chatParticipantsEl.appendChild(chip);
}

function showTypingIndicator(): void {
  chatTypingEl.classList.remove("hidden");
  // Auto-hide after a delay
  setTimeout(() => chatTypingEl.classList.add("hidden"), 800);
}

function renderChatBubble(msg: LogMessage): void {
  // Remove empty state
  chatContainer.querySelector(".chat-empty")?.remove();

  const actor = getChatActor(msg);
  addChatParticipant(msg.category, actor);

  const isRight = actor.side === "right";
  const isError = msg.level === "error";
  const senderKey = msg.category;

  // Time separator — show if 2+ minutes apart
  const ts = new Date(msg.timestamp);
  const timeStr = ts.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (lastChatTimestamp) {
    const lastTs = new Date(lastChatTimestamp);
    if (ts.getTime() - lastTs.getTime() > 120_000) {
      const sep = document.createElement("div");
      sep.className = "chat-timestamp";
      sep.textContent = timeStr;
      chatContainer.appendChild(sep);
    }
  } else {
    // First message — always show time
    const sep = document.createElement("div");
    sep.className = "chat-timestamp";
    sep.textContent = timeStr;
    chatContainer.appendChild(sep);
  }
  lastChatTimestamp = msg.timestamp;

  // Sender label — only when sender changes
  const consecutive = lastChatSender === senderKey;
  if (!consecutive) {
    const label = document.createElement("div");
    label.className = `chat-sender ${actor.cssClass}${isRight ? " right" : ""}`;
    label.textContent = actor.name;
    chatContainer.appendChild(label);
  }
  lastChatSender = senderKey;

  // Bubble row
  const row = document.createElement("div");
  row.className = `chat-bubble-row${isRight ? " right" : ""}`;

  // Bubble
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${isRight ? "outgoing" : "incoming"}${consecutive ? " consecutive" : ""}`;

  // Simulate send animation: start as "sending", then resolve
  bubble.classList.add("sending");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bubble.classList.remove("sending");
      bubble.classList.add("sent");
    });
  });

  // Message text
  const textNode = document.createElement("span");
  textNode.textContent = msg.summary;
  bubble.appendChild(textNode);

  // Expandable detail
  if (msg.detail != null) {
    const detailEl = document.createElement("div");
    detailEl.className = "chat-detail";
    detailEl.textContent =
      typeof msg.detail === "string" ? msg.detail : JSON.stringify(msg.detail, null, 2);
    bubble.appendChild(detailEl);
    bubble.style.cursor = "pointer";
    bubble.addEventListener("click", () => {
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;
      bubble.classList.toggle("expanded");
    });
  }

  row.appendChild(bubble);

  // Error badge
  if (isError) {
    const badge = document.createElement("div");
    badge.className = "chat-error-badge";
    badge.textContent = "!";
    badge.setAttribute("data-error", msg.summary);
    row.appendChild(badge);
  }

  chatContainer.appendChild(row);

  // Read receipt for outgoing non-error
  if (isRight && !isError) {
    const receipt = document.createElement("div");
    receipt.className = "chat-read-receipt";
    receipt.textContent = "Delivered";
    chatContainer.appendChild(receipt);
  }

  // Scroll to bottom
  chatScroll.scrollTop = chatScroll.scrollHeight;
}

// ---- Config info bar ----
async function refreshConfigInfo(): Promise<void> {
  try {
    const statusRes = await fetch(`${API_BASE}/api/config/status`);
    const status = await statusRes.json();

    // Org display — always visible
    if (status.hasOrgId && status.orgId) {
      configInfoOrgEl.textContent = `Org: ${status.orgId}`;
      configInfoOrgEl.classList.add("set");
    } else {
      configInfoOrgEl.textContent = "Org: not set";
      configInfoOrgEl.classList.remove("set");
    }

    // Team display — always visible
    if (status.hasTeamId && status.teamId) {
      configInfoTeamEl.textContent = `Team: ${status.teamId}`;
      configInfoTeamEl.classList.add("set");
    } else {
      configInfoTeamEl.textContent = "Team: not set";
      configInfoTeamEl.classList.remove("set");
    }

    // Token display
    if (!status.hasToken) {
      configInfoTokenEl.textContent = "PAT: not set";
      configInfoTokenEl.className = "config-chip token-chip";
      return;
    }

    configInfoTokenEl.textContent = `PAT: ${status.tokenPreview}`;

    // Live-check token validity
    const checkRes = await fetch(`${API_BASE}/api/config/check-token`);
    const check = await checkRes.json();
    if (check.valid) {
      configInfoTokenEl.className = "config-chip token-chip valid";
      configInfoTokenEl.title = `Token valid — ${check.user?.handle ?? ""}`;
    } else {
      configInfoTokenEl.className = "config-chip token-chip expired";
      configInfoTokenEl.textContent = "PAT: expired / invalid";
      configInfoTokenEl.title = check.error ?? "Token is no longer valid";
    }
  } catch {
    // Server not reachable
  }
}

// ---- Boot ----
checkConfigStatus();
refreshConfigInfo();
showEmptyState();
connect();

// Start with tools panel open
loadReplTools();

// Re-check token health every 5 minutes
setInterval(refreshConfigInfo, 5 * 60 * 1000);
