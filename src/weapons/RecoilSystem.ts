/**
 * RecoilSystem.ts
 * Multi-axis procedural recoil system driven by damped spring-mass equations
 * and dynamic spread pattern bloom/recovery mechanics.
 */

import * as THREE from 'three';

export interface RecoilProfile {
  // Camera kick
  camPitchKick: number;       // Radians upwards (e.g. 0.04)
  camPitchRandom: number;     // Random variance
  camYawKick: number;         // Horizontal pull
  camRollKick: number;        // Roll twist

  // Weapon viewmodel kick
  posKickback: THREE.Vector3; // Position displacement (e.g. x: 0.005, y: 0.015, z: -0.06)
  rotKickback: THREE.Vector3; // Euler angles displacement (e.g. x: 0.08, y: 0.02, z: -0.02)

  // Spring dynamics
  springStiffness: number;    // e.g. 240
  springDamping: number;      // e.g. 24

  // Spread / Bloom
  baseSpread: number;         // Minimum spread radians (e.g. 0.008)
  maxSpread: number;          // Maximum spread radians (e.g. 0.065)
  spreadPerShot: number;      // Spread added per shot (e.g. 0.012)
  spreadRecoveryRate: number; // Rad/sec recovered (e.g. 0.15)
  adsSpreadMultiplier: number;// e.g. 0.2 (tighter during ADS)
  moveSpreadMultiplier:// e.g. 2.0 (wider while running)
  number;
}

export class RecoilSystem {
  // Camera spring
  public camRecoilPos: THREE.Vector3 = new THREE.Vector3(); // x=pitch, y=yaw, z=roll
  private camRecoilVel: THREE.Vector3 = new THREE.Vector3();

  // Weapon translation spring
  public weaponPosOffset: THREE.Vector3 = new THREE.Vector3();
  private weaponPosVel: THREE.Vector3 = new THREE.Vector3();

  // Weapon rotation spring
  public weaponRotOffset: THREE.Vector3 = new THREE.Vector3();
  private weaponRotVel: THREE.Vector3 = new THREE.Vector3();

  // Spread state
  public currentSpread: number = 0.01;
  private continuousShotCount: number = 0;

  // Active profile
  public profile: RecoilProfile;

  constructor(initialProfile?: Partial<RecoilProfile>) {
    this.profile = {
      camPitchKick: 0.038,
      camPitchRandom: 0.012,
      camYawKick: 0.016,
      camRollKick: 0.01,
      posKickback: new THREE.Vector3(0.004, 0.018, -0.065),
      rotKickback: new THREE.Vector3(0.07, 0.02, -0.015),
      springStiffness: 280,
      springDamping: 26,
      baseSpread: 0.008,
      maxSpread: 0.075,
      spreadPerShot: 0.012,
      spreadRecoveryRate: 0.2,
      adsSpreadMultiplier: 0.25,
      moveSpreadMultiplier: 2.2,
      ...initialProfile,
    };
    this.currentSpread = this.profile.baseSpread;
  }

  public setProfile(newProfile: Partial<RecoilProfile>): void {
    this.profile = { ...this.profile, ...newProfile };
    this.currentSpread = Math.max(this.currentSpread, this.profile.baseSpread);
  }

  /**
   * Apply impulse when weapon fires.
   */
  public applyFireImpulse(isAiming: boolean = false): void {
    const p = this.profile;
    const adsFactor = isAiming ? 0.6 : 1.0;

    // 1. Camera Recoil Impulse (Pitch Up, Random Yaw, slight roll)
    const pitchKick = (p.camPitchKick + (Math.random() - 0.5) * p.camPitchRandom) * adsFactor;
    const yawKick = ((Math.random() - 0.45) * 2 * p.camYawKick) * adsFactor;
    const rollKick = ((Math.random() - 0.5) * 2 * p.camRollKick) * adsFactor;

    this.camRecoilVel.x += pitchKick * 45;
    this.camRecoilVel.y += yawKick * 35;
    this.camRecoilVel.z += rollKick * 20;

    // 2. Weapon Positional Kickback Impulse
    const randX = (Math.random() - 0.5) * 2 * p.posKickback.x;
    this.weaponPosVel.x += randX * 30 * adsFactor;
    this.weaponPosVel.y += p.posKickback.y * 35 * adsFactor;
    this.weaponPosVel.z += p.posKickback.z * 50 * adsFactor; // Punch backwards

    // 3. Weapon Rotational Kickback Impulse
    this.weaponRotVel.x += p.rotKickback.x * 40 * adsFactor;
    this.weaponRotVel.y += ((Math.random() - 0.5) * 2 * p.rotKickback.y) * 30 * adsFactor;
    this.weaponRotVel.z += ((Math.random() - 0.5) * 2 * p.rotKickback.z) * 25 * adsFactor;

    // 4. Spread Pattern Bloom
    this.continuousShotCount++;
    this.currentSpread = Math.min(
      this.currentSpread + p.spreadPerShot,
      p.maxSpread
    );
  }

