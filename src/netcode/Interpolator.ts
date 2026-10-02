/**
 * Interpolator.ts
 * Snapshot ring buffer and remote mesh interpolation system.
 * Smoothly interpolates remote players using timestamped snapshots and slerp/lerp transforms.
 */

import * as THREE from 'three';

export interface EntitySnapshot {
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

export interface TimestampedSnapshot {
  timestamp: number; // Server timestamp in milliseconds
  snapshot: EntitySnapshot;
}

export class RemoteEntityProxy {
  public id: string;
  public name: string;
  public group: THREE.Group;
  public headMesh: THREE.Mesh;
  public bodyMesh: THREE.Mesh;
  public weaponMesh: THREE.Mesh;

  public snapshots: TimestampedSnapshot[] = [];
  public currentHealth: number = 100;
  public maxHealth: number = 100;

  constructor(id: string, name: string, scene: THREE.Scene) {
    this.id = id;
    this.name = name;

    this.group = new THREE.Group();

    // Body (Capsule/Box)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xdd3333,
      metalness: 0.5,
      roughness: 0.4,
    });
    this.bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.1, 0.35), bodyMat);
    this.bodyMesh.position.y = 0.55;
    this.bodyMesh.castShadow = true;
    (this.bodyMesh as any).userData = { id, type: 'remote_player', part: 'body' };
    this.group.add(this.bodyMesh);

    // Head (Sphere/Box with separate headshot hit detection)
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xffaa88,
      metalness: 0.2,
      roughness: 0.6,
    });
    this.headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), headMat);
    this.headMesh.position.set(0, 1.35, 0);
    this.headMesh.castShadow = true;
    (this.headMesh as any).userData = { id, type: 'remote_player', part: 'head' };
    this.group.add(this.headMesh);

    // Visor
    const visorMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.12), visorMat);
    visor.position.set(0, 1.36, -0.16);
    this.group.add(visor);

    // Weapon representation
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8 });
    this.weaponMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.45), gunMat);
    this.weaponMesh.position.set(0.24, 0.95, -0.3);
    this.group.add(this.weaponMesh);

    scene.add(this.group);
  }

  public pushSnapshot(timestamp: number, snapshot: EntitySnapshot): void {
    this.snapshots.push({ timestamp, snapshot });
    this.currentHealth = snapshot.health;
    this.maxHealth = snapshot.maxHealth;

    // Keep buffer around 30 snapshots (~1-2 seconds of data)
    if (this.snapshots.length > 30) {
      this.snapshots.shift();
    }
  }

  public update(renderTime: number): void {
    if (this.snapshots.length === 0) return;

    // If only one snapshot, snap to it
    if (this.snapshots.length === 1) {
      const s = this.snapshots[0].snapshot;
      this.group.position.set(s.position[0], s.position[1], s.position[2]);
      this.group.rotation.y = s.yaw;
      return;
    }

    // Find two snapshots surrounding renderTime
    let olderIdx = -1;
    for (let i = 0; i < this.snapshots.length - 1; i++) {
      if (
        this.snapshots[i].timestamp <= renderTime &&
        this.snapshots[i + 1].timestamp >= renderTime
      ) {
        olderIdx = i;
        break;
      }
    }

    if (olderIdx !== -1) {
      // Interpolate between older and newer snapshot
      const s0 = this.snapshots[olderIdx];
      const s1 = this.snapshots[olderIdx + 1];
      const timeDiff = s1.timestamp - s0.timestamp;
      const alpha = timeDiff > 0 ? (renderTime - s0.timestamp) / timeDiff : 0;

      const p0 = s0.snapshot.position;
      const p1 = s1.snapshot.position;

      // Position Lerp
      this.group.position.set(
        THREE.MathUtils.lerp(p0[0], p1[0], alpha),
        THREE.MathUtils.lerp(p0[1], p1[1], alpha),
        THREE.MathUtils.lerp(p0[2], p1[2], alpha)
      );

      // Yaw Slerp / Angular lerp
      this.group.rotation.y = lerpAngle(s0.snapshot.yaw, s1.snapshot.yaw, alpha);

      // Crouch height
      const isCrouching = s1.snapshot.isCrouching;
      this.bodyMesh.scale.y = isCrouching ? 0.65 : 1.0;
      this.headMesh.position.y = isCrouching ? 0.95 : 1.35;
    } else {
      // Extrapolate from newest snapshot using velocity
      const latest = this.snapshots[this.snapshots.length - 1];
      const s = latest.snapshot;
      const dt = Math.min((renderTime - latest.timestamp) / 1000, 0.1); // Max 100ms extrapolation

      this.group.position.set(
        s.position[0] + s.velocity[0] * dt,
        s.position[1] + s.velocity[1] * dt,
        s.position[2] + s.velocity[2] * dt
      );
      this.group.rotation.y = s.yaw;
    }
  }

  public destroy(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.bodyMesh.geometry.dispose();
    this.headMesh.geometry.dispose();
    this.weaponMesh.geometry.dispose();
  }
}

export class Interpolator {
  private remoteProxies: Map<string, RemoteEntityProxy> = new Map();
  private scene: THREE.Scene;
  public interpolationDelayMs: number = 80; // 80ms buffer offset

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public handleSnapshot(timestamp: number, entities: EntitySnapshot[], localPlayerId: string): void {
    const activeIds = new Set<string>();

    for (const ent of entities) {
      if (ent.id === localPlayerId) continue; // Skip local player (handled by client prediction)

      activeIds.add(ent.id);
      let proxy = this.remoteProxies.get(ent.id);
      if (!proxy) {
        proxy = new RemoteEntityProxy(ent.id, ent.name, this.scene);
        this.remoteProxies.set(ent.id, proxy);
      }
      proxy.pushSnapshot(timestamp, ent);
    }

    // Clean up entities that left or were despawned
    for (const [id, proxy] of this.remoteProxies.entries()) {
      if (!activeIds.has(id)) {
        proxy.destroy(this.scene);
        this.remoteProxies.delete(id);
      }
    }
  }

  public update(serverTimeMs: number): void {
    const renderTime = serverTimeMs - this.interpolationDelayMs;
    for (const proxy of this.remoteProxies.values()) {
      proxy.update(renderTime);
    }
  }

  public getProxy(id: string): RemoteEntityProxy | undefined {
    return this.remoteProxies.get(id);
  }

  public getAllProxies(): RemoteEntityProxy[] {
    return Array.from(this.remoteProxies.values());
  }

  public clear(): void {
    for (const proxy of this.remoteProxies.values()) {
      proxy.destroy(this.scene);
    }
    this.remoteProxies.clear();
  }
}

/**
 * Shortest path angle lerp in radians.
 */
function lerpAngle(a: number, b: number, t: number): number {
  const diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  return a + diff * t;
}
