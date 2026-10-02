import { WebSocket, WebSocketServer } from 'ws';
import { ServerPhysics } from './ServerPhysics';
import { PlayerInput, PlayerState } from '../netcode/StatePredictor';
import type { EntitySnapshot } from '../netcode/Interpolator';
import type { ShotCommand, ReloadCommand } from '../netcode/Protocol';
import { WEAPONS, weaponIdFromIndex, type WeaponId } from '../gameplay/WeaponDefinitions';
import { stepHorizontalVelocity } from '../gameplay/MovementSimulation';
import { ARENA_SPAWNS } from '../world/ArenaDefinition';

interface HistoricalHitbox {
  position: [number, number, number];
  headPosition: [number, number, number];
}

interface HistoricalTick {
  tick: number;
  timestamp: number;
  entities: Map<string, HistoricalHitbox>;
}

interface ServerPlayer {
  id: string;
  name: string;
  ws: WebSocket;
  state: PlayerState;
  lastProcessedSequence: number;
  unprocessedInputs: PlayerInput[];
  health: number;
  shield: number;
  maxHealth: number;
  maxShield: number;
  score: number;
  kills: number;
  deaths: number;
  weaponId: WeaponId;
  ammoInMag: Record<WeaponId, number>;
  ammoInReserve: Record<WeaponId, number>;
  reloadUntil: number;
  lastShotAt: number;
  deadUntil: number;
  coyoteTimer: number;
  jumpCooldown: number;
  jumpWasDown: boolean;
}

interface ServerBot {
  id: string;
  name: string;
  position: [number, number, number];
  velocity: [number, number, number];
  yaw: number;
  pitch: number;
  health: number;
  maxHealth: number;
  weaponIndex: number;
  isFiring: boolean;
  isCrouching: boolean;
  score: number;
  kills: number;
  deaths: number;
}

interface Projectile {
  ownerId: string;
  position: [number, number, number];
  velocity: [number, number, number];
  damage: number;
  radius: number;
  expiresAt: number;
}

const TICK_RATE = 60;
const DT = 1 / TICK_RATE;
const MAX_INPUT_QUEUE = 8;
const MAX_SHOT_REWIND_MS = 250;
const MAX_SHOT_DISTANCE = 300;
const PLAYER_EYE_HEIGHT = 1.65;
const WORLD_RECOVERY_Y = -8;
const BODY_CENTER_HEIGHT = 0.9;
const HEAD_HEIGHT = 1.35;
const HEAD_RADIUS = 0.23;
const BODY_RADIUS = 0.43;

export class GameServer {
  private wss: WebSocketServer | null = null;
  private players = new Map<string, ServerPlayer>();
  private bots: ServerBot[] = [];
  private projectiles: Projectile[] = [];
  private physics = new ServerPhysics();

  private currentTick = 0;
  private tickInterval: NodeJS.Timeout | null = null;
  private historyBuffer: HistoricalTick[] = [];
  private readonly maxHistoryTicks = 60;
  private snapshotCounter = 0;
  private initialized = false;

  constructor(wss?: WebSocketServer) {
    if (wss) this.attachWebSocketServer(wss);
    this.initBots();
  }

  public attachWebSocketServer(wss: WebSocketServer): void {
    this.wss = wss;
    this.wss.on('connection', ws => this.handleConnection(ws));
  }

  public async start(): Promise<void> {
    if (this.tickInterval) return;
    await this.physics.init();
    this.initialized = true;
    this.tickInterval = setInterval(() => this.tick(), 1000 / TICK_RATE);
    console.info('[GameServer] Authoritative 60Hz simulation started.');
  }

  public stop(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = null;
    this.physics.dispose();
    this.initialized = false;
  }

