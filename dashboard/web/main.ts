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

// ---- Boot ----
showEmptyState();
connect();
