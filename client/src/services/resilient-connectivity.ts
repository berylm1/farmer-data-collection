// Fix for Issue 1: ResilientConnectionManager rewritten to use Socket.IO
// File: client/src/services/resilient-connectivity.ts
// Replace the entire file with this version

/**
 * Resilient Connectivity Service for Low-Bandwidth / Offline Environments
 * 
 * REWRITTEN to use Socket.IO client (matches server at /socket.io/)
 * - Exponential backoff with jitter for reconnection
 * - Message queue that persists offline messages to IndexedDB
 * - Socket.IO transports: WebSocket → polling fallback
 * - Heartbeat/keepalive with configurable intervals
 * - Offline-first architecture: queue all actions, sync when online
 */

import { io, Socket, connect } from 'socket.io-client';

// ── Network Quality Detection ───────────────────────────────────────────

export type NetworkQuality = "high" | "medium" | "low" | "offline";

export interface NetworkStatus {
  quality: NetworkQuality;
  effectiveType: string; // "4g" | "3g" | "2g" | "slow-2g" | "unknown"
  downlinkMbps: number;
  rtt: number; // round-trip time in ms
  online: boolean;
  saveData: boolean;
}

function detectNetworkQuality(): NetworkStatus {
  const nav = navigator as Navigator & {
    connection?: {
      effectiveType?: string;
      downlink?: number;
      rtt?: number;
      saveData?: boolean;
    };
  };

  const conn = nav.connection;
  const online = navigator.onLine;

  if (!online) {
    return { quality: "offline", effectiveType: "offline", downlinkMbps: 0, rtt: 0, online: false, saveData: false };
  }

  const effectiveType = conn?.effectiveType || "unknown";
  const downlink = conn?.downlink || 10;
  const rtt = conn?.rtt || 50;
  const saveData = conn?.saveData || false;

  let quality: NetworkQuality;
  if (effectiveType === "4g" && downlink > 5 && rtt < 100) {
    quality = "high";
  } else if (effectiveType === "3g" || (downlink > 1 && rtt < 300)) {
    quality = "medium";
  } else {
    quality = "low";
  }

  return { quality, effectiveType, downlinkMbps: downlink, rtt, online, saveData };
}

// ── Offline Message Queue (IndexedDB-backed) ────────────────────────────

interface QueuedMessage {
  id: string;
  channel: string;
  payload: unknown;
  timestamp: number;
  retries: number;
  priority: "high" | "normal" | "low";
}

class OfflineMessageQueue {
  private queue: QueuedMessage[] = [];
  private dbName = "farmconnect_msg_queue";
  private storeName = "messages";
  private db: IDBDatabase | null = null;
  private maxSize = 5000;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: "id" });
          store.createIndex("timestamp", "timestamp", { unique: false });
          store.createIndex("priority", "priority", { unique: false });
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        this.loadFromDB().then(resolve);
      };
      request.onerror = () => {
        console.warn("[OfflineQueue] IndexedDB unavailable, using memory queue");
        resolve();
      };
    });
  }

  private async loadFromDB(): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve) => {
      const tx = this.db!.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () => {
        this.queue = request.result || [];
        resolve();
      };
      request.onerror = () => resolve();
    });
  }

  async enqueue(channel: string, payload: unknown, priority: "high" | "normal" | "low" = "normal"): Promise<void> {
    if (this.queue.length >= this.maxSize) {
      const lowPriority = this.queue.filter(m => m.priority === "low");
      if (lowPriority.length > 0) {
        await this.remove(lowPriority[0].id);
      } else {
        const normal = this.queue.filter(m => m.priority === "normal");
        if (normal.length > 0) {
          await this.remove(normal[0].id);
        }
      }
    }

    const msg: QueuedMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channel,
      payload,
      timestamp: Date.now(),
      retries: 0,
      priority,
    };

    this.queue.push(msg);
    await this.saveToDB(msg);
  }

  async dequeue(): Promise<QueuedMessage | null> {
    const sorted = [...this.queue].sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return a.timestamp - b.timestamp;
    });

    if (sorted.length === 0) return null;
    return sorted[0];
  }

  async remove(id: string): Promise<void> {
    this.queue = this.queue.filter(m => m.id !== id);
    if (this.db) {
      const tx = this.db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).delete(id);
    }
  }

  async incrementRetry(id: string): Promise<void> {
    const msg = this.queue.find(m => m.id === id);
    if (msg) {
      msg.retries++;
      await this.saveToDB(msg);
    }
  }

  get size(): number {
    return this.queue.length;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  private async saveToDB(msg: QueuedMessage): Promise<void> {
    if (!this.db) return;
    const tx = this.db.transaction(this.storeName, "readwrite");
    tx.objectStore(this.storeName).put(msg);
  }
}

