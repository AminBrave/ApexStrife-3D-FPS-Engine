import type { PlayerInput, PlayerState } from './StatePredictor';
import type { EntitySnapshot } from './Interpolator';
import type { WeaponId } from '../gameplay/WeaponDefinitions';

export interface ShotCommand {
  sequence: number;
  weaponId: WeaponId;
  origin: [number, number, number];
  directions: [number, number, number][];
  aimYaw: number;
  aimPitch: number;
  clientTime: number;
}

export interface ReloadCommand {
  sequence: number;
  weaponId: WeaponId;
}

export interface AuthoritativeCombatEvent {
  event: 'hit' | 'damage' | 'kill' | 'respawn';
  shooterId?: string;
  targetId?: string;
  damage?: number;
  headshot?: boolean;
  weaponId?: WeaponId;
  position?: [number, number, number];
}

export interface NetMessage<T = unknown> {
  type: 'join' | 'welcome' | 'input' | 'shot' | 'reload' | 'snapshot' | 'combat' | 'kill' | 'ping' | 'pong' | 'player_join' | 'player_leave';
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
  health: number;
  maxHealth: number;
  weaponId: WeaponId;
  ammoInMag: Record<WeaponId, number>;
  ammoInReserve: Record<WeaponId, number>;
  reloadUntil: number;
  entities: EntitySnapshot[];
}

export type { PlayerInput, PlayerState, EntitySnapshot };
