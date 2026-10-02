/**
 * NetworkManager.ts
 * Manages WebSocket connection lifecycle, message serialization/deserialization,
 * ping/RTT measurement, packet queuing, and seamless offline/online fallback.
 */

import { eventBus } from '../core/EventBus';
import { PlayerInput, PlayerState } from './StatePredictor';
import { EntitySnapshot } from './Interpolator';

export type NetMessageType =
  | 'join'
  | 'welcome'
  | 'input'
  | 'snapshot'
  | 'hit'
  | 'kill'
  | 'ping'
  | 'pong';

export interface NetMessage<T = any> {
  type: NetMessageType;
  data: T;
}

export interface WelcomePayload {
  clientId: string;
  serverTick: number;
  serverTime: number;
  spawnPosition: [number, number, number];
}

export interface ServerSnapshotPayload {
  tick: number;
  timestamp: number;
  lastAckSequence: number;
  authoritativeState: PlayerState;
  entities: EntitySnapshot[];
}

export interface HitPayload {
  targetId: string;
  damage: number;
  isHeadshot: boolean;
  timestamp: number;
  weaponName: string;
}

export class NetworkManager {
  private socket: WebSocket | null = null;
  public isConnected: boolean = false;
  public clientId: string = 'local_client';

  // Metrics
  public ping: number = 24; // ms
  private pingTimestamp: number = 0;
  private pingInterval: number | null = null;

  // Snapshot callbacks
  public onSnapshotCallback: ((snapshot: ServerSnapshotPayload) => void) | null = null;
  public onWelcomeCallback: ((welcome: WelcomePayload) => void) | null = null;

  // Fallback local simulation clock
  private localServerTime: number = Date.now();
  private simulatedBots: EntitySnapshot[] = [];
  private botUpdateTimer: number = 0;

  constructor() {
    this.initSimulatedBots();
  }

  public connect(url?: string): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl = url || this.getDefaultWsUrl();

