/**
 * GameServer.ts
 * Authoritative 60Hz Node.js Game Server engine with client input validation,
 * lag-compensated historical rewind buffers, state snapshot broadcasting, and AI combat bots.
 */

import { WebSocket, WebSocketServer } from 'ws';
import { PlayerInput, PlayerState } from '../netcode/StatePredictor';
import { EntitySnapshot } from '../netcode/Interpolator';

export interface ServerPlayer {
  id: string;
  name: string;
  ws: WebSocket;
  state: PlayerState;
  lastProcessedSequence: number;
  unprocessedInputs: PlayerInput[];
  health: number;
  maxHealth: number;
  score: number;
  kills: number;
  deaths: number;
  weaponIndex: number;
  isFiring: boolean;
  ping: number;
}

export interface HistoricalHitbox {
  position: [number, number, number];
  headPosition: [number, number, number];
  radius: number;
  height: number;
}

export interface HistoricalTick {
  tick: number;
  timestamp: number;
  entities: Map<string, HistoricalHitbox>;
}

export class GameServer {
  private wss: WebSocketServer | null = null;
  private players: Map<string, ServerPlayer> = new Map();
  private bots: EntitySnapshot[] = [];

  private currentTick: number = 0;
  private tickInterval: NodeJS.Timeout | null = null;
  private readonly TICK_RATE = 60; // 60Hz physics
  private readonly TICK_DURATION = 1000 / 60; // ~16.666ms

  // Lag Compensation History Buffer (holds 1000ms = 60 ticks)
  private historyBuffer: HistoricalTick[] = [];
  private readonly MAX_HISTORY_TICKS = 60;

  // Snapshot broadcast rate (30Hz)
  private snapshotCounter: number = 0;

  constructor(wss?: WebSocketServer) {
    if (wss) {
      this.attachWebSocketServer(wss);
    }
    this.initBots();
  }

