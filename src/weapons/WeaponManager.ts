/**
 * WeaponManager.ts
 * Manages the weapon state machine (Idle, ADS, Firing, Reloading, Switching),
 * procedural viewmodel rendering, hitscan raycasting, physics projectiles,
 * bullet tracers, impact particles, ammo states, and audio triggers.
 */

import * as THREE from 'three';
import { RecoilSystem, RecoilProfile } from './RecoilSystem';
import { PhysicsEngine, CollisionGroup } from '../physics/PhysicsEngine';
import { soundSynth } from '../audio/SoundSynthesizer';
import { eventBus } from '../core/EventBus';
import { SURFACE_MATERIALS, type SurfaceMaterialId } from '../world/SurfaceMaterial';

export enum WeaponState {
  IDLE = 'IDLE',
  FIRING = 'FIRING',
  RELOADING = 'RELOADING',
  SWITCHING = 'SWITCHING',
}

export interface WeaponDef {
  id: string;
  name: string;
  type: 'hitscan' | 'projectile';
  damage: number;
  headshotMultiplier: number;
  fireRate: number; // Rounds per minute
  magSize: number;
  reserveAmmo: number;
  reloadTime: number; // Seconds
  switchTime: number; // Seconds
  pelletCount?: number;
  projectileSpeed?: number;
  splashRadius?: number;
  hipPos: THREE.Vector3;
  adsPos: THREE.Vector3;
  recoil: Partial<RecoilProfile>;
}

export interface ActiveProjectile {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  mesh: THREE.Mesh;
  damage: number;
  radius: number;
  lifetime: number;
}

export interface BulletTracer {
  line: THREE.Line;
  lifetime: number;
  maxLifetime: number;
}

export interface ImpactParticle {
  mesh: THREE.InstancedMesh;
  velocities: THREE.Vector3[];
  positions: THREE.Vector3[];
  lifetime: number;
  maxLifetime: number;
}

export class WeaponManager {
  public currentState: WeaponState = WeaponState.IDLE;
  public currentWeaponIndex: number = 0;
  public isAiming: boolean = false;