// ── Exponential Backoff with Jitter ──────────────────────────────────────

class ReconnectionStrategy {
  private attempt = 0;
  private baseDelay: number;
  private maxDelay: number;
  private maxAttempts: number;

  constructor(baseDelay = 1000, maxDelay = 60000, maxAttempts = Infinity) {
    this.baseDelay = baseDelay;
    this.maxDelay = maxDelay;
    this.maxAttempts = maxAttempts;
  }

  nextDelay(): number {
    if (this.attempt >= this.maxAttempts) return -1;
    const exponential = this.baseDelay * Math.pow(2, this.attempt);
    const capped = Math.min(exponential, this.maxDelay);
    const jitter = capped * (0.75 + Math.random() * 0.5);
    this.attempt++;
    return Math.round(jitter);
  }

  reset(): void {
    this.attempt = 0;
  }

  get attempts(): number {
    return this.attempt;
  }
}

// ── Resilient Connection Manager (Socket.IO) ──────────────────────────────

export interface ResilientConnectionConfig {
  /** Server URL (e.g., "https://america.tail3a833f.ts.net") */
  serverUrl?: string;
  /** Socket.IO path (default: "/socket.io/") */
  socketPath?: string;
  /** Heartbeat interval in ms (default: 15s for low-bandwidth) */
  heartbeatInterval?: number;
  /** Heartbeat timeout in ms (default: 10s) */
  heartbeatTimeout?: number;
  /** Max queue size (default: 5000) */
  maxQueueSize?: number;
  /** Enable offline queue (default: true) */
  enableOfflineQueue?: boolean;
}

export type ConnectionState = "connected" | "connecting" | "reconnecting" | "disconnected" | "offline";

export interface ConnectionStatus {
  state: ConnectionState;
  transport: string;
  network: NetworkStatus;
  queueSize: number;
  reconnectAttempts: number;
  lastConnected: number | null;
  lastError: string | null;
  socketId: string | null;
}

type StatusChangeHandler = (status: ConnectionStatus) => void;
type MessageHandler = (data: unknown) => void;

export class ResilientConnectionManager {
  private config: Required<ResilientConnectionConfig>;
  private socket: Socket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private messageQueue: OfflineMessageQueue;
  private reconnection: ReconnectionStrategy;
  private state: ConnectionState = "disconnected";
  private lastConnected: number | null = null;
  private lastError: string | null = null;
  private clientId: string = "";
  private socketId: string | null = null;

  private messageHandlers: Map<string, Set<MessageHandler>> = new Map();
  private statusHandlers: Set<StatusChangeHandler> = new Set();
  private networkMonitorCleanup: (() => void) | null = null;

  constructor(config: ResilientConnectionConfig = {}) {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    this.config = {
      serverUrl: config.serverUrl || baseUrl,
      socketPath: config.socketPath || "/socket.io/",
      heartbeatInterval: config.heartbeatInterval || 15000,
      heartbeatTimeout: config.heartbeatTimeout || 10000,
      maxQueueSize: config.maxQueueSize || 5000,
      enableOfflineQueue: config.enableOfflineQueue ?? true,
    };

    this.messageQueue = new OfflineMessageQueue();
    this.reconnection = new ReconnectionStrategy(1000, 60000, Infinity);
  }

  // ── Public API ────────────────────────────────────────────────────────