    try {
      this.socket = new WebSocket(wsUrl);
      this.socket.binaryType = 'arraybuffer';

      this.socket.onopen = () => {
        this.isConnected = true;
        this.send('join', { name: `Operative-${Math.floor(1000 + Math.random() * 9000)}` });
        this.startPingLoop();
        eventBus.emit('net:connected', { clientId: this.clientId, ping: this.ping });
      };

      this.socket.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data) as NetMessage;
          this.handleMessage(msg);
        } catch (err) {
          console.error('[NetworkManager] Error parsing packet:', err);
        }
      };

      this.socket.onclose = () => {
        this.isConnected = false;
        this.stopPingLoop();
        eventBus.emit('net:disconnected', { reason: 'Socket closed' });
        // Attempt reconnect after 3 seconds
        setTimeout(() => this.connect(), 3000);
      };

      this.socket.onerror = (err) => {
        // Fall back gracefully to local authoritative simulation
        this.isConnected = false;
      };
    } catch (e) {
      console.warn('[NetworkManager] WebSocket creation error, running local loop:', e);
      this.isConnected = false;
    }
  }

  private getDefaultWsUrl(): string {
    if (typeof window !== 'undefined' && window.location) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}/ws`;
    }
    return 'ws://localhost:3000/ws';
  }

  public send<T>(type: NetMessageType, data: T): void {
    if (this.isConnected && this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, data }));
    }
  }

  public sendInput(input: PlayerInput): void {
    this.send('input', input);
  }

  public sendHit(payload: HitPayload): void {
    this.send('hit', payload);
  }

  private handleMessage(msg: NetMessage): void {
    switch (msg.type) {
      case 'welcome': {
        const welcome = msg.data as WelcomePayload;
        this.clientId = welcome.clientId;
        if (this.onWelcomeCallback) {
          this.onWelcomeCallback(welcome);
        }
        break;
      }
      case 'snapshot': {
        const snap = msg.data as ServerSnapshotPayload;
        if (this.onSnapshotCallback) {
          this.onSnapshotCallback(snap);
        }
        break;
      }
      case 'pong': {
        this.ping = Math.round(performance.now() - this.pingTimestamp);
        break;
      }
      case 'kill': {
        const k = msg.data;
        eventBus.emit('net:killfeed', {
          killer: k.killer,
          victim: k.victim,
          weapon: k.weapon,
          headshot: k.headshot,
        });
        break;
      }
    }
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.pingInterval = window.setInterval(() => {
      if (this.isConnected) {
        this.pingTimestamp = performance.now();
        this.send('ping', { time: this.pingTimestamp });
      }
    }, 2000);
  }

  private stopPingLoop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Initializes tactical bot entities so target dummies & AI combatants always exist.
   */
  private initSimulatedBots(): void {
    this.simulatedBots = [
      {
        id: 'bot_alpha',
        name: 'Nexus-01 [BOT]',
        position: [6, 1.2, -14],
        velocity: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        health: 100,
        maxHealth: 100,
        weaponIndex: 0,
        isFiring: false,
        isCrouching: false,
        score: 300,
        kills: 2,
        deaths: 1,
      },
      {
        id: 'bot_bravo',
        name: 'Viper-02 [BOT]',
        position: [-10, 1.2, -22],
        velocity: [0, 0, 0],
        yaw: Math.PI / 4,
        pitch: 0,
        health: 100,
        maxHealth: 100,
        weaponIndex: 1,
        isFiring: false,
        isCrouching: false,
        score: 450,
        kills: 3,
        deaths: 0,
      },
      {
        id: 'bot_charlie',
        name: 'Ghost-03 [BOT]',
        position: [14, 3.5, -28], // On high catwalk
        velocity: [0, 0, 0],
        yaw: -Math.PI / 2,
        pitch: 0,
        health: 100,
        maxHealth: 100,
        weaponIndex: 2,
        isFiring: false,
        isCrouching: false,
        score: 150,
        kills: 1,
        deaths: 2,
      },
    ];
  }

  /**
   * Local authoritative fallback simulation (runs if socket disconnected).
   */
  public updateLocalFallback(
    deltaTime: number,
    localState: PlayerState,
    latestInputSeq: number
  ): void {
    if (this.isConnected) return; // Server provides authoritative snapshots when connected

    this.localServerTime += deltaTime * 1000;
    this.botUpdateTimer += deltaTime;

    // Move bots with patrol AI
    const time = this.localServerTime * 0.001;
    this.simulatedBots[0].position[0] = 6 + Math.sin(time * 0.8) * 5;
    this.simulatedBots[0].velocity[0] = Math.cos(time * 0.8) * 4;
    this.simulatedBots[0].yaw = Math.sin(time * 0.8) > 0 ? 0 : Math.PI;

    this.simulatedBots[1].position[2] = -22 + Math.cos(time * 0.6) * 6;
    this.simulatedBots[1].velocity[2] = -Math.sin(time * 0.6) * 3.6;

    if (this.onSnapshotCallback) {
      this.onSnapshotCallback({
        tick: Math.floor(time * 60),
        timestamp: this.localServerTime,
        lastAckSequence: latestInputSeq,
        authoritativeState: localState,
        entities: this.simulatedBots,
      });
    }
  }

  public registerDamageToBot(targetId: string, damage: number, isHeadshot: boolean, weapon: string): void {
    const bot = this.simulatedBots.find((b) => b.id === targetId);
    if (bot) {
      bot.health = Math.max(0, bot.health - damage);
      if (bot.health <= 0) {
        bot.deaths++;
        eventBus.emit('net:killfeed', {
          killer: 'You',
          victim: bot.name,
          weapon,
          headshot: isHeadshot,
        });

        // Respawn bot after 2.5s
        setTimeout(() => {
          bot.health = bot.maxHealth;
          bot.position = [(Math.random() - 0.5) * 25, 1.2, -10 - Math.random() * 25];
        }, 2500);
      }
    }
  }

  public getServerTime(): number {
    return this.localServerTime;
  }

  public dispose(): void {
    this.stopPingLoop();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
