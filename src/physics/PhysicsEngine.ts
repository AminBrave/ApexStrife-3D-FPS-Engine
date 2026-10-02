/**
 * PhysicsEngine.ts
 * Rapier3D physics wrapper managing WASM initialization, 60Hz world stepping,
 * collision groups, kinematic character colliders, static level geometry, and raycasts.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export interface RaycastResult {
  hit: boolean;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  collider?: RAPIER.Collider;
  userData?: any;
}

export enum CollisionGroup {
  STATIC_GEOMETRY = 0x0001,
  PLAYER_CAPSULE  = 0x0002,
  HITBOX          = 0x0004,
  PROJECTILE      = 0x0008,
  TRIGGER         = 0x0010,
}

export class PhysicsEngine {
  public world!: RAPIER.World;
  public rapier!: typeof RAPIER;
  public isReady: boolean = false;

  private staticColliders: RAPIER.Collider[] = [];
  private staticBodies: RAPIER.RigidBody[] = [];
  private gravity = { x: 0.0, y: -24.0, z: 0.0 }; // Crisp responsive FPS gravity

  public async init(): Promise<void> {
    if (this.isReady) return;
    await RAPIER.init();
    this.rapier = RAPIER;
    this.world = new RAPIER.World(this.gravity);
    this.world.integrationParameters.numSolverIterations = 4;
    this.isReady = true;
  }

  public step(fixedDeltaTime: number): void {
    if (!this.isReady) return;
    this.world.timestep = fixedDeltaTime;
    this.world.step();
  }

  /**
   * Cast a ray through the physics world with bitmask filtering.
   */
  public castRay(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number = 200,
    membershipMask: number = 0xffff,
    filterMask: number = CollisionGroup.STATIC_GEOMETRY | CollisionGroup.HITBOX,
    excludeRigidBody?: RAPIER.RigidBody
  ): RaycastResult {
    if (!this.isReady) {
      return { hit: false, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), distance: maxDistance };
    }

    const dirNorm = direction.clone().normalize();
    const ray = new this.rapier.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dirNorm.x, y: dirNorm.y, z: dirNorm.z }
    );

    // Rapier packs memberships in the upper 16 bits and filters in the lower 16 bits.
    const interactionGroups = (membershipMask << 16) | filterMask;

    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDistance,
      true, // solid hit
      undefined,
      interactionGroups,
      undefined,
      excludeRigidBody
    );

    if (hit) {
      const hitPoint = new THREE.Vector3(
        origin.x + dirNorm.x * hit.timeOfImpact,
        origin.y + dirNorm.y * hit.timeOfImpact,
        origin.z + dirNorm.z * hit.timeOfImpact
      );
      const hitNormal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);

      return {
        hit: true,
        point: hitPoint,
        normal: hitNormal,
        distance: hit.timeOfImpact,
        collider: hit.collider,
        userData: (hit.collider as any)?.userData,
      };
    }

    return {
      hit: false,
      point: origin.clone().addScaledVector(dirNorm, maxDistance),
      normal: new THREE.Vector3(0, 1, 0),
      distance: maxDistance,
    };
  }

  /**
   * Create static box obstacle / level geometry.
   */
  public createStaticBox(
    position: THREE.Vector3,
    halfExtents: THREE.Vector3,
    quaternion: THREE.Quaternion = new THREE.Quaternion(),
    userData?: any,
    options: { sensor?: boolean } = {}
  ): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const bodyDesc = this.rapier.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });

    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = this.rapier.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setCollisionGroups((CollisionGroup.STATIC_GEOMETRY << 16) | 0xffff)
      .setFriction(0.6)
      .setRestitution(0.0);

    const collider = this.world.createCollider(colliderDesc.setSensor(!!options.sensor), body);
    if (userData) {
      (collider as any).userData = userData;
    }

    this.staticBodies.push(body);
    this.staticColliders.push(collider);

    return { body, collider };
  }

  /**
   * Create kinematic character controller wrapper from Rapier.
   */
  public createCharacterController(offset: number = 0.02): RAPIER.KinematicCharacterController {
    const characterController = this.world.createCharacterController(offset);
    characterController.enableAutostep(0.4, 0.25, true); // Auto-step stairs & curbs up to 0.4m
    characterController.enableSnapToGround(0.35); // Snap to slopes & ground
    characterController.setMaxSlopeClimbAngle((45 * Math.PI) / 180); // 45 degree slope max
    characterController.setMinSlopeSlideAngle((50 * Math.PI) / 180); // Slide down steep slopes
    return characterController;
  }

  /**
   * Create kinematic body for player.
   */
  public createKinematicCapsule(
    position: THREE.Vector3,
    halfHeight: number,
    radius: number,
    userData?: any
  ): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const bodyDesc = this.rapier.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, position.y, position.z);

    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = this.rapier.ColliderDesc.capsule(halfHeight, radius)
      // Character controllers query only static level geometry. Players are not movement obstacles.
      .setCollisionGroups((CollisionGroup.PLAYER_CAPSULE << 16) | CollisionGroup.STATIC_GEOMETRY)
      .setFriction(0.0)
      .setRestitution(0.0);

    const collider = this.world.createCollider(colliderDesc, body);
    if (userData) {
      (collider as any).userData = userData;
    }

    return { body, collider };
  }

  /**
   * Clear all physics entities.
   */
  public dispose(): void {
    if (this.world) {
      this.world.free();
    }
    this.staticBodies = [];
    this.staticColliders = [];
    this.isReady = false;
  }
}
