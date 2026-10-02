import { eventBus } from '../core/EventBus';
import type { PlayerInput, PlayerState } from './StatePredictor';
import type { EntitySnapshot } from './Interpolator';
import type { NetMessage, ShotCommand, ReloadCommand, ServerSnapshotPayload, WelcomePayload } from './Protocol';
import type { WeaponId } from '../gameplay/WeaponDefinitions';

export type { ServerSnapshotPayload, WelcomePayload } from './Protocol';

export class NetworkManager {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private disposed = false;
  public isConnected = false;
  public clientId = 'local_client';
  public ping = 0;

  private pingTimestamp = 0;
  private pingInterval: number | null = null;
  private serverClockOffsetMs = 0;
  private shotSequence = 0;
  private localServerTime = Date.now();

  public onSnapshotCallback: ((snapshot: ServerSnapshotPayload) => void) | null = null;
  public onWelcomeCallback: ((welcome: WelcomePayload) => void) | null = null;

  public connect(url?: string): void {
    this.disposed = false;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    const wsUrl = url || this.getDefaultWsUrl();

    try {
      const socket = new WebSocket(wsUrl);
      this.socket = socket;
      socket.binaryType = 'arraybuffer';

      socket.onopen = () => {
        if (socket !== this.socket || this.disposed) return;
        this.isConnected = true;
        this.send('join', { name: `Operative-${Math.floor(1000 + Math.random() * 9000)}` });
        this.startPingLoop();
        eventBus.emit('net:connected', { clientId: this.clientId, ping: this.ping });
      };

      socket.onmessage = (event) => {
        if (socket !== this.socket || this.disposed) return;
        try {
          this.handleMessage(JSON.parse(String(event.data)) as NetMessage);
        } catch (err) {
          console.error('[NetworkManager] Invalid packet:', err);
        }
      };

      socket.onclose = () => {
        if (socket !== this.socket) return;
        this.isConnected = false;
        this.stopPingLoop();
        eventBus.emit('net:disconnected', { reason: 'Socket closed' });
        this.scheduleReconnect();
      };

      socket.onerror = () => {
        if (socket === this.socket) this.isConnected = false;
      };
    } catch {
      this.isConnected = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.disposed) this.connect();
    }, 3000);
  }

  private getDefaultWsUrl(): string {
    if (typeof window !== 'undefined') {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}/ws`;
    }
    return 'ws://localhost:3000/ws';
  }

  public send<T>(type: NetMessage['type'], data: T): void {
    if (!this.isConnected || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > 256 * 1024) return;
    this.socket.send(JSON.stringify({ type, data }));
  }

  public sendInput(input: PlayerInput): void {
    this.send('input', input);
  }

  public sendShot(weaponId: WeaponId, origin: [number, number, number], directions: [number, number, number][]): void {
    const payload: ShotCommand = {
      sequence: ++this.shotSequence,
      weaponId,
      origin,
      directions,
      clientTime: this.getServerTime(),
    };
    this.send('shot', payload);
  }

  public sendReload(weaponId: WeaponId): void {
    const payload: ReloadCommand = { sequence: ++this.shotSequence, weaponId };
    this.send('reload', payload);
  }

  private handleMessage(msg: NetMessage): void {
    switch (msg.type) {
      case 'welcome': {
        const welcome = msg.data as WelcomePayload;
        this.clientId = welcome.clientId;
        this.serverClockOffsetMs = welcome.serverTime - Date.now();
        this.localServerTime = welcome.serverTime;
        this.onWelcomeCallback?.(welcome);
        break;
      }
      case 'snapshot': {
        const snapshot = msg.data as ServerSnapshotPayload;
        this.localServerTime = snapshot.timestamp;
        this.serverClockOffsetMs = snapshot.timestamp - Date.now();
        this.onSnapshotCallback?.(snapshot);
        break;
      }
      case 'pong': {
        const now = performance.now();
        this.ping = Math.round(now - this.pingTimestamp);
        const serverTime = Number((msg.data as { serverTime?: number }).serverTime);
        if (Number.isFinite(serverTime)) {
          const midpoint = Date.now() - this.ping / 2;
          this.serverClockOffsetMs = serverTime - midpoint;
          this.localServerTime = serverTime;
        }
        break;
      }
      case 'combat':
        eventBus.emit('net:combat', msg.data);
        break;
      case 'kill': {
        const k = msg.data as { killer: string; victim: string; weapon: string; headshot: boolean };
        eventBus.emit('net:killfeed', k);
        break;
      }
      case 'player_join':
        eventBus.emit('net:player_join', msg.data);
        break;
      case 'player_leave':
        eventBus.emit('net:player_leave', msg.data);
        break;
    }
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.pingInterval = window.setInterval(() => {
      if (!this.isConnected) return;
      this.pingTimestamp = performance.now();
      this.send('ping', { clientTime: Date.now() });
    }, 2000);
  }

  private stopPingLoop(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public updateLocalFallback(deltaTime: number, localState: PlayerState, latestInputSeq: number): void {
    if (this.isConnected) return;
    this.localServerTime += deltaTime * 1000;
    this.onSnapshotCallback?.({
      tick: Math.floor(this.localServerTime / (1000 / 60)),
      timestamp: this.localServerTime,
      lastAckSequence: latestInputSeq,
      authoritativeState: localState,
      health: 100,
      maxHealth: 100,
      entities: [],
    });
  }

  public getServerTime(): number {
    return Date.now() + this.serverClockOffsetMs;
  }

  public dispose(): void {
    this.disposed = true;
    this.stopPingLoop();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    this.isConnected = false;
    socket?.close();
  }
}