  /**
   * Update spring physics and spread recovery.
   */
  public update(
    deltaTime: number,
    isAiming: boolean,
    isMoving: boolean,
    isGrounded: boolean
  ): void {
    const k = this.profile.springStiffness;
    const c = this.profile.springDamping;

    // Spring ODE integration: a = -k*x - c*v
    // Camera spring
    const camAx = -k * this.camRecoilPos.x - c * this.camRecoilVel.x;
    const camAy = -k * this.camRecoilPos.y - c * this.camRecoilVel.y;
    const camAz = -k * this.camRecoilPos.z - c * this.camRecoilVel.z;
    this.camRecoilVel.x += camAx * deltaTime;
    this.camRecoilVel.y += camAy * deltaTime;
    this.camRecoilVel.z += camAz * deltaTime;
    this.camRecoilPos.x += this.camRecoilVel.x * deltaTime;
    this.camRecoilPos.y += this.camRecoilVel.y * deltaTime;
    this.camRecoilPos.z += this.camRecoilVel.z * deltaTime;

    // Weapon position spring
    const wPosAx = -k * this.weaponPosOffset.x - c * this.weaponPosVel.x;
    const wPosAy = -k * this.weaponPosOffset.y - c * this.weaponPosVel.y;
    const wPosAz = -k * this.weaponPosOffset.z - c * this.weaponPosVel.z;
    this.weaponPosVel.x += wPosAx * deltaTime;
    this.weaponPosVel.y += wPosAy * deltaTime;
    this.weaponPosVel.z += wPosAz * deltaTime;
    this.weaponPosOffset.x += this.weaponPosVel.x * deltaTime;
    this.weaponPosOffset.y += this.weaponPosVel.y * deltaTime;
    this.weaponPosOffset.z += this.weaponPosVel.z * deltaTime;

    // Weapon rotation spring
    const wRotAx = -k * this.weaponRotOffset.x - c * this.weaponRotVel.x;
    const wRotAy = -k * this.weaponRotOffset.y - c * this.weaponRotVel.y;
    const wRotAz = -k * this.weaponRotOffset.z - c * this.weaponRotVel.z;
    this.weaponRotVel.x += wRotAx * deltaTime;
    this.weaponRotVel.y += wRotAy * deltaTime;
    this.weaponRotVel.z += wRotAz * deltaTime;
    this.weaponRotOffset.x += this.weaponRotVel.x * deltaTime;
    this.weaponRotOffset.y += this.weaponRotVel.y * deltaTime;
    this.weaponRotOffset.z += this.weaponRotVel.z * deltaTime;

    // Target spread based on current movement & ADS states
    let minAllowedSpread = this.profile.baseSpread;
    if (isAiming) {
      minAllowedSpread *= this.profile.adsSpreadMultiplier;
    }
    if (isMoving) {
      minAllowedSpread *= this.profile.moveSpreadMultiplier;
    }
    if (!isGrounded) {
      minAllowedSpread *= 2.5; // Jump spread penalty
    }

    // Spread recovery over time
    if (this.currentSpread > minAllowedSpread) {
      this.currentSpread = Math.max(
        minAllowedSpread,
        this.currentSpread - this.profile.spreadRecoveryRate * deltaTime
      );
    } else {
      this.currentSpread = THREE.MathUtils.lerp(this.currentSpread, minAllowedSpread, 12 * deltaTime);
    }
  }

  /**
   * Reset continuous shot counter when player stops shooting.
   */
  public onStopFiring(): void {
    this.continuousShotCount = 0;
  }

  /**
   * Calculates a perturbed ray direction based on current spread circle.
   */
  public applySpreadToDirection(baseDir: THREE.Vector3, up: THREE.Vector3, right: THREE.Vector3): THREE.Vector3 {
    // Uniform disc sampling
    const theta = Math.random() * 2 * Math.PI;
    const r = Math.sqrt(Math.random()) * this.currentSpread;

    const offsetX = Math.cos(theta) * r;
    const offsetY = Math.sin(theta) * r;

    return baseDir.clone()
      .addScaledVector(right, offsetX)
      .addScaledVector(up, offsetY)
      .normalize();
  }
}
