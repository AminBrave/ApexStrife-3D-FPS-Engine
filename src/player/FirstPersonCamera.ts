/**
 * FirstPersonCamera.ts
 * Manages Pitch/Yaw rotation, Pointer Lock API integration, procedural head bobbing,
 * landing dip springs, camera shake, ADS zoom scaling, and dual-camera synchronization.
 */

import * as THREE from 'three';
import { eventBus } from '../core/EventBus';

export interface CameraConfig {
  worldCamera: THREE.PerspectiveCamera;
  viewmodelCamera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  mouseSensitivity?: number;
  adsMultiplier?: number;
  baseFov?: number;
  adsFov?: number;
}

export class FirstPersonCamera {
  public worldCamera: THREE.PerspectiveCamera;
  public viewmodelCamera: THREE.PerspectiveCamera;
  private domElement: HTMLElement;

  // Rotation Euler angles in radians
  public yaw: number = 0;
  public pitch: number = 0;

  // Configuration
  public mouseSensitivity: number = 0.0022;
  public adsMultiplier: number = 0.55;
  public baseFov: number = 75;
  public adsFov: number = 48;
  public currentFov: number = 75;

  // State flags
  public isLocked: boolean = false;
  public isAiming: boolean = false;

  // Procedural Head Bob
  private bobTimer: number = 0;
  private breathingTimer: number = 0;
  private movementBlend: number = 0;
  public bobOffset: THREE.Vector3 = new THREE.Vector3();
  public bobTilt: number = 0;

  // Spring offsets (Landing dip, Recoil, Shake)
  public landingDip: number = 0;
  private landingDipVelocity: number = 0;

  public recoilPitch: number = 0;
  public recoilYaw: number = 0;
  public recoilRoll: number = 0;

  // Camera Shake
  private shakeIntensity: number = 0;
  private shakeDecay: number = 5.0;

  constructor(config: CameraConfig) {
    this.worldCamera = config.worldCamera;
    this.viewmodelCamera = config.viewmodelCamera;
    this.domElement = config.domElement;

    if (config.mouseSensitivity) this.mouseSensitivity = config.mouseSensitivity;
    if (config.adsMultiplier) this.adsMultiplier = config.adsMultiplier;
    if (config.baseFov) this.baseFov = config.baseFov;
    if (config.adsFov) this.adsFov = config.adsFov;
    this.currentFov = this.baseFov;

    this.onMouseMove = this.onMouseMove.bind(this);
    this.onPointerLockChange = this.onPointerLockChange.bind(this);
    this.onPointerLockError = this.onPointerLockError.bind(this);

    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);

    // Event listeners
    eventBus.on('player:land', ({ impactSpeed }) => {
      this.triggerLandingDip(impactSpeed);
    });

    eventBus.on('camera:shake', ({ intensity, decay }) => {
      this.shakeIntensity = Math.min(this.shakeIntensity + intensity, 1.5);
      if (decay) this.shakeDecay = decay;
    });

