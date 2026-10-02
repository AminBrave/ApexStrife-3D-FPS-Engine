/**
 * Strongly typed EventBus for decoupled module communication in the FPS engine.
 */

export type EventCallback<T = any> = (data: T) => void;

export interface EventPayloads {
  // Player events
  'player:jump': { velocity: number };
  'player:land': { impactSpeed: number };
  'player:step': { isSprinting: boolean };
  'player:crouch': { isCrouching: boolean };
  'player:damaged': { amount: number; sourceId?: string; direction?: [number, number, number] };
  'player:killed': { killerId: string; weaponName: string; isHeadshot: boolean };
  'player:respawn': { position: [number, number, number] };

  // Weapon events
  'weapon:fire': {
    weaponId: string;
    weaponName: string;
    ammoRemaining: number;
    origin: [number, number, number];
    direction: [number, number, number];
    spread: number;
  };
  'weapon:hit': {
    targetId: string;
    damage: number;
    isHeadshot: boolean;
    point: [number, number, number];
    normal: [number, number, number];
  };
  'weapon:reload:start': { weaponId: string; duration: number };
  'weapon:reload:finish': { weaponId: string; ammo: number };
  'weapon:switch': { fromId: string; toId: string; toName: string };
  'weapon:ads:toggle': { isAiming: boolean };
  'weapon:empty': { weaponId: string };

  // Netcode events
  'net:connected': { clientId: string; ping: number };
  'net:disconnected': { reason: string };
  'net:snapshot': { tick: number; entityCount: number };
  'net:reconciled': { errorMagnitude: number; resimulatedTicks: number };
  'net:stats': { ping: number; loss: number; fps: number; rollbackCount: number };
  'net:killfeed': { killer: string; victim: string; weapon: string; headshot: boolean };

  // Camera & FX events
  'camera:shake': { intensity: number; decay: number };
  'camera:fov': { fov: number; duration: number };
}

export type EventKey = keyof EventPayloads;

export class EventBus {
  private static instance: EventBus;
  private listeners: Map<string, Set<EventCallback>> = new Map();

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  public on<K extends EventKey>(event: K, callback: EventCallback<EventPayloads[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(callback as EventCallback);

    return () => {
      set.delete(callback as EventCallback);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  public off<K extends EventKey>(event: K, callback: EventCallback<EventPayloads[K]>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(callback as EventCallback);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  public emit<K extends EventKey>(event: K, payload: EventPayloads[K]): void {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((cb) => {
        try {
          cb(payload);
        } catch (err) {
          console.error(`[EventBus] Error in listener for event '${event}':`, err);
        }
      });
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}

export const eventBus = EventBus.getInstance();
