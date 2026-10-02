/**
 * PlayerController.ts
 * Captures user input (keyboard & mouse), builds client input sequence packets,
 * runs local character prediction, feeds StatePredictor, and drives the camera.
 */

import * as THREE from 'three';
import { CharacterController } from '../physics/CharacterController';
import { FirstPersonCamera } from './FirstPersonCamera';
import { WeaponManager } from '../weapons/WeaponManager';
import { StatePredictor, PlayerInput, PlayerState } from '../netcode/StatePredictor';
import { NetworkManager } from '../netcode/NetworkManager';
import { eventBus } from '../core/EventBus';
import { soundSynth } from '../audio/SoundSynthesizer';

export class PlayerController {
  public controller: CharacterController;
  public camera: FirstPersonCamera;
  public weaponManager: WeaponManager;
  public statePredictor: StatePredictor;
  public networkManager: NetworkManager;

  // Input state
  private keys: Record<string, boolean> = {};
  private mouseLeftDown: boolean = false;
  private mouseRightDown: boolean = false;
  private inputSequence: number = 0;

  // Player Stats
  public health: number = 100;
  public maxHealth: number = 100;
  public shield: number = 50;
  public maxShield: number = 50;
  public isDead: boolean = false;
  public kills: number = 0;
  public deaths: number = 0;
  public score: number = 0;

  // Mouse delta tracking for weapon sway
  public mouseDeltaX: number = 0;
  public mouseDeltaY: number = 0;

  constructor(
    controller: CharacterController,
    camera: FirstPersonCamera,
    weaponManager: WeaponManager,
    statePredictor: StatePredictor,
    networkManager: NetworkManager
  ) {
    this.controller = controller;
    this.camera = camera;
    this.weaponManager = weaponManager;
    this.statePredictor = statePredictor;
    this.networkManager = networkManager;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('mousemove', this.onMouseMove);

    // Event listeners
    eventBus.on('weapon:hit', ({ targetId, damage, isHeadshot }) => {
      this.score += isHeadshot ? 150 : 100;
      this.networkManager.registerDamageToBot(
        targetId,
        damage,
        isHeadshot,
        this.weaponManager.currentWeapon.name
      );
    });

    eventBus.on('net:killfeed', ({ killer }) => {
      if (killer === 'You') {
        this.kills++;
      }
    });
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.keys[e.code] = true;

    // Weapon slot hotkeys 1-4
    if (e.code === 'Digit1') this.weaponManager.switchWeapon(0);
    if (e.code === 'Digit2') this.weaponManager.switchWeapon(1);
    if (e.code === 'Digit3') this.weaponManager.switchWeapon(2);
    if (e.code === 'Digit4') this.weaponManager.switchWeapon(3);

    // Reload hotkey
    if (e.code === 'KeyR') {
      this.weaponManager.reload();
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys[e.code] = false;
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.camera.isLocked) return;

    if (e.button === 0) {
      this.mouseLeftDown = true;
      this.weaponManager.setTrigger(true);
    } else if (e.button === 2) {
      this.mouseRightDown = true;
      this.weaponManager.setAim(true);
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button === 0) {
      this.mouseLeftDown = false;
      this.weaponManager.setTrigger(false);
    } else if (e.button === 2) {
      this.mouseRightDown = false;
      this.weaponManager.setAim(false);
    }
  }

  private onWheel(e: WheelEvent): void {
    if (!this.camera.isLocked) return;
    if (e.deltaY > 0) {
      this.weaponManager.nextWeapon();
    } else if (e.deltaY < 0) {
      this.weaponManager.prevWeapon();
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.camera.isLocked) {
      this.mouseDeltaX = e.movementX || 0;
      this.mouseDeltaY = e.movementY || 0;
    }
  }