  public weapons: WeaponDef[] = [
    {
      id: 'ar',
      name: 'Valkyrie AR-9',
      type: 'hitscan',
      damage: 28,
      headshotMultiplier: 2.0,
      fireRate: 650,
      magSize: 30,
      reserveAmmo: 180,
      reloadTime: 1.8,
      switchTime: 0.35,
      hipPos: new THREE.Vector3(0.18, -0.19, -0.42),
      adsPos: new THREE.Vector3(0.0, -0.145, -0.32),
      recoil: {
        camPitchKick: 0.034,
        camPitchRandom: 0.012,
        camYawKick: 0.015,
        posKickback: new THREE.Vector3(0.003, 0.014, -0.06),
        rotKickback: new THREE.Vector3(0.06, 0.015, -0.01),
        springStiffness: 260,
        springDamping: 24,
        baseSpread: 0.007,
        maxSpread: 0.06,
        spreadPerShot: 0.011,
      },
    },
    {
      id: 'shotgun',
      name: 'Havoc 12-Gauge',
      type: 'hitscan',
      damage: 15, // x 8 pellets = 120 total max
      pelletCount: 8,
      headshotMultiplier: 1.5,
      fireRate: 110,
      magSize: 8,
      reserveAmmo: 48,
      reloadTime: 2.4,
      switchTime: 0.45,
      hipPos: new THREE.Vector3(0.19, -0.21, -0.45),
      adsPos: new THREE.Vector3(0.0, -0.155, -0.35),
      recoil: {
        camPitchKick: 0.09,
        camPitchRandom: 0.025,
        camYawKick: 0.03,
        posKickback: new THREE.Vector3(0.008, 0.03, -0.11),
        rotKickback: new THREE.Vector3(0.16, 0.03, -0.03),
        springStiffness: 220,
        springDamping: 20,
        baseSpread: 0.045,
        maxSpread: 0.11,
        spreadPerShot: 0.04,
      },
    },
    {
      id: 'sniper',
      name: 'Apex Precision .50',
      type: 'hitscan',
      damage: 95,
      headshotMultiplier: 2.5,
      fireRate: 48,
      magSize: 5,
      reserveAmmo: 25,
      reloadTime: 2.8,
      switchTime: 0.55,
      hipPos: new THREE.Vector3(0.19, -0.22, -0.48),
      adsPos: new THREE.Vector3(0.0, -0.138, -0.36),
      recoil: {
        camPitchKick: 0.13,
        camPitchRandom: 0.01,
        camYawKick: 0.02,
        posKickback: new THREE.Vector3(0.005, 0.045, -0.16),
        rotKickback: new THREE.Vector3(0.22, 0.02, -0.04),
        springStiffness: 200,
        springDamping: 18,
        baseSpread: 0.002,
        maxSpread: 0.09,
        spreadPerShot: 0.07,
      },
    },
    {
      id: 'plasma',
      name: 'Vortex Plasma Cannon',
      type: 'projectile',
      damage: 110,
      headshotMultiplier: 1.0,
      fireRate: 85,
      magSize: 4,
      reserveAmmo: 16,
      reloadTime: 2.6,
      switchTime: 0.5,
      projectileSpeed: 52,
      splashRadius: 6.5,
      hipPos: new THREE.Vector3(0.2, -0.21, -0.44),
      adsPos: new THREE.Vector3(0.0, -0.15, -0.34),
      recoil: {
        camPitchKick: 0.075,
        camPitchRandom: 0.02,
        camYawKick: 0.02,
        posKickback: new THREE.Vector3(0.006, 0.035, -0.12),
        rotKickback: new THREE.Vector3(0.14, 0.02, -0.02),
        springStiffness: 230,
        springDamping: 21,
        baseSpread: 0.01,
        maxSpread: 0.04,
        spreadPerShot: 0.025,
      },
    },
  ];

  // Current ammo tracking per weapon
  public ammoInMag: number[] = [];
  public ammoInReserve: number[] = [];

  // Recoil system
  public recoilSystem: RecoilSystem;

  // Viewmodel
  private viewmodelScene: THREE.Scene;
  private viewmodelCamera: THREE.PerspectiveCamera;
  public viewmodelContainer: THREE.Group;
  private weaponMeshes: THREE.Group[] = [];

  // Muzzle flash
  private muzzleFlashMesh: THREE.Mesh;
  private muzzleFlashLight: THREE.PointLight;
  private muzzleFlashTimer: number = 0;

  // Timers
  private fireTimer: number = 0;
  private stateTimer: number = 0;
  private isTriggerHeld: boolean = false;
  private movementTimer: number = 0;

  // Visual effects
  private worldScene: THREE.Scene;
  private tracers: BulletTracer[] = [];
  private projectiles: ActiveProjectile[] = [];
  private impactSparks: { mesh: THREE.Points; velocities: THREE.Vector3[]; lifetime: number }[] = [];

  // Physics reference
  private physicsEngine: PhysicsEngine;