  async connect(clientId: string): Promise<void> {
    this.clientId = clientId;
    await this.messageQueue.init();
    this.startNetworkMonitor();

    const network = detectNetworkQuality();
    if (!network.online) {
      this.setState("offline");
      return;
    }

    await this.connectSocketIO();
  }

  disconnect(): void {
    this.stopNetworkMonitor();
    this.stopHeartbeat();
    this.clearReconnectTimer();
    this.disconnectSocket();
    this.setState("disconnected");
  }

  async send(channel: string, payload: unknown, priority: "high" | "normal" | "low" = "normal"): Promise<void> {
    const message = JSON.stringify({ channel, payload, clientId: this.clientId, timestamp: Date.now() });

    if (this.state === "connected" && this.socket?.connected) {
      try {
        this.socket.emit("message", message);
        return;
      } catch (err) {
        console.warn("[Resilient] Socket.IO send failed, queuing:", String(err));
      }
    }

    // Queue for later delivery
    if (this.config.enableOfflineQueue) {
      await this.messageQueue.enqueue(channel, payload, priority);
      this.notifyStatusChange();
    }
  }

  onMessage(channel: string, handler: MessageHandler): () => void {
    if (!this.messageHandlers.has(channel)) {
      this.messageHandlers.set(channel, new Set());
    }
    this.messageHandlers.get(channel)!.add(handler);
    return () => {
      this.messageHandlers.get(channel)?.delete(handler);
    };
  }