  /**
   * Called during decoupled fixed physics step (60Hz).
   */
  public fixedUpdate(fixedDeltaTime: number): void {
    if (this.isDead) return;

    // Assemble input vector
    let forward = 0;
    let right = 0;

    if (this.keys['KeyW'] || this.keys['ArrowUp']) forward += 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) forward -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) right += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) right -= 1;

    const jump = !!this.keys['Space'];
    const sprint = !!this.keys['ShiftLeft'] || !!this.keys['ShiftRight'];
    const crouch = !!this.keys['KeyC'] || !!this.keys['ControlLeft'];

    this.inputSequence++;

    const inputPacket: PlayerInput = {
      sequence: this.inputSequence,
      timestamp: performance.now(),
      moveForward: forward,
      moveRight: right,
      jump,
      sprint,
      crouch,
      yaw: this.camera.yaw,
      pitch: this.camera.pitch,
      fire: this.mouseLeftDown,
      reload: !!this.keys['KeyR'],
      weaponIndex: this.weaponManager.currentWeaponIndex,
    };

    // 1. Client-Side Prediction: run local physics immediately
    this.controller.update(fixedDeltaTime, inputPacket);

    // 2. Build local state snapshot
    const localState: PlayerState = {
      position: [this.controller.position.x, this.controller.position.y, this.controller.position.z],
      velocity: [this.controller.velocity.x, this.controller.velocity.y, this.controller.velocity.z],
      yaw: this.camera.yaw,
      pitch: this.camera.pitch,
      isGrounded: this.controller.isGrounded,
      isCrouching: this.controller.isCrouching,
    };

    // 3. Record in circular buffer for future server reconciliation
    this.statePredictor.recordInput(inputPacket, localState);

    // 4. Send packet over network
    this.networkManager.sendInput(inputPacket);

    // 5. Update local simulation fallback if disconnected
    this.networkManager.updateLocalFallback(fixedDeltaTime, localState, this.inputSequence);

    // Footstep audio trigger
    const horizSpeed = Math.sqrt(
      this.controller.velocity.x * this.controller.velocity.x +
      this.controller.velocity.z * this.controller.velocity.z
    );
    if (this.controller.isGrounded && horizSpeed > 1.5) {
      if (Math.random() < (sprint ? 0.08 : 0.05)) {
        soundSynth.playFootstep();
      }
    }
  }

  /**
   * Called during variable render frame (RAF).
   */
  public variableUpdate(deltaTime: number, alpha: number): void {
    // Smooth out visual error from server reconciliation snaps
    this.statePredictor.updateVisualSmoothing(deltaTime);

    // Compute eye position including visual smoothing offset
    const eyePos = this.controller.getEyePosition().clone();
    eyePos.add(this.statePredictor.visualOffset);

    // Synchronize camera recoil spring angles into FirstPersonCamera
    this.camera.recoilPitch = this.weaponManager.recoilSystem.camRecoilPos.x;
    this.camera.recoilYaw = this.weaponManager.recoilSystem.camRecoilPos.y;
    this.camera.recoilRoll = this.weaponManager.recoilSystem.camRecoilPos.z;

    const isMoving = Math.abs(this.controller.velocity.x) > 0.5 || Math.abs(this.controller.velocity.z) > 0.5;

    // Update First Person Camera
    this.camera.update(
      deltaTime,
      eyePos,
      isMoving,
      this.controller.isSprinting,
      this.controller.isGrounded
    );

    // Update weapon viewmodel
    this.weaponManager.update(
      deltaTime,
      this.camera.worldCamera,
      isMoving,
      this.controller.isGrounded,
      this.mouseDeltaX,
      this.mouseDeltaY
    );

    // Reset mouse deltas
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
  }

  public takeDamage(amount: number, sourceId?: string): void {
    if (this.isDead) return;

    // Shield absorbs 65% of damage first
    if (this.shield > 0) {
      const shieldAbsorb = Math.min(this.shield, amount * 0.65);
      this.shield -= shieldAbsorb;
      amount -= shieldAbsorb;
    }

    this.health = Math.max(0, this.health - amount);
    eventBus.emit('camera:shake', { intensity: 0.35, decay: 6.0 });
    eventBus.emit('player:damaged', { amount });

    if (this.health <= 0) {
      this.isDead = true;
      this.deaths++;
      eventBus.emit('player:killed', { killerId: sourceId || 'enemy', weaponName: 'Unknown', isHeadshot: false });

      // Respawn after 3 seconds
      setTimeout(() => {
        this.respawn();
      }, 3000);
    }
  }

  public respawn(): void {
    this.health = this.maxHealth;
    this.shield = this.maxShield;
    this.isDead = false;
    this.controller.position.set(0, 2, 0);
    this.controller.velocity.set(0, 0, 0);
    eventBus.emit('player:respawn', { position: [0, 2, 0] });
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('mousemove', this.onMouseMove);
  }
}