  constructor(
    viewmodelScene: THREE.Scene,
    viewmodelCamera: THREE.PerspectiveCamera,
    worldScene: THREE.Scene,
    physicsEngine: PhysicsEngine
  ) {
    this.viewmodelScene = viewmodelScene;
    this.viewmodelCamera = viewmodelCamera;
    this.worldScene = worldScene;
    this.physicsEngine = physicsEngine;

    // Initialize ammo pools
    this.weapons.forEach((w) => {
      this.ammoInMag.push(w.magSize);
      this.ammoInReserve.push(w.reserveAmmo);
    });

    this.recoilSystem = new RecoilSystem(this.weapons[0].recoil);

    // Setup viewmodel container attached to viewmodel camera
    this.viewmodelContainer = new THREE.Group();
    this.viewmodelCamera.add(this.viewmodelContainer);
    this.viewmodelScene.add(this.viewmodelCamera);

    // Create procedural 3D weapon meshes
    this.buildWeaponMeshes();

    // Muzzle flash
    const flashGeom = new THREE.DodecahedronGeometry(0.045);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xfff0aa, transparent: true, opacity: 0.9 });
    this.muzzleFlashMesh = new THREE.Mesh(flashGeom, flashMat);
    this.muzzleFlashMesh.visible = false;
    this.viewmodelContainer.add(this.muzzleFlashMesh);

    this.muzzleFlashLight = new THREE.PointLight(0xffaa44, 2.5, 6);
    this.muzzleFlashLight.visible = false;
    this.viewmodelContainer.add(this.muzzleFlashLight);

    this.showActiveWeaponMesh();
  }

  public get currentWeapon(): WeaponDef {
    return this.weapons[this.currentWeaponIndex];
  }

  public get currentMagAmmo(): number {
    return this.ammoInMag[this.currentWeaponIndex];
  }

  public get currentReserve(): number {
    return this.ammoInReserve[this.currentWeaponIndex];
  }

  /**
   * Generates procedural tactical sci-fi weapon models with metallic shaders and glowing conduits.
   */
  private buildWeaponMeshes(): void {
    // 1. Valkyrie AR-9
    const arGroup = new THREE.Group();
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1f2229, metalness: 0.85, roughness: 0.3 });
    const gunMetal = new THREE.MeshStandardMaterial({ color: 0x383d47, metalness: 0.7, roughness: 0.4 });
    const cyanGlow = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

    // Receiver
    const arReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.075, 0.32), darkMetal);
    arGroup.add(arReceiver);
    // Barrel
    const arBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.28, 12), gunMetal);
    arBarrel.rotation.x = Math.PI / 2;
    arBarrel.position.set(0, 0.015, -0.28);
    arGroup.add(arBarrel);
    // Muzzle brake
    const arMuzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.06, 10), darkMetal);
    arMuzzle.rotation.x = Math.PI / 2;
    arMuzzle.position.set(0, 0.015, -0.44);
    arGroup.add(arMuzzle);
    // Magazine
    const arMag = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.14, 0.07), darkMetal);
    arMag.position.set(0, -0.09, -0.06);
    arMag.rotation.x = 0.18;
    arGroup.add(arMag);
    // Holographic Reflex Sight
    const arSightBase = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.02, 0.1), darkMetal);
    arSightBase.position.set(0, 0.048, -0.05);
    arGroup.add(arSightBase);
    const arSightGlass = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.005), cyanGlow);
    arSightGlass.position.set(0, 0.065, -0.05);
    arGroup.add(arSightGlass);
    // Glowing accent line
    const arAccent = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.005, 0.22), cyanGlow);
    arAccent.position.set(0, 0.02, -0.08);
    arGroup.add(arAccent);

    arGroup.position.copy(this.weapons[0].hipPos);
    this.viewmodelContainer.add(arGroup);
    this.weaponMeshes.push(arGroup);

    // 2. Havoc 12-Gauge
    const sgGroup = new THREE.Group();
    const heavyMat = new THREE.MeshStandardMaterial({ color: 0x181a1f, metalness: 0.9, roughness: 0.25 });
    const orangeGlow = new THREE.MeshBasicMaterial({ color: 0xff5500 });
    // Heavy Receiver
    const sgBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.38), heavyMat);
    sgGroup.add(sgBody);
    // Dual Heavy Barrels
    const sgBarrel1 = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 12), gunMetal);
    sgBarrel1.rotation.x = Math.PI / 2;
    sgBarrel1.position.set(-0.016, 0.02, -0.32);
    sgGroup.add(sgBarrel1);
    const sgBarrel2 = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 12), gunMetal);
    sgBarrel2.rotation.x = Math.PI / 2;
    sgBarrel2.position.set(0.016, 0.02, -0.32);
    sgGroup.add(sgBarrel2);
    // Pump Grip
    const sgPump = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.16, 12), heavyMat);
    sgPump.rotation.x = Math.PI / 2;
    sgPump.position.set(0, -0.01, -0.24);
    sgGroup.add(sgPump);
    // Orange glowing heat vents
    const sgVent = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.01, 0.18), orangeGlow);
    sgVent.position.set(0, 0.038, -0.15);
    sgGroup.add(sgVent);

    sgGroup.position.copy(this.weapons[1].hipPos);
    this.viewmodelContainer.add(sgGroup);
    this.weaponMeshes.push(sgGroup);

    // 3. Apex Precision .50
    const spGroup = new THREE.Group();
    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.2, metalness: 0.95 });
    const violetGlow = new THREE.MeshBasicMaterial({ color: 0x9933ff });
    // Chassis
    const spBody = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.48), carbonMat);
    spGroup.add(spBody);
    // Long Fluted Barrel
    const spBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.52, 12), gunMetal);
    spBarrel.rotation.x = Math.PI / 2;
    spBarrel.position.set(0, 0.015, -0.48);
    spGroup.add(spBarrel);
    // Massive Sniper Scope
    const spScope = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.22, 16), darkMetal);
    spScope.rotation.x = Math.PI / 2;
    spScope.position.set(0, 0.075, -0.08);
    spGroup.add(spScope);
    // Violet lens
    const spLens = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), violetGlow);
    spLens.position.set(0, 0.075, 0.03);
    spGroup.add(spLens);

    spGroup.position.copy(this.weapons[2].hipPos);
    this.viewmodelContainer.add(spGroup);
    this.weaponMeshes.push(spGroup);

    // 4. Vortex Plasma Cannon
    const plGroup = new THREE.Group();
    const alienMat = new THREE.MeshStandardMaterial({ color: 0x1c2430, metalness: 0.85, roughness: 0.2 });
    const limeGlow = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    // Toroid Generator
    const plRing = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.02, 12, 24), alienMat);
    plRing.position.set(0, 0.0, -0.22);
    plGroup.add(plRing);
    // Plasma Core Cylinder
    const plCore = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.35, 16), limeGlow);
    plCore.rotation.x = Math.PI / 2;
    plCore.position.set(0, 0.0, -0.18);
    plGroup.add(plCore);
    // Emitter Prongs
    for (let i = 0; i < 3; i++) {
      const angle = (i * 2 * Math.PI) / 3;
      const prong = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.18), darkMetal);
      prong.position.set(Math.cos(angle) * 0.06, Math.sin(angle) * 0.06, -0.32);
      plGroup.add(prong);
    }

    plGroup.position.copy(this.weapons[3].hipPos);
    this.viewmodelContainer.add(plGroup);
    this.weaponMeshes.push(plGroup);
  }

  public getMuzzleWorldPosition(): THREE.Vector3 {
    const activeMesh = this.weaponMeshes[this.currentWeaponIndex];
    if (!activeMesh) return this.viewmodelCamera.position.clone();
    const muzzle = new THREE.Vector3(0, 0.015, -0.52);
    activeMesh.updateMatrixWorld(true);
    return activeMesh.localToWorld(muzzle);
  }

  private showActiveWeaponMesh(): void {
    this.weaponMeshes.forEach((mesh, index) => {
      mesh.visible = index === this.currentWeaponIndex;
    });
    this.recoilSystem.setProfile(this.currentWeapon.recoil);
  }

  public setAim(aiming: boolean): void {
    if (this.isAiming !== aiming) {
      this.isAiming = aiming;
      eventBus.emit('weapon:ads:toggle', { isAiming: aiming });
    }
  }

  public switchWeapon(index: number): void {
    if (index === this.currentWeaponIndex || index < 0 || index >= this.weapons.length) return;
    if (this.currentState === WeaponState.SWITCHING) return;

    const fromId = this.currentWeapon.id;
    this.currentState = WeaponState.SWITCHING;
    this.stateTimer = this.currentWeapon.switchTime;
    this.isAiming = false;
    eventBus.emit('weapon:ads:toggle', { isAiming: false });

    // Lower current weapon animation
    const oldMesh = this.weaponMeshes[this.currentWeaponIndex];
    const targetIdx = index;

    setTimeout(() => {
      this.currentWeaponIndex = targetIdx;
      this.showActiveWeaponMesh();
      eventBus.emit('weapon:switch', {
        fromId,
        toId: this.currentWeapon.id,
        toName: this.currentWeapon.name,
      });
      this.currentState = WeaponState.IDLE;
    }, this.currentWeapon.switchTime * 1000);
  }

  public nextWeapon(): void {
    const nextIdx = (this.currentWeaponIndex + 1) % this.weapons.length;
    this.switchWeapon(nextIdx);
  }

  public prevWeapon(): void {
    const prevIdx = (this.currentWeaponIndex - 1 + this.weapons.length) % this.weapons.length;
    this.switchWeapon(prevIdx);
  }

  public reload(): void {
    if (this.currentState === WeaponState.RELOADING || this.currentState === WeaponState.SWITCHING) return;
    const mag = this.currentMagAmmo;
    const reserve = this.currentReserve;
    const maxMag = this.currentWeapon.magSize;

    if (mag >= maxMag || reserve <= 0) return;

    this.currentState = WeaponState.RELOADING;
    this.stateTimer = this.currentWeapon.reloadTime;
    this.isAiming = false;
    eventBus.emit('weapon:ads:toggle', { isAiming: false });
    eventBus.emit('weapon:reload:start', { weaponId: this.currentWeapon.id, duration: this.currentWeapon.reloadTime });
    soundSynth.playReload();
  }

  public setTrigger(held: boolean): void {
    this.isTriggerHeld = held;
    if (!held) {
      this.recoilSystem.onStopFiring();
    }
  }

  public update(
    deltaTime: number,
    worldCamera: THREE.PerspectiveCamera,
    isMoving: boolean,
    isGrounded: boolean,
    mouseDeltaX: number,
    mouseDeltaY: number
  ): void {
    const w = this.currentWeapon;
    const fireInterval = 60 / w.fireRate;

    if (this.fireTimer > 0) {
      this.fireTimer -= deltaTime;
    }

    // Weapon state timer
    if (this.stateTimer > 0) {
      this.stateTimer -= deltaTime;
      if (this.stateTimer <= 0) {
        if (this.currentState === WeaponState.RELOADING) {
          // Finish reload
          const needed = w.magSize - this.ammoInMag[this.currentWeaponIndex];
          const available = this.ammoInReserve[this.currentWeaponIndex];
          const load = Math.min(needed, available);
          this.ammoInMag[this.currentWeaponIndex] += load;
          this.ammoInReserve[this.currentWeaponIndex] -= load;
          this.currentState = WeaponState.IDLE;
          eventBus.emit('weapon:reload:finish', { weaponId: w.id, ammo: this.ammoInMag[this.currentWeaponIndex] });
        } else if (this.currentState === WeaponState.SWITCHING) {
          this.currentState = WeaponState.IDLE;
        }
      }
    }

    // Auto-fire or semi-fire trigger handling
    if (this.isTriggerHeld && this.fireTimer <= 0 && this.currentState === WeaponState.IDLE) {
      if (this.ammoInMag[this.currentWeaponIndex] > 0) {
        this.fire(worldCamera);
        this.fireTimer = fireInterval;
      } else {
        soundSynth.playEmptyClick();
        eventBus.emit('weapon:empty', { weaponId: w.id });
        this.reload();
        this.fireTimer = 0.4;
      }
    }

    // Recoil springs & spread recovery
    this.recoilSystem.update(deltaTime, this.isAiming, isMoving, isGrounded);

    // Muzzle flash timer
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= deltaTime;
      if (this.muzzleFlashTimer <= 0) {
        this.muzzleFlashMesh.visible = false;
        this.muzzleFlashLight.visible = false;
      }
    }

    // Animate active viewmodel with layered breathing, movement bob, mouse sway and recoil.
    this.movementTimer += deltaTime * (isMoving ? 9.5 : 1.4);
    const activeMesh = this.weaponMeshes[this.currentWeaponIndex];
    if (activeMesh) {
      const targetBasePos = this.isAiming ? w.adsPos : w.hipPos;

      // Mouse sway
      const swayX = -mouseDeltaX * 0.00008;
      const swayY = mouseDeltaY * 0.00008;

      const bobStrength = isMoving ? 1 : 0.25;
      const bobX = Math.cos(this.movementTimer * 0.5) * 0.012 * bobStrength;
      const bobY = Math.abs(Math.sin(this.movementTimer)) * 0.014 * bobStrength;
      const breatheX = Math.cos(this.movementTimer * 0.37) * 0.002;
      const breatheY = Math.sin(this.movementTimer * 0.31) * 0.0025;

      // Desired position = base + recoil + input sway + locomotion bob.
      const targetPos = new THREE.Vector3(
        targetBasePos.x + this.recoilSystem.weaponPosOffset.x + swayX + bobX + breatheX,
        targetBasePos.y + this.recoilSystem.weaponPosOffset.y + swayY + bobY + breatheY,
        targetBasePos.z + this.recoilSystem.weaponPosOffset.z + Math.sin(this.movementTimer * 0.5) * 0.006 * bobStrength
      );

      const targetRot = new THREE.Euler(
        this.recoilSystem.weaponRotOffset.x + swayY * 1.5 + Math.sin(this.movementTimer) * 0.012 * bobStrength,
        this.recoilSystem.weaponRotOffset.y + swayX * 1.5 + Math.cos(this.movementTimer * 0.5) * 0.009 * bobStrength,
        this.recoilSystem.weaponRotOffset.z + Math.cos(this.movementTimer * 0.5) * 0.018 * bobStrength,
        'YXZ'
      );

      const lerpSpeed = this.isAiming ? 20 : 16;
      activeMesh.position.lerp(targetPos, lerpSpeed * deltaTime);
      activeMesh.quaternion.slerp(new THREE.Quaternion().setFromEuler(targetRot), lerpSpeed * deltaTime);

      // Position muzzle flash at gun tip
      this.muzzleFlashMesh.position.set(targetPos.x, targetPos.y + 0.015, targetPos.z - 0.48);
      this.muzzleFlashLight.position.copy(this.muzzleFlashMesh.position);
    }

    // Update Projectiles
    this.updateProjectiles(deltaTime);

    // Update Tracers
    this.updateTracers(deltaTime);

    // Update Impact Sparks
    this.updateSparks(deltaTime);
  }

  private fire(worldCamera: THREE.PerspectiveCamera): void {
    const w = this.currentWeapon;
    this.ammoInMag[this.currentWeaponIndex]--;

    // Recoil impulse
    this.recoilSystem.applyFireImpulse(this.isAiming);

    // Camera recoil hookup
    eventBus.emit('camera:shake', { intensity: this.isAiming ? 0.08 : 0.15, decay: 8.0 });

    // Muzzle flash
    this.muzzleFlashMesh.visible = true;
    this.muzzleFlashLight.visible = true;
    this.muzzleFlashTimer = 0.04;

    // Audio
    if (w.id === 'ar') soundSynth.playAssaultRifle();
    else if (w.id === 'shotgun') soundSynth.playShotgun();
    else if (w.id === 'sniper') soundSynth.playSniper();
    else if (w.id === 'plasma') soundSynth.playPlasmaFire();

    // Ballistics originate at the actual weapon muzzle, not the camera center.
    const origin = this.getMuzzleWorldPosition();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(worldCamera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(worldCamera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(worldCamera.quaternion);

    // Client performs presentation/local prediction only. The server receives the
    // exact shot directions and independently validates ammo, cadence, and damage.
    const shotDirections: [number, number, number][] = [];
    if (w.type === 'hitscan') {
      const pelletCount = w.pelletCount ?? 1;
      for (let i = 0; i < pelletCount; i++) {
        const spreadDir = this.recoilSystem.applySpreadToDirection(forward, up, right);
        shotDirections.push([spreadDir.x, spreadDir.y, spreadDir.z]);
        this.performHitscanRay(origin, spreadDir, w);
      }
    } else {
      const spreadDir = this.recoilSystem.applySpreadToDirection(forward, up, right);
      shotDirections.push([spreadDir.x, spreadDir.y, spreadDir.z]);
      this.spawnPlasmaProjectile(origin, spreadDir, w);
    }

    eventBus.emit('weapon:shot', {
      weaponId: w.id,
      origin: [origin.x, origin.y, origin.z],
      directions: shotDirections,
    });

    eventBus.emit('weapon:fire', {
      weaponId: w.id,
      weaponName: w.name,
      ammoRemaining: this.ammoInMag[this.currentWeaponIndex],
      origin: [origin.x, origin.y, origin.z],
      direction: [forward.x, forward.y, forward.z],
      spread: this.recoilSystem.currentSpread,
    });
  }

  private performHitscanRay(origin: THREE.Vector3, direction: THREE.Vector3, weapon: WeaponDef): void {
    const rayResult = this.physicsEngine.castRay(
      origin,
      direction,
      300,
      0xffff,
      CollisionGroup.STATIC_GEOMETRY | CollisionGroup.HITBOX
    );

    const hitPoint = rayResult.point;
    this.createTracer(origin, hitPoint);

    if (rayResult.hit) {
      const materialId = (rayResult.userData?.material ?? 'concrete') as SurfaceMaterialId;
      const surface = SURFACE_MATERIALS[materialId] ?? SURFACE_MATERIALS.concrete;
      this.createImpactSparks(hitPoint, rayResult.normal, surface.sparkCount, surface.impactColor, surface.sparkSpeed);

      // Check if target is remote player or dummy target
      const userData = rayResult.userData;
      const isHeadshot = userData?.part === 'head';
      const damage = weapon.damage * (isHeadshot ? weapon.headshotMultiplier : 1.0);

      eventBus.emit('weapon:impact', {
        point: [hitPoint.x, hitPoint.y, hitPoint.z],
        normal: [rayResult.normal.x, rayResult.normal.y, rayResult.normal.z],
      });
    }
  }

  private spawnPlasmaProjectile(origin: THREE.Vector3, direction: THREE.Vector3, weapon: WeaponDef): void {
    const geom = new THREE.SphereGeometry(0.16, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(origin).addScaledVector(direction, 0.8);
    this.worldScene.add(mesh);

    const speed = weapon.projectileSpeed ?? 50;
    const velocity = direction.clone().multiplyScalar(speed);

    this.projectiles.push({
      position: mesh.position,
      velocity,
      mesh,
      damage: weapon.damage,
      radius: weapon.splashRadius ?? 6.0,
      lifetime: 4.0,
    });
  }

  private updateProjectiles(deltaTime: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.lifetime -= deltaTime;

      const prevPos = p.position.clone();
      p.velocity.y += -12.0 * deltaTime; // slight gravity drop
      p.position.addScaledVector(p.velocity, deltaTime);
      p.mesh.position.copy(p.position);

      // Raycast along path to check impact
      const moveVec = p.position.clone().sub(prevPos);
      const dist = moveVec.length();
      if (dist > 0.001) {
        const dir = moveVec.clone().normalize();
        const hit = this.physicsEngine.castRay(prevPos, dir, dist);
        if (hit.hit || p.lifetime <= 0) {
          // Explode
          this.triggerExplosion(hit.hit ? hit.point : p.position, p.damage, p.radius);
          this.worldScene.remove(p.mesh);
          p.mesh.geometry.dispose();
          this.projectiles.splice(i, 1);
        }
      }
    }
  }

  private triggerExplosion(center: THREE.Vector3, damage: number, radius: number): void {
    soundSynth.playExplosion();
    eventBus.emit('camera:shake', { intensity: 0.45, decay: 3.5 });
    this.createImpactSparks(center, new THREE.Vector3(0, 1, 0), 40, 0x00ff88);

    eventBus.emit('weapon:impact', {
      point: [center.x, center.y, center.z],
      normal: [0, 1, 0],
    });
  }

  private createTracer(start: THREE.Vector3, end: THREE.Vector3): void {
    const points = [start.clone().add(new THREE.Vector3(0, -0.05, 0)), end.clone()];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xffe077, transparent: true, opacity: 0.85, linewidth: 2 });
    const line = new THREE.Line(geom, mat);
    this.worldScene.add(line);

    this.tracers.push({
      line,
      lifetime: 0.07,
      maxLifetime: 0.07,
    });
  }

  private updateTracers(deltaTime: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.lifetime -= deltaTime;
      if (t.lifetime <= 0) {
        this.worldScene.remove(t.line);
        t.line.geometry.dispose();
        (t.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      } else {
        const mat = t.line.material as THREE.LineBasicMaterial;
        mat.opacity = (t.lifetime / t.maxLifetime) * 0.85;
      }
    }
  }

  private createImpactSparks(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    count: number = 18,
    colorHex: number = 0xffaa33,
    sparkSpeed: number = 7
  ): void {
    const countSparks = count;
    const positions = new Float32Array(countSparks * 3);
    const velocities: THREE.Vector3[] = [];

    for (let i = 0; i < countSparks; i++) {
      positions[i * 3] = point.x;
      positions[i * 3 + 1] = point.y;
      positions[i * 3 + 2] = point.z;

      // Cone around normal
      const randDir = new THREE.Vector3(
        normal.x + (Math.random() - 0.5) * 1.5,
        normal.y + Math.random() * 1.5,
        normal.z + (Math.random() - 0.5) * 1.5
      ).normalize().multiplyScalar(sparkSpeed * (0.65 + Math.random() * 0.7));

      velocities.push(randDir);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: colorHex, size: 0.08, transparent: true, opacity: 1.0 });
    const points = new THREE.Points(geom, mat);
    this.worldScene.add(points);

    this.impactSparks.push({ mesh: points, velocities, lifetime: 0.45 });
  }

  private updateSparks(deltaTime: number): void {
    for (let i = this.impactSparks.length - 1; i >= 0; i--) {
      const s = this.impactSparks[i];
      s.lifetime -= deltaTime;
      if (s.lifetime <= 0) {
        this.worldScene.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.impactSparks.splice(i, 1);
      } else {
        const posAttr = s.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        const arr = posAttr.array as Float32Array;
        for (let j = 0; j < s.velocities.length; j++) {
          s.velocities[j].y -= 25.0 * deltaTime; // gravity on sparks
          arr[j * 3] += s.velocities[j].x * deltaTime;
          arr[j * 3 + 1] += s.velocities[j].y * deltaTime;
          arr[j * 3 + 2] += s.velocities[j].z * deltaTime;
        }
        posAttr.needsUpdate = true;
        (s.mesh.material as THREE.PointsMaterial).opacity = Math.max(0, s.lifetime / 0.45);
      }
    }
  }

  public dispose(): void {
    this.tracers.forEach(t => this.worldScene.remove(t.line));
    this.projectiles.forEach(p => this.worldScene.remove(p.mesh));
    this.impactSparks.forEach(s => this.worldScene.remove(s.mesh));
  }
}