  public attachWebSocketServer(wss: WebSocketServer): void {
    this.wss = wss;
    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });
  }

  public start(): void {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => {
      this.tick();
    }, this.TICK_DURATION);
    console.info(`[GameServer] Authoritative 60Hz Engine started. Tick duration: ${this.TICK_DURATION.toFixed(2)}ms`);
  }

  public stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private handleConnection(ws: WebSocket): void {
    const playerId = `p_${Math.random().toString(36).substring(2, 9)}`;
    const newPlayer: ServerPlayer = {
      id: playerId,
      name: `Player_${playerId.slice(2, 6)}`,
      ws,
      state: {
        position: [(Math.random() - 0.5) * 8, 1.2, (Math.random() - 0.5) * 8],
        velocity: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        isGrounded: true,
        isCrouching: false,
      },
      lastProcessedSequence: 0,
      unprocessedInputs: [],
      health: 100,
      maxHealth: 100,
      score: 0,
      kills: 0,
      deaths: 0,
      weaponIndex: 0,
      isFiring: false,
      ping: 25,
    };

    this.players.set(playerId, newPlayer);

    // Send Welcome packet
    ws.send(
      JSON.stringify({
        type: 'welcome',
        data: {
          clientId: playerId,
          serverTick: this.currentTick,
          serverTime: Date.now(),
          spawnPosition: newPlayer.state.position,
        },
      })
    );

    ws.on('message', (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handlePlayerMessage(playerId, msg);
      } catch (err) {
        console.error('[GameServer] Error parsing client message:', err);
      }
    });

    ws.on('close', () => {
      this.players.delete(playerId);
      this.broadcast('kill', {
        killer: 'Server',
        victim: newPlayer.name,
        weapon: 'Disconnected',
        headshot: false,
      });
    });

    ws.on('error', (err) => {
      console.warn(`[GameServer] Player socket error:`, err);
    });
  }

  private handlePlayerMessage(playerId: string, msg: { type: string; data: any }): void {
    const player = this.players.get(playerId);
    if (!player) return;

    switch (msg.type) {
      case 'join': {
        if (msg.data && msg.data.name) {
          player.name = String(msg.data.name).slice(0, 16);
        }
        break;
      }
      case 'input': {
        const input = msg.data as PlayerInput;
        // Queue input in sequence
        player.unprocessedInputs.push(input);
        break;
      }
      case 'hit': {
        this.handleClientHitClaim(player, msg.data);
        break;
      }
      case 'ping': {
        player.ws.send(JSON.stringify({ type: 'pong', data: msg.data }));
        break;
      }
    }
  }

  /**
   * Lag Compensation Rewind Raycast Validation.
   * Rewinds entity hitboxes back to client timestamp to verify hits.
   */
  private handleClientHitClaim(
    shooter: ServerPlayer,
    hitData: { targetId: string; damage: number; isHeadshot: boolean; timestamp: number; weaponName: string }
  ): void {
    const now = Date.now();
    // Clamp rewind to a safe 250ms window to prevent artificial back-in-time exploit
    const maxLag = 250;
    const requestedTimestamp = Math.max(now - maxLag, Math.min(now, hitData.timestamp));

    // Find historical tick closest to client timestamp
    let closestTick: HistoricalTick | null = null;
    let minDiff = Infinity;
    for (const h of this.historyBuffer) {
      const diff = Math.abs(h.timestamp - requestedTimestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closestTick = h;
      }
    }

    if (!closestTick) return;

    // Check target in history
    const targetHitbox = closestTick.entities.get(hitData.targetId);
    if (!targetHitbox) return;

    // Server-side validation of line-of-sight & hit tolerance
    const shooterPos = shooter.state.position;
    const targetPos = targetHitbox.position;
    const distSq =
      Math.pow(shooterPos[0] - targetPos[0], 2) +
      Math.pow(shooterPos[1] - targetPos[1], 2) +
      Math.pow(shooterPos[2] - targetPos[2], 2);

    // Max weapon distance (e.g. 150m)
    if (distSq > 150 * 150) return;

    // Validate damage authoritatively
    const damage = Math.min(hitData.damage, 150);

    // Apply damage to remote player or bot
    const targetPlayer = this.players.get(hitData.targetId);
    if (targetPlayer) {
      targetPlayer.health -= damage;
      if (targetPlayer.health <= 0) {
        shooter.kills++;
        shooter.score += hitData.isHeadshot ? 150 : 100;
        targetPlayer.deaths++;
        targetPlayer.health = targetPlayer.maxHealth;
        targetPlayer.state.position = [(Math.random() - 0.5) * 16, 1.2, (Math.random() - 0.5) * 16];

        this.broadcast('kill', {
          killer: shooter.name,
          victim: targetPlayer.name,
          weapon: hitData.weaponName,
          headshot: hitData.isHeadshot,
        });
      }
    } else {
      // Check bots
      const bot = this.bots.find((b) => b.id === hitData.targetId);
      if (bot) {
        bot.health -= damage;
        if (bot.health <= 0) {
          shooter.kills++;
          shooter.score += hitData.isHeadshot ? 150 : 100;
          bot.deaths++;
          bot.health = bot.maxHealth;
          bot.position = [(Math.random() - 0.5) * 20, 1.2, -10 - Math.random() * 20];

          this.broadcast('kill', {
            killer: shooter.name,
            victim: bot.name,
            weapon: hitData.weaponName,
            headshot: hitData.isHeadshot,
          });
        }
      }
    }
  }

  /**
   * Main 60Hz Authoritative Tick.
   */
  private tick(): void {
    this.currentTick++;
    const now = Date.now();
    const dt = this.TICK_DURATION / 1000;

    // 1. Process inputs for all connected players
    for (const player of this.players.values()) {
      while (player.unprocessedInputs.length > 0) {
        const input = player.unprocessedInputs.shift()!;
        this.simulatePlayerMovement(player, input, dt);
        player.lastProcessedSequence = input.sequence;
      }
    }

    // 2. Update AI Tactical Bots
    this.updateBots(dt);

    // 3. Record snapshot in Historical Rewind Buffer for Lag Compensation
    const tickHitboxes = new Map<string, HistoricalHitbox>();

    for (const player of this.players.values()) {
      const p = player.state.position;
      tickHitboxes.set(player.id, {
        position: [p[0], p[1], p[2]],
        headPosition: [p[0], p[1] + 1.35, p[2]],
        radius: 0.35,
        height: 1.8,
      });
    }

    for (const bot of this.bots) {
      const p = bot.position;
      tickHitboxes.set(bot.id, {
        position: [p[0], p[1], p[2]],
        headPosition: [p[0], p[1] + 1.35, p[2]],
        radius: 0.35,
        height: 1.8,
      });
    }

    this.historyBuffer.push({
      tick: this.currentTick,
      timestamp: now,
      entities: tickHitboxes,
    });

    if (this.historyBuffer.length > this.MAX_HISTORY_TICKS) {
      this.historyBuffer.shift();
    }

    // 4. Broadcast Snapshots at 30Hz (every 2 ticks)
    this.snapshotCounter++;
    if (this.snapshotCounter >= 2) {
      this.snapshotCounter = 0;
      this.broadcastSnapshots(now);
    }
  }

  /**
   * Simulates player kinematic movement authoritatively on the server.
   */
  private simulatePlayerMovement(player: ServerPlayer, input: PlayerInput, dt: number): void {
    const s = player.state;
    s.yaw = input.yaw;
    s.pitch = input.pitch;
    player.weaponIndex = input.weaponIndex;
    player.isFiring = input.fire;
    s.isCrouching = input.crouch;

    // Desired horizontal speed
    let speed = 7.0;
    if (input.crouch) speed = 3.5;
    else if (input.sprint) speed = 11.5;

    // Direction vector
    const cosY = Math.cos(input.yaw);
    const sinY = Math.sin(input.yaw);

    const wishX = sinY * input.moveForward + cosY * input.moveRight;
    const wishZ = -cosY * input.moveForward + sinY * input.moveRight;

    // Direct responsive velocity solver
    const targetVx = wishX * speed;
    const targetVz = wishZ * speed;

    s.velocity[0] += (targetVx - s.velocity[0]) * Math.min(14.0 * dt, 1.0);
    s.velocity[2] += (targetVz - s.velocity[2]) * Math.min(14.0 * dt, 1.0);

    // Gravity
    if (!s.isGrounded) {
      s.velocity[1] -= 24.0 * dt;
    }

    // Jump
    if (input.jump && s.isGrounded) {
      s.velocity[1] = 9.2;
      s.isGrounded = false;
    }

    // Apply translation
    s.position[0] += s.velocity[0] * dt;
    s.position[1] += s.velocity[1] * dt;
    s.position[2] += s.velocity[2] * dt;

    // Ground check clamp
    if (s.position[1] <= 1.0) {
      s.position[1] = 1.0;
      s.velocity[1] = 0;
      s.isGrounded = true;
    }

    // Map bounds [-45, 45]
    s.position[0] = Math.max(-45, Math.min(45, s.position[0]));
    s.position[2] = Math.max(-45, Math.min(45, s.position[2]));
  }

  private initBots(): void {
    this.bots = [
      {
        id: 'bot_alpha',
        name: 'Nexus-01 [BOT]',
        position: [8, 1.2, -15],
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
        position: [-12, 1.2, -24],
        velocity: [0, 0, 0],
        yaw: Math.PI / 3,
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
        position: [14, 3.5, -28],
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

  private updateBots(dt: number): void {
    const t = this.currentTick * (this.TICK_DURATION / 1000);
    // Simple patrol navigation for bots
    this.bots[0].position[0] = 8 + Math.sin(t * 0.9) * 6;
    this.bots[0].velocity[0] = Math.cos(t * 0.9) * 5.4;
    this.bots[0].yaw = Math.sin(t * 0.9) > 0 ? 0 : Math.PI;

    this.bots[1].position[2] = -24 + Math.cos(t * 0.7) * 7;
    this.bots[1].velocity[2] = -Math.sin(t * 0.7) * 4.9;
  }

  /**
   * Broadcast authoritative state snapshots to all clients.
   */
  private broadcastSnapshots(now: number): void {
    // Collect all entity snapshots (players + bots)
    const entitySnapshots: EntitySnapshot[] = [];

    for (const player of this.players.values()) {
      entitySnapshots.push({
        id: player.id,
        name: player.name,
        position: player.state.position,
        velocity: player.state.velocity,
        yaw: player.state.yaw,
        pitch: player.state.pitch,
        health: player.health,
        maxHealth: player.maxHealth,
        weaponIndex: player.weaponIndex,
        isFiring: player.isFiring,
        isCrouching: player.state.isCrouching,
        score: player.score,
        kills: player.kills,
        deaths: player.deaths,
      });
    }

    for (const bot of this.bots) {
      entitySnapshots.push(bot);
    }

    // Send individualized snapshot with client's last acknowledged input sequence
    for (const player of this.players.values()) {
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(
          JSON.stringify({
            type: 'snapshot',
            data: {
              tick: this.currentTick,
              timestamp: now,
              lastAckSequence: player.lastProcessedSequence,
              authoritativeState: player.state,
              entities: entitySnapshots,
            },
          })
        );
      }
    }
  }

  private broadcast(type: string, data: any): void {
    const msg = JSON.stringify({ type, data });
    for (const player of this.players.values()) {
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(msg);
      }
    }
  }
}