    eventBus.on('weapon:ads:toggle', ({ isAiming }) => {
      this.isAiming = isAiming;
    });
  }

  public requestPointerLock(): void {
    if (!this.isLocked) {
      try {
        const promise = this.domElement.requestPointerLock() as any;
        if (promise && promise.catch) {
          promise.catch((err: any) => {
            console.warn('[FirstPersonCamera] Pointer lock request rejected:', err);
          });
        }
      } catch (err) {
        console.warn('[FirstPersonCamera] Pointer lock failed:', err);
      }
    }
  }

  public exitPointerLock(): void {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  private onPointerLockChange(): void {
    this.isLocked = document.pointerLockElement === this.domElement;
  }

  private onPointerLockError(): void {
    console.warn('[FirstPersonCamera] Pointer lock error encountered.');
    this.isLocked = false;
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.isLocked) return;

    const sens = this.isAiming
      ? this.mouseSensitivity * this.adsMultiplier
      : this.mouseSensitivity;

    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;

    // Yaw (Left/Right)
    this.yaw -= movementX * sens;
    // Keep yaw normalized within 0 to 2PI
    this.yaw = (this.yaw % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);

    // Pitch (Up/Down) clamped to +/- 89.5 degrees to prevent gimbal lock
    const maxPitch = (89.5 * Math.PI) / 180;
    this.pitch -= movementY * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -maxPitch, maxPitch);
  }

  public triggerLandingDip(impactSpeed: number): void {
    // Proportional dip downwards on hard impact
    const strength = THREE.MathUtils.clamp(impactSpeed * 0.02, 0.05, 0.28);
    this.landingDipVelocity -= strength * 14;
  }

  /**
   * Called every variable frame.
   */
  public update(
    deltaTime: number,
    eyePosition: THREE.Vector3,
    isMoving: boolean,
    isSprinting: boolean,
    isGrounded: boolean
  ): void {
    // 1. Dynamic movement FOV: calm while standing, wider while moving/running.
    this.movementBlend = THREE.MathUtils.lerp(this.movementBlend, isMoving ? 1 : 0, 8 * deltaTime);
    const movementFov = this.movementBlend * (isSprinting ? 4.5 : 1.5);
    const targetFov = this.isAiming ? this.adsFov : this.baseFov + movementFov;
    this.currentFov = THREE.MathUtils.lerp(this.currentFov, targetFov, 10 * deltaTime);
    this.worldCamera.fov = this.currentFov;
    this.worldCamera.updateProjectionMatrix();

    // 2. Procedural Head Bobbing + subtle idle breathing.
    this.breathingTimer += deltaTime;
    if (isMoving && isGrounded) {
      const bobFreq = isSprinting ? 14.0 : 10.0;
      const bobAmpY = isSprinting ? 0.045 : 0.025;
      const bobAmpX = isSprinting ? 0.03 : 0.015;

      this.bobTimer += deltaTime * bobFreq;
      this.bobOffset.y = Math.sin(this.bobTimer) * bobAmpY;
      this.bobOffset.x = Math.cos(this.bobTimer * 0.5) * bobAmpX;
      this.bobTilt = Math.sin(this.bobTimer * 0.5) * (isSprinting ? 0.018 : 0.008);
    } else {
      // Smooth decay back to center
      this.bobTimer = 0;
      this.bobOffset.lerp(new THREE.Vector3(0, 0, 0), 10 * deltaTime);
      this.bobTilt = THREE.MathUtils.lerp(this.bobTilt, 0, 10 * deltaTime);
      this.bobOffset.y += Math.sin(this.breathingTimer * 1.15) * 0.003;
      this.bobOffset.x += Math.cos(this.breathingTimer * 0.7) * 0.002;
    }

    // 3. Landing Dip Spring (harmonic oscillator)
    const springStiffness = 180.0;
    const springDamping = 16.0;
    const springForce = -springStiffness * this.landingDip - springDamping * this.landingDipVelocity;
    this.landingDipVelocity += springForce * deltaTime;
    this.landingDip += this.landingDipVelocity * deltaTime;

    // 4. Camera Shake Decay & Noise
    let shakePitch = 0;
    let shakeYaw = 0;
    if (this.shakeIntensity > 0.001) {
      this.shakeIntensity = Math.max(0, this.shakeIntensity - this.shakeDecay * deltaTime);
      shakePitch = (Math.random() - 0.5) * 2 * this.shakeIntensity * 0.04;
      shakeYaw = (Math.random() - 0.5) * 2 * this.shakeIntensity * 0.04;
    }

    // 5. Total Camera Position
    const totalPosition = eyePosition.clone();
    totalPosition.x += this.bobOffset.x;
    totalPosition.y += this.bobOffset.y + this.landingDip;
    totalPosition.z += this.bobOffset.z;
    this.worldCamera.position.copy(totalPosition);

    // 6. Total Camera Orientation (Pitch + Yaw + Roll)
    // Combine base pitch/yaw with camera recoil, head bob tilt, and trauma shake
    const effectivePitch = this.pitch + this.recoilPitch + shakePitch;
    const effectiveYaw = this.yaw + this.recoilYaw + shakeYaw;
    const breathingRoll = Math.sin(this.breathingTimer * 0.8) * 0.0015;
    const effectiveRoll = this.bobTilt + breathingRoll + this.recoilRoll;

    const euler = new THREE.Euler(effectivePitch, effectiveYaw, effectiveRoll, 'YXZ');
    this.worldCamera.quaternion.setFromEuler(euler);

    // Synchronize Viewmodel Camera
    this.viewmodelCamera.position.copy(this.worldCamera.position);
    this.viewmodelCamera.quaternion.copy(this.worldCamera.quaternion);
  }

  public getForwardVector(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.worldCamera.quaternion);
  }

  public getRightVector(): THREE.Vector3 {
    return new THREE.Vector3(1, 0, 0).applyQuaternion(this.worldCamera.quaternion);
  }

  public getUpVector(): THREE.Vector3 {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.worldCamera.quaternion);
  }

  public dispose(): void {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
  }
}