  private handleConnection(ws: WebSocket): void {
    if (!this.initialized) {
      ws.close(1013, 'Server is initializing');
      return;
    }

    const id = `p_${Math.random().toString(36).slice(2, 9)}`;
    const spawn = this.getSpawnPosition();
    const player: ServerPlayer = {
      id,
      name: `Player_${id.slice(2, 6)}`,
      ws,
      state: {
        position: spawn,
        velocity: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        isGrounded: true,
        isCrouching: false,
      },
      lastProcessedSequence: 0,
      unprocessedInputs: [],
      health: 100,
      shield: 50,
      maxHealth: 100,
      maxShield: 50,
      score: 0,
      kills: 0,
      deaths: 0,
      weaponId: 'ar',
      ammoInMag: { ar: 30, shotgun: 8, sniper: 5, plasma: 4 },
      ammoInReserve: { ar: 180, shotgun: 48, sniper: 25, plasma: 16 },
      reloadUntil: 0,
      lastShotAt: -Infinity,
      deadUntil: 0,
      coyoteTimer: 0,
      jumpCooldown: 0,
      jumpWasDown: false,
    };

    this.players.set(id, player);
    this.physics.addCharacter(id, spawn);

    this.send(player, 'welcome', {
      clientId: id,
      serverTick: this.currentTick,
      serverTime: Date.now(),
      spawnPosition: spawn,
    });
    this.broadcast('player_join', { id, name: player.name });

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; data: unknown };
        this.handlePlayerMessage(player, msg.type, msg.data);
      } catch {
        ws.close(1003, 'Invalid packet');
      }
    });

    ws.on('close', () => {
      this.players.delete(id);
      this.physics.removeCharacter(id);
      this.broadcast('player_leave', { id, name: player.name });
    });

    ws.on('error', () => {
      // close handler owns lifecycle cleanup
    });
  }

  private handlePlayerMessage(player: ServerPlayer, type: string, data: unknown): void {
    if (type === 'join') {
      const name = (data as { name?: unknown })?.name;
      if (typeof name === 'string') player.name = name.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16) || player.name;
      return;
    }

    if (type === 'input') {
      const input = this.validateInput(data);
      if (!input || input.sequence <= player.lastProcessedSequence) return;
      if (player.unprocessedInputs.length >= MAX_INPUT_QUEUE) player.unprocessedInputs.shift();
      player.unprocessedInputs.push(input);
      return;
    }

    if (type === 'shot') {
      this.handleShot(player, data);
      return;
    }

    if (type === 'reload') {
      this.handleReload(player, data);
      return;
    }

    if (type === 'ping') {
      this.send(player, 'pong', { serverTime: Date.now() });
    }
  }

  private validateInput(data: unknown): PlayerInput | null {
    if (!data || typeof data !== 'object') return null;
    const i = data as Partial<PlayerInput>;
    const nums = [i.sequence, i.timestamp, i.moveForward, i.moveRight, i.yaw, i.pitch];
    if (!nums.every(Number.isFinite)) return null;
    if (!Number.isInteger(i.sequence) || i.sequence < 0) return null;
    if (Math.abs(i.moveForward!) > 1 || Math.abs(i.moveRight!) > 1) return null;
    if (Math.abs(i.pitch!) > Math.PI / 2 + 0.01 || Math.abs(i.yaw!) > Math.PI * 1000) return null;
    return {
      sequence: i.sequence!,
      timestamp: i.timestamp!,
      moveForward: i.moveForward!,
      moveRight: i.moveRight!,
      jump: !!i.jump,
      sprint: !!i.sprint,
      crouch: !!i.crouch,
      yaw: i.yaw!,
      pitch: i.pitch!,
      fire: !!i.fire,
      reload: !!i.reload,
      weaponIndex: Number.isFinite(i.weaponIndex) ? Math.max(0, Math.min(3, Math.floor(i.weaponIndex!))) : 0,
    };
  }

  private handleReload(player: ServerPlayer, data: unknown): void {
    if (player.deadUntil > Date.now()) return;
    const cmd = data as Partial<ReloadCommand>;
    const weaponId = cmd.weaponId;
    if (!this.isWeaponId(weaponId) || player.weaponId !== weaponId) return;
    const weapon = WEAPONS[weaponId];
    if (player.reloadUntil > Date.now()) return;
    if (player.ammoInMag[weaponId] >= weapon.magazineSize || player.ammoInReserve[weaponId] <= 0) return;
    player.reloadUntil = Date.now() + weapon.reloadTime * 1000;
  }

  private handleShot(player: ServerPlayer, data: unknown): void {
    if (player.deadUntil > Date.now()) return;
    const shot = data as Partial<ShotCommand>;
    if (!this.isWeaponId(shot.weaponId)) return;
    if (player.weaponId !== shot.weaponId) return;
    if (!Array.isArray(shot.directions) || shot.directions.length === 0 || shot.directions.length > 8) return;

    const weapon = WEAPONS[shot.weaponId];
    const now = Date.now();
    if (player.reloadUntil > now) return;

    const fireInterval = 60000 / weapon.fireRate;
    if (now - player.lastShotAt < fireInterval * 0.9) return;
    if (player.ammoInMag[weapon.id] <= 0) return;

    const origin = this.validatedShotOrigin(player, shot.origin);
    const requestedTime = Number(shot.clientTime);
    const shotTime = Number.isFinite(requestedTime)
      ? Math.max(now - MAX_SHOT_REWIND_MS, Math.min(now, requestedTime))
      : now;

    player.lastShotAt = now;
    player.ammoInMag[weapon.id]--;

    if (weapon.kind === 'projectile') {
      const direction = this.normalizeDirection(shot.directions[0]);
      this.projectiles.push({
        ownerId: player.id,
        position: [origin[0] + direction[0] * 0.8, origin[1] + direction[1] * 0.8, origin[2] + direction[2] * 0.8],
        velocity: [direction[0] * (weapon.projectileSpeed || 52), direction[1] * (weapon.projectileSpeed || 52), direction[2] * (weapon.projectileSpeed || 52)],
        damage: weapon.damage,
        radius: weapon.splashRadius || 6.5,
        expiresAt: now + 4000,
      });
      return;
    }

    const historical = this.findHistoryAt(shotTime);
    if (!historical) return;

    for (const rawDirection of shot.directions) {
      const direction = this.normalizeDirection(rawDirection);
      const hit = this.resolveHitscan(player.id, origin, direction, historical, weapon.damage, weapon.headshotMultiplier);
      if (hit) {
        const damage = hit.headshot ? weapon.damage * weapon.headshotMultiplier : weapon.damage;
        this.applyDamage(player, hit.targetId, damage, hit.headshot, weapon.id, hit.position);
      }
    }
  }

  private resolveHitscan(
    shooterId: string,
    origin: [number, number, number],
    direction: [number, number, number],
    historical: HistoricalTick,
    damage: number,
    headshotMultiplier: number
  ): { targetId: string; headshot: boolean; position: [number, number, number] } | null {
    const wall = this.physics.raycast(origin, direction, MAX_SHOT_DISTANCE);
    const wallDistance = wall ? wall.timeOfImpact : MAX_SHOT_DISTANCE;

    let best: { targetId: string; headshot: boolean; distance: number; position: [number, number, number] } | null = null;
    for (const [targetId, box] of historical.entities) {
      if (targetId === shooterId) continue;

      const head = raySphere(origin, direction, box.headPosition, HEAD_RADIUS);
      const bodyCenter: [number, number, number] = [box.position[0], box.position[1] + BODY_CENTER_HEIGHT, box.position[2]];
      const body = raySphere(origin, direction, bodyCenter, BODY_RADIUS);
      const candidate = head && (!body || head.distance <= body.distance)
        ? { headshot: true, ...head }
        : body ? { headshot: false, ...body } : null;

      if (!candidate || candidate.distance > wallDistance) continue;
      if (!best || candidate.distance < best.distance) {
        best = { targetId, headshot: candidate.headshot, distance: candidate.distance, position: candidate.position };
      }
    }

    return best ? { targetId: best.targetId, headshot: best.headshot, position: best.position } : null;
  }

  private applyDamage(
    shooter: ServerPlayer,
    targetId: string,
    rawDamage: number,
    headshot: boolean,
    weaponId: WeaponId,
    position: [number, number, number]
  ): void {
    const targetPlayer = this.players.get(targetId);
    const targetBot = this.bots.find(b => b.id === targetId);
    if (!targetPlayer && !targetBot) return;

    this.send(shooter, 'combat', { event: 'hit', shooterId: shooter.id, targetId, damage: rawDamage, headshot, weaponId, position });

    if (targetBot) {
      targetBot.health = Math.max(0, targetBot.health - rawDamage);
      if (targetBot.health <= 0) {
        targetBot.deaths++;
        shooter.kills++;
        shooter.score += headshot ? 150 : 100;
        targetBot.health = targetBot.maxHealth;
        this.broadcast('kill', { killer: shooter.name, victim: targetBot.name, weapon: weaponId, headshot });
      }
      return;
    }

    if (!targetPlayer || targetPlayer.deadUntil > Date.now()) return;

    let damage = Math.max(0, Math.min(rawDamage, 150));
    const shieldDamage = Math.min(targetPlayer.shield, damage * 0.65);
    targetPlayer.shield -= shieldDamage;
    damage -= shieldDamage;
    targetPlayer.health = Math.max(0, targetPlayer.health - damage);

    this.send(targetPlayer, 'combat', { event: 'damage', shooterId: shooter.id, targetId, damage: rawDamage, headshot, weaponId, position });

    if (targetPlayer.health > 0) return;

    targetPlayer.deaths++;
    shooter.kills++;
    shooter.score += headshot ? 150 : 100;
    targetPlayer.deadUntil = Date.now() + 3000;
    this.broadcast('combat', { event: 'kill', shooterId: shooter.id, targetId, weaponId, headshot, position });
    this.broadcast('kill', {
      killer: shooter.name,
      victim: targetPlayer.name,
      weapon: WEAPONS[weaponId].id,
      headshot,
    });

    setTimeout(() => {
      const live = this.players.get(targetId);
      if (!live || live.deadUntil === 0 || live.deadUntil > Date.now()) return;
      const spawn = this.getSpawnPosition();
      live.health = live.maxHealth;
      live.shield = live.maxShield;
      live.deadUntil = 0;
      live.state.position = spawn;
      live.state.velocity = [0, 0, 0];
      live.state.isGrounded = true;
      this.physics.setCharacterPosition(live.id, spawn);
      this.send(live, 'combat', { event: 'respawn', targetId: live.id, position: spawn });
    }, 3050);
  }

  private updateMovement(player: ServerPlayer, input: PlayerInput): void {
    const s = player.state;
    s.yaw = input.yaw;
    s.pitch = input.pitch;
    s.isCrouching = input.crouch;
    player.weaponId = weaponIdFromIndex(input.weaponIndex);

    if (player.deadUntil > Date.now()) return;

    if (s.isGrounded) player.coyoteTimer = 0.12;
    else player.coyoteTimer = Math.max(0, player.coyoteTimer - DT);

    stepHorizontalVelocity(s, input, DT);

    if (s.isGrounded) {
      if (s.velocity[1] < 0) s.velocity[1] = -0.5;
    } else {
      s.velocity[1] = Math.max(-45, s.velocity[1] - 24 * DT);
    }

    player.jumpCooldown = Math.max(0, player.jumpCooldown - DT);
    const jumpPressed = input.jump && !player.jumpWasDown;
    player.jumpWasDown = input.jump;
    if (jumpPressed && (s.isGrounded || player.coyoteTimer > 0) && player.jumpCooldown <= 0) {
      s.velocity[1] = 9.2;
      s.isGrounded = false;
      player.coyoteTimer = 0;
      player.jumpCooldown = 0.2;
    }

    const movement = {
      x: s.velocity[0] * DT,
      y: s.velocity[1] * DT,
      z: s.velocity[2] * DT,
    };
    const moved = this.physics.moveCharacter(player.id, movement as any);

    const outsideWorld = !Number.isFinite(moved.position.x) || !Number.isFinite(moved.position.y) || !Number.isFinite(moved.position.z)
      || moved.position.y < WORLD_RECOVERY_Y
      || Math.abs(moved.position.x) > 48
      || Math.abs(moved.position.z) > 48;

    if (outsideWorld) {
      const recovery = this.getSpawnPosition();
      this.physics.setCharacterPosition(player.id, recovery);
      s.position = recovery;
      s.velocity = [0, 0, 0];
      s.isGrounded = true;
    } else {
      s.position = [moved.position.x, moved.position.y, moved.position.z];
      s.isGrounded = moved.grounded;
    }
    if (s.isGrounded && s.velocity[1] < 0) s.velocity[1] = 0;
  }

  private tick(): void {
    if (!this.initialized) return;
    this.currentTick++;
    const now = Date.now();

    for (const player of this.players.values()) {
      let processed = 0;
      while (player.unprocessedInputs.length && processed < 4) {
        const input = player.unprocessedInputs.shift()!;
        if (input.sequence <= player.lastProcessedSequence) continue;
        this.updateMovement(player, input);
        player.lastProcessedSequence = input.sequence;
        processed++;
      }

      if (player.reloadUntil > 0 && player.reloadUntil <= now) {
        const weapon = WEAPONS[player.weaponId];
        const needed = weapon.magazineSize - player.ammoInMag[player.weaponId];
        const load = Math.min(needed, player.ammoInReserve[player.weaponId]);
        player.ammoInMag[player.weaponId] += load;
        player.ammoInReserve[player.weaponId] -= load;
        player.reloadUntil = 0;
      }
    }

    // Commit all kinematic transforms and refresh Rapier's broad-phase/query pipeline
    // before projectile raycasts and the next controller tick.
    this.physics.step();

    this.updateBots();
    this.updateProjectiles(now);

    const entities = new Map<string, HistoricalHitbox>();
    for (const p of this.players.values()) {
      entities.set(p.id, {
        position: [...p.state.position],
        headPosition: [p.state.position[0], p.state.position[1] + HEAD_HEIGHT, p.state.position[2]],
      });
    }
    for (const b of this.bots) {
      entities.set(b.id, {
        position: [...b.position],
        headPosition: [b.position[0], b.position[1] + HEAD_HEIGHT, b.position[2]],
      });
    }

    this.historyBuffer.push({ tick: this.currentTick, timestamp: now, entities });
    if (this.historyBuffer.length > this.maxHistoryTicks) this.historyBuffer.shift();

    if (++this.snapshotCounter >= 2) {
      this.snapshotCounter = 0;
      this.broadcastSnapshots(now);
    }
  }

  private updateBots(): void {
    const t = this.currentTick * DT;
    this.bots[0].position[0] = 8 + Math.sin(t * 0.9) * 6;
    this.bots[0].velocity[0] = Math.cos(t * 0.9) * 5.4;
    this.bots[0].yaw = Math.sin(t * 0.9) > 0 ? 0 : Math.PI;
    this.bots[1].position[2] = -24 + Math.cos(t * 0.7) * 7;
    this.bots[1].velocity[2] = -Math.sin(t * 0.7) * 4.9;
  }

  private updateProjectiles(now: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const previous = [...p.position] as [number, number, number];
      p.velocity[1] -= 12 * DT;
      p.position[0] += p.velocity[0] * DT;
      p.position[1] += p.velocity[1] * DT;
      p.position[2] += p.velocity[2] * DT;

      const dx = p.position[0] - previous[0], dy = p.position[1] - previous[1], dz = p.position[2] - previous[2];
      const distance = Math.hypot(dx, dy, dz);
      let impacted = false;
      if (distance > 0.001) {
        const hit = this.physics.raycast(previous, [dx / distance, dy / distance, dz / distance], distance);
        impacted = !!hit;
      }

      if (impacted || now >= p.expiresAt) {
        this.explodeProjectile(p);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private explodeProjectile(p: Projectile): void {
    const radius = p.radius;
    const targets: Array<{ id: string; position: [number, number, number]; apply: (d: number) => void }> = [];

    for (const target of this.players.values()) {
      if (target.id === p.ownerId || target.deadUntil > Date.now()) continue;
      targets.push({ id: target.id, position: target.state.position, apply: d => this.applyDamageToEntity(p.ownerId, target.id, d, false, 'plasma') });
    }
    for (const bot of this.bots) {
      targets.push({ id: bot.id, position: bot.position, apply: d => this.applyDamageToBot(p.ownerId, bot, d) });
    }

    for (const target of targets) {
      const dx = target.position[0] - p.position[0];
      const dy = target.position[1] - p.position[1];
      const dz = target.position[2] - p.position[2];
      const distance = Math.hypot(dx, dy, dz);
      if (distance > radius) continue;
      const falloff = 1 - distance / radius;
      if (falloff <= 0) continue;
      target.apply(110 * falloff);
    }
  }

  private applyDamageToEntity(ownerId: string, targetId: string, damage: number, headshot: boolean, weaponId: WeaponId): void {
    const shooter = this.players.get(ownerId);
    const target = this.players.get(targetId);
    if (!shooter || !target || target.deadUntil > Date.now()) return;
    this.applyDamage(shooter, targetId, damage, headshot, weaponId, target.state.position);
  }

  private applyDamageToBot(ownerId: string, bot: ServerBot, damage: number): void {
    const shooter = this.players.get(ownerId);
    if (!shooter) return;
    bot.health = Math.max(0, bot.health - damage);
    this.send(shooter, 'combat', { event: 'hit', shooterId: shooter.id, targetId: bot.id, damage, headshot: false, weaponId: 'plasma', position: bot.position });
    if (bot.health > 0) return;
    bot.deaths++;
    shooter.kills++;
    shooter.score += 100;
    bot.health = bot.maxHealth;
    this.broadcast('kill', { killer: shooter.name, victim: bot.name, weapon: 'plasma', headshot: false });
  }

  private findHistoryAt(timestamp: number): HistoricalTick | null {
    let best: HistoricalTick | null = null;
    for (const h of this.historyBuffer) {
      if (h.timestamp <= timestamp) best = h;
    }
    return best || this.historyBuffer[0] || null;
  }

  private validatedShotOrigin(player: ServerPlayer, requested: unknown): [number, number, number] {
    const eye: [number, number, number] = [
      player.state.position[0],
      player.state.position[1] + PLAYER_EYE_HEIGHT,
      player.state.position[2],
    ];
    if (!Array.isArray(requested) || requested.length !== 3 || !requested.every(Number.isFinite)) return eye;
    const distance = Math.hypot(requested[0] - eye[0], requested[1] - eye[1], requested[2] - eye[2]);
    return distance <= 1.5 ? [requested[0], requested[1], requested[2]] : eye;
  }

  private normalizeDirection(raw: unknown): [number, number, number] {
    const a = Array.isArray(raw) && raw.length === 3 ? raw.map(Number) : [0, 0, -1];
    const length = Math.hypot(a[0], a[1], a[2]);
    if (!Number.isFinite(length) || length < 0.001) return [0, 0, -1];
    return [a[0] / length, a[1] / length, a[2] / length];
  }

  private isWeaponId(value: unknown): value is WeaponId {
    return value === 'ar' || value === 'shotgun' || value === 'sniper' || value === 'plasma';
  }

  private getSpawnPosition(): [number, number, number] {
    const n = this.players.size % 6;
    return ARENA_SPAWNS[n];
  }

  private initBots(): void {
    this.bots = [
      { id:'bot_alpha', name:'Nexus-01 [BOT]', position:[8,1.2,-15], velocity:[0,0,0], yaw:0, pitch:0, health:100, maxHealth:100, weaponIndex:0, isFiring:false, isCrouching:false, score:300, kills:2, deaths:1 },
      { id:'bot_bravo', name:'Viper-02 [BOT]', position:[-12,1.2,-24], velocity:[0,0,0], yaw:Math.PI/3, pitch:0, health:100, maxHealth:100, weaponIndex:1, isFiring:false, isCrouching:false, score:450, kills:3, deaths:0 },
      { id:'bot_charlie', name:'Ghost-03 [BOT]', position:[14,3.5,-28], velocity:[0,0,0], yaw:-Math.PI/2, pitch:0, health:100, maxHealth:100, weaponIndex:2, isFiring:false, isCrouching:false, score:150, kills:1, deaths:2 },
    ];
  }

  private broadcastSnapshots(now: number): void {
    const entities: EntitySnapshot[] = [];
    for (const p of this.players.values()) {
      entities.push({
        id:p.id,name:p.name,position:p.state.position,velocity:p.state.velocity,yaw:p.state.yaw,pitch:p.state.pitch,
        health:p.health,maxHealth:p.maxHealth,weaponIndex:Object.keys(WEAPONS).indexOf(p.weaponId),isFiring:false,isCrouching:p.state.isCrouching,
        score:p.score,kills:p.kills,deaths:p.deaths,
      });
    }
    for (const b of this.bots) {
      entities.push({
        id:b.id,name:b.name,position:b.position,velocity:b.velocity,yaw:b.yaw,pitch:b.pitch,health:b.health,maxHealth:b.maxHealth,
        weaponIndex:b.weaponIndex,isFiring:b.isFiring,isCrouching:b.isCrouching,score:b.score,kills:b.kills,deaths:b.deaths,
      });
    }

    for (const p of this.players.values()) {
      this.send(p, 'snapshot', {
        tick:this.currentTick,timestamp:now,lastAckSequence:p.lastProcessedSequence,authoritativeState:p.state,
        health:p.health,maxHealth:p.maxHealth,entities,
      });
    }
  }

  private send<T>(player: ServerPlayer, type: string, data: T): void {
    if (player.ws.readyState === WebSocket.OPEN && player.ws.bufferedAmount < 256 * 1024) {
      player.ws.send(JSON.stringify({ type, data }));
    }
  }

  private broadcast<T>(type: string, data: T): void {
    for (const p of this.players.values()) this.send(p, type, data);
  }
}

function raySphere(
  origin: [number, number, number],
  direction: [number, number, number],
  center: [number, number, number],
  radius: number
): { distance: number; position: [number, number, number] } | null {
  const ox = origin[0] - center[0], oy = origin[1] - center[1], oz = origin[2] - center[2];
  const b = ox * direction[0] + oy * direction[1] + oz * direction[2];
  const c = ox*ox + oy*oy + oz*oz - radius*radius;
  const discriminant = b*b - c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const t = -b - root;
  const distance = t >= 0 ? t : -b + root;
  if (distance < 0) return null;
  return {
    distance,
    position: [
      origin[0] + direction[0] * distance,
      origin[1] + direction[1] * distance,
      origin[2] + direction[2] * distance,
    ],
  };
}