  onStatusChange(handler: StatusChangeHandler): () => void {
    this.statusHandlers.add(handler);
    handler(this.getStatus());
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  getStatus(): ConnectionStatus {
    return {
      state: this.state,
      transport: this.socket?.io.engine?.transport?.name || "none",
      network: detectNetworkQuality(),
      queueSize: this.messageQueue.size,
      reconnectAttempts: this.reconnection.attempts,
      lastConnected: this.lastConnected,
      lastError: this.lastError,
      socketId: this.socketId,
    };
  }

  // ── Socket.IO Connection ──────────────────────────────────────────────

  private async connectSocketIO(): Promise<void> {
    this.setState("connecting");

    try {
      // Create Socket.IO connection with proper options
      this.socket = io(this.config.serverUrl, {
        path: this.config.socketPath,
        transports: ["websocket", "polling"],
        reconnection: false, // We handle reconnection manually
        auth: { clientId: this.clientId },
        timeout: 20000,
        forceNew: true,
      });

      this.setupSocketListeners();
    } catch (err) {
      this.lastError = `Socket.IO connection failed: ${err}`;
      this.scheduleReconnect();
    }
  }

  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      this.socketId = this.socket?.id || null;
      this.setState("connected");
      this.reconnection.reset();
      this.lastConnected = Date.now();
      this.startHeartbeat();
      this.drainQueue();
      
      // Authenticate with user ID
      if (this.clientId) {
        // Extract user ID from clientId (format: "user-{userId}-{timestamp}")
        const match = this.clientId.match(/^user-(\d+)-/);
        if (match) {
          this.socket?.emit("authenticate", parseInt(match[1], 10));
        }
      }
    });

    this.socket.on("disconnect", (reason) => {
      this.socketId = null;
      this.stopHeartbeat();
      if (reason === "io server disconnect") {
        // Server initiated disconnect, don't reconnect automatically
        this.setState("disconnected");
      } else {
        // Network issue, schedule reconnect
        this.handleDisconnect(`Socket.IO disconnected: ${reason}`);
      }
    });

    this.socket.on("connect_error", (err) => {
      this.lastError = `Socket.IO connection error: ${err.message}`;
      this.scheduleReconnect();
    });

    this.socket.on("message", (data: unknown) => {
      try {
        const parsed = typeof data === "string" ? JSON.parse(data) : data;
        if (parsed.type === "pong") {
          this.handleHeartbeatResponse();
          return;
        }
        this.dispatchMessage(parsed.channel || parsed.type || "default", parsed);
      } catch (err) {
        console.warn("[Resilient] Socket.IO message parse failed:", String(err));
        this.dispatchMessage("raw", data);
      }
    });

    // Handle real-time events from server
    this.socket.on("realtime_event", (event: unknown) => {
      this.dispatchMessage("realtime_event", event);
    });

    this.socket.on("sync_event", (event: unknown) => {
      this.dispatchMessage("sync_event", event);
    });

    this.socket.on("sync_conflict", (conflict: unknown) => {
      this.dispatchMessage("sync_conflict", conflict);
    });
  }

  private disconnectSocket(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit("ping");
        // Set timeout for pong response
        this.heartbeatTimeoutTimer = setTimeout(() => {
          this.lastError = "Heartbeat timeout";
          this.socket?.disconnect();
          this.handleDisconnect("Heartbeat timeout");
        }, this.config.heartbeatTimeout);
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private handleHeartbeatResponse(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  // ── Reconnection ──────────────────────────────────────────────────────

  private handleDisconnect(reason: string): void {
    this.lastError = reason;
    this.setState("reconnecting");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay = this.reconnection.nextDelay();
    if (delay < 0) {
      this.setState("disconnected");
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.connectSocketIO();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ── Queue Management ──────────────────────────────────────────────────

  private async drainQueue(): Promise<void> {
    while (this.messageQueue.size > 0) {
      const msg = await this.messageQueue.dequeue();
      if (!msg) break;
      
      if (this.socket?.connected) {
        try {
          this.socket.emit("message", JSON.stringify({
            channel: msg.channel,
            payload: msg.payload,
            clientId: this.clientId,
            timestamp: Date.now(),
          }));
          await this.messageQueue.remove(msg.id);
        } catch (err) {
          await this.messageQueue.incrementRetry(msg.id);
          if (msg.retries >= 5) {
            await this.messageQueue.remove(msg.id); // Give up after 5 retries
          }
          break; // Stop draining on send failure
        }
      } else {
        break; // Not connected, stop draining
      }
    }
    this.notifyStatusChange();
  }

  // ── Network Monitoring ─────────────────────────────────────────────────

  private startNetworkMonitor(): void {
    if (typeof window === "undefined") return;
    
    const handleOnline = () => {
      if (this.state === "offline" || this.state === "disconnected") {
        this.connect(this.clientId);
      }
    };
    const handleOffline = () => {
      this.setState("offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    
    this.networkMonitorCleanup = () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }

  private stopNetworkMonitor(): void {
    if (this.networkMonitorCleanup) {
      this.networkMonitorCleanup();
      this.networkMonitorCleanup = null;
    }
  }

  // ── State Management ──────────────────────────────────────────────────

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.notifyStatusChange();
    }
  }

  private notifyStatusChange(): void {
    const status = this.getStatus();
    this.statusHandlers.forEach(handler => handler(status));
  }

  private dispatchMessage(channel: string, data: unknown): void {
    this.messageHandlers.get(channel)?.forEach(handler => handler(data));
  }
}

// ── React Hook ──────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback } from "react";

export function useResilientConnection(clientId?: string) {
  const managerRef = useRef<ResilientConnectionManager | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>({
    state: "disconnected",
    transport: "none",
    network: { quality: "offline", effectiveType: "offline", downlinkMbps: 0, rtt: 0, online: false, saveData: false },
    queueSize: 0,
    reconnectAttempts: 0,
    lastConnected: null,
    lastError: null,
    socketId: null,
  });

  useEffect(() => {
    managerRef.current = new ResilientConnectionManager();
    const manager = managerRef.current;

    const unsubscribe = manager.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    if (clientId) {
      manager.connect(clientId);
    }

    return () => {
      unsubscribe();
      manager.disconnect();
    };
  }, [clientId]);

  const send = useCallback(async (channel: string, payload: unknown, priority?: "high" | "normal" | "low") => {
    await managerRef.current?.send(channel, payload, priority);
  }, []);

  const onMessage = useCallback((channel: string, handler: MessageHandler) => {
    return managerRef.current?.onMessage(channel, handler) || (() => {});
  }, []);

  const subscribe = useCallback((channel: string, handler: MessageHandler) => {
    return managerRef.current?.onMessage(channel, handler) || (() => {});
  }, []);

  return { status, send, onMessage, subscribe };
}