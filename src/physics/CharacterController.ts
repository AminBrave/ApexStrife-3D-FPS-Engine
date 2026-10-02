/**
 * CharacterController.ts
 * Kinematic character controller handling velocity solver, friction/acceleration models,
 * slope detection, jumping, crouching, sprinting, and Rapier3D integration.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsEngine } from './PhysicsEngine';
import { eventBus } from '../core/EventBus';
import { stepHorizontalVelocity } from '../gameplay/MovementSimulation';

export interface MovementInput {
  moveForward: number; // -1 to +1
  moveRight: number;   // -1 to +1
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  yaw: number;
}

export class CharacterController {
  public position: THREE.Vector3 = new THREE.Vector3(0, 2, 0);
  public velocity: THREE.Vector3 = new THREE.Vector3();
  public isGrounded: boolean = false;
  public isCrouching: boolean = false;
  public isSprinting: boolean = false;

  // Speeds in m/s
  public walkSpeed: number = 7.0;
  public sprintSpeed: number = 11.5;
  public crouchSpeed: number = 3.5;
  public jumpSpeed: number = 9.2;

  // Quake/Source-style friction and acceleration
  public groundAcceleration: number = 14.0;
  public airAcceleration: number = 2.5;
  public groundFriction: number = 8.0;
  public gravity: number = -24.0;

  // Dimensions
  public standingHeight: number = 1.8;
  public crouchingHeight: number = 1.1;
  public currentEyeHeight: number = 1.65;
  public targetEyeHeight: number = 1.65;
  public radius: number = 0.35;

  // Jump & Ground Coyote Time
  private coyoteTimer: number = 0;
  private readonly coyoteTimeLimit: number = 0.12; // 120ms coyote time
  private jumpCooldown: number = 0;

  // Rapier references
  private physicsEngine: PhysicsEngine;
  public body: RAPIER.RigidBody | null = null;
  public collider: RAPIER.Collider | null = null;
  private rapierController: RAPIER.KinematicCharacterController | null = null;

  constructor(physicsEngine: PhysicsEngine, startPosition: THREE.Vector3 = new THREE.Vector3(0, 2, 0)) {
    this.physicsEngine = physicsEngine;
    this.position.copy(startPosition);

    if (physicsEngine.isReady) {
      this.initPhysics();
    }
  }

  public initPhysics(): void {
    if (!this.physicsEngine.isReady) return;

    const halfHeight = (this.standingHeight - 2 * this.radius) / 2;
    const { body, collider } = this.physicsEngine.createKinematicCapsule(
      this.position,
      halfHeight,
      this.radius,
      { type: 'local_player' }
    );

    this.body = body;
    this.collider = collider;
    this.rapierController = this.physicsEngine.createCharacterController(0.015);
  }

  /**
   * Fixed physics tick update.
   */
  public update(fixedDeltaTime: number, input: MovementInput, sideEffects: boolean = true): void {
    // 1. Handle Crouch Transition
    this.isCrouching = input.crouch;
    this.targetEyeHeight = this.isCrouching ? 0.95 : 1.65;
    // Smooth eye height interpolation
    this.currentEyeHeight = THREE.MathUtils.lerp(this.currentEyeHeight, this.targetEyeHeight, 15 * fixedDeltaTime);

    // 2. Sprint state (cannot sprint while crouching or moving backwards)
    this.isSprinting = input.sprint && !this.isCrouching && input.moveForward > 0;

    // 3-5. Shared deterministic horizontal movement solver.
    const movementState = {
      velocity: [this.velocity.x, this.velocity.y, this.velocity.z] as [number, number, number],
      isGrounded: this.isGrounded,
    };
    stepHorizontalVelocity(movementState, input, fixedDeltaTime);
    this.velocity.x = movementState.velocity[0];
    this.velocity.z = movementState.velocity[2];

    if (this.isGrounded) {
      this.coyoteTimer = this.coyoteTimeLimit;
      if (this.velocity.y < 0) this.velocity.y = -0.5;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - fixedDeltaTime);
      this.velocity.y = Math.max(-45, this.velocity.y + this.gravity * fixedDeltaTime);
    }

    // 6. Jumping
    if (this.jumpCooldown > 0) {
      this.jumpCooldown -= fixedDeltaTime;
    }

    if (input.jump && (this.isGrounded || this.coyoteTimer > 0) && this.jumpCooldown <= 0) {
      this.velocity.y = this.jumpSpeed;
      this.isGrounded = false;
      this.coyoteTimer = 0;
      this.jumpCooldown = 0.2; // 200ms jump debounce
      if (sideEffects) eventBus.emit('player:jump', { velocity: this.jumpSpeed });
    }

    // 7. Solve Kinematic Collision with Rapier
    const movement = new THREE.Vector3(
      this.velocity.x * fixedDeltaTime,
      this.velocity.y * fixedDeltaTime,
      this.velocity.z * fixedDeltaTime
    );

    if (this.rapierController && this.collider && this.body) {
      // Compute movement taking walls and steps into account
      this.rapierController.computeColliderMovement(
        this.collider,
        { x: movement.x, y: movement.y, z: movement.z }
      );

      const corrected = this.rapierController.computedMovement();
      const wasGrounded = this.isGrounded;
      this.isGrounded = this.rapierController.computedGrounded();

      // Land event
      if (!wasGrounded && this.isGrounded) {
        if (sideEffects) eventBus.emit('player:land', { impactSpeed: Math.abs(this.velocity.y) });
      }

      // Apply movement
      this.position.x += corrected.x;
      this.position.y += corrected.y;
      this.position.z += corrected.z;

      // Update Rapier body position
      this.body.setNextKinematicTranslation({
        x: this.position.x,
        y: this.position.y,
        z: this.position.z,
      });

      // If collided vertically from above or below, zero vertical velocity
      if (this.isGrounded && this.velocity.y < 0) {
        this.velocity.y = 0;
      }
    } else {
      // Fallback bounding box & floor collision solver
      const wasGrounded = this.isGrounded;
      this.position.add(movement);

      // Simple ground plane check at y = 1.0
      const groundFloor = 1.0;
      if (this.position.y <= groundFloor) {
        this.position.y = groundFloor;
        this.velocity.y = 0;
        this.isGrounded = true;
        if (!wasGrounded) {
          eventBus.emit('player:land', { impactSpeed: Math.abs(this.velocity.y) });
        }
      } else {
        this.isGrounded = false;
      }

      // World boundary constraints: Arena bounds [-45, 45] x [-45, 45]
      this.position.x = THREE.MathUtils.clamp(this.position.x, -45, 45);
      this.position.z = THREE.MathUtils.clamp(this.position.z, -45, 45);
    }
  }

  /**
   * Source / Quake vector acceleration function.
   */
  private accelerate(
    wishDir: THREE.Vector3,
    wishSpeed: number,
    accel: number,
    deltaTime: number
  ): void {
    if (wishDir.lengthSq() < 0.0001) return;

    // Project current horizontal velocity onto wish direction
    const currentSpeed = this.velocity.x * wishDir.x + this.velocity.z * wishDir.z;
    const addSpeed = wishSpeed - currentSpeed;

    if (addSpeed <= 0) return;

    const accelSpeed = Math.min(accel * deltaTime * wishSpeed, addSpeed);
    this.velocity.x += accelSpeed * wishDir.x;
    this.velocity.z += accelSpeed * wishDir.z;
  }

  public getEyePosition(): THREE.Vector3 {
    return new THREE.Vector3(
      this.position.x,
      this.position.y + this.currentEyeHeight,
      this.position.z
    );
  }

  public setPosition(pos: THREE.Vector3): void {
    this.position.copy(pos);
    if (this.body) {
      this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    }
  }
}
