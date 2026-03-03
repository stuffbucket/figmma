import WebSocket from "ws";
import { createConnection } from "net";

const OBSERVER_PORT = 5183;
const RECONNECT_INTERVAL_MS = 5000;

export type LogLevel = "info" | "tool" | "request" | "response" | "error" | "lifecycle";

export interface ObserverMessage {
  timestamp: string;
  level: LogLevel;
  category: string;
  summary: string;
  detail?: unknown;
}

/**
 * Observer client that lives inside the MCP process.
 * It probes localhost:5183 — if a dashboard is listening, it connects
 * via WebSocket and streams human-readable log messages.
 * If nothing is listening, it silently no-ops so the MCP works normally.
 */
class Observer {
  private ws: WebSocket | null = null;
  private connected = false;
  private buffer: ObserverMessage[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  async start(): Promise<void> {
    const alive = await this.probe();
    if (alive) {
      this.connect();
    } else {
      // Periodically re-probe in case dashboard starts later
      this.scheduleReconnect();
    }
  }

  /** Quick TCP probe to see if anything is listening on the observer port */
  private probe(): Promise<boolean> {
    return new Promise((resolve) => {
      const sock = createConnection({ host: "127.0.0.1", port: OBSERVER_PORT }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on("error", () => resolve(false));
      sock.setTimeout(500, () => {
        sock.destroy();
        resolve(false);
      });
    });
  }

  private connect(): void {
    if (this.destroyed) return;
    try {
      this.ws = new WebSocket(`ws://127.0.0.1:${OBSERVER_PORT}`);

      this.ws.on("open", () => {
        this.connected = true;
        // Flush any buffered messages
        for (const msg of this.buffer) {
          this.send(msg);
        }
        this.buffer = [];
      });

      this.ws.on("close", () => {
        this.connected = false;
        this.ws = null;
        this.scheduleReconnect();
      });

      this.ws.on("error", () => {
        this.connected = false;
        this.ws = null;
        this.scheduleReconnect();
      });
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      const alive = await this.probe();
      if (alive) {
        this.connect();
      } else {
        this.scheduleReconnect();
      }
    }, RECONNECT_INTERVAL_MS);
    // Don't keep the process alive just for reconnection
    this.reconnectTimer.unref();
  }

  private send(msg: ObserverMessage): void {
    if (this.ws && this.connected) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch {
        // Swallow — dashboard is non-critical
      }
    }
  }

  /** Log a message. Buffers briefly if not yet connected. */
  log(level: LogLevel, category: string, summary: string, detail?: unknown): void {
    const msg: ObserverMessage = {
      timestamp: new Date().toISOString(),
      level,
      category,
      summary,
      detail,
    };

    if (this.connected) {
      this.send(msg);
    } else if (this.buffer.length < 200) {
      this.buffer.push(msg);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
  }
}

// Singleton
export const observer = new Observer();
