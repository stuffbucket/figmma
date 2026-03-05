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

let activeFilter = "all";
let autoScroll = true;

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
  showEmptyState();
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

  const time = new Date(msg.timestamp);
  const timeStr = time.toLocaleTimeString("en-US", {
    hour12: false,
    fractionalSecondDigits: 3,
  } as Intl.DateTimeFormatOptions);

  row.innerHTML = `
    <span class="log-time">${timeStr}</span>
    <span class="log-level ${msg.level}">${msg.level}</span>
    <span class="log-category" title="${escapeHtml(msg.category)}">${escapeHtml(msg.category)}</span>
    <span class="log-summary">${escapeHtml(msg.summary)}</span>
    ${msg.detail != null ? `<div class="log-detail">${escapeHtml(typeof msg.detail === "string" ? msg.detail : JSON.stringify(msg.detail, null, 2))}</div>` : ""}
  `;

  if (msg.detail != null) {
    row.style.cursor = "pointer";
    row.addEventListener("click", () => row.classList.toggle("expanded"));
  }

  logContainer.appendChild(row);

  if (autoScroll) {
    logContainer.scrollTop = logContainer.scrollHeight;
  }
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
  });

  ws.addEventListener("close", () => {
    statusEl.textContent = "disconnected";
    statusEl.className = "status disconnected";
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
    } catch {
      // Ignore malformed messages
    }
  });
}

// ---- Setup panel ----
const API_BASE = "http://127.0.0.1:5183";
let tokenOk = false;
let teamOk = false;

function updateSetupDone(): void {
  if (tokenOk && teamOk) {
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
    }
    if (data.hasTeamId) {
      teamOk = true;
      teamBadge.textContent = "saved";
      teamBadge.className = "badge badge-ok";
      setFeedback(teamFeedback, `Team ID: ${data.teamId}`, "success");
    }
    if (tokenOk && teamOk) {
      // Already configured — skip setup
      return;
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
    updateSetupDone();
  } catch (err) {
    setFeedback(tokenFeedback, `Network error: ${err instanceof Error ? err.message : err}`, "error");
  } finally {
    tokenSubmit.removeAttribute("disabled");
  }
});

teamSubmit.addEventListener("click", async () => {
  const input = teamInput.value.trim();
  if (!input) return;
  teamSubmit.setAttribute("disabled", "");
  setFeedback(teamFeedback, "Validating team ID…", "loading");

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
      setFeedback(teamFeedback, data.error ?? "Validation failed", "error");
      teamBadge.textContent = "invalid";
      teamBadge.className = "badge badge-error";
      return;
    }
    teamOk = true;
    teamBadge.textContent = "valid";
    teamBadge.className = "badge badge-ok";
    const projectCount = data.projects?.length;
    const msg = data.validated
      ? `Team ${data.teamId} — ${projectCount} project(s) found`
      : `Team ${data.teamId} saved (not yet validated)`;
    setFeedback(teamFeedback, msg, "success");
    updateSetupDone();
  } catch (err) {
    setFeedback(teamFeedback, `Network error: ${err instanceof Error ? err.message : err}`, "error");
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

// ---- Boot ----
checkConfigStatus();
showEmptyState();
connect();
