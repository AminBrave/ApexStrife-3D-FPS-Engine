import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CollisionGroup } from '../physics/PhysicsEngine';
import { ARENA_BOXES } from '../world/ArenaDefinition';

export interface ServerCharacter {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  position: THREE.Vector3;
}

export class ServerPhysics {
  public world!: RAPIER.World;
  private rapier!: typeof RAPIER;
  private characters = new Map<string, ServerCharacter>();

  public async init(): Promise<void> {
    await RAPIER.init();
    this.rapier = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -24, z: 0 });
    this.world.integrationParameters.numSolverIterations = 4;
    this.buildArena();
  }

  public addCharacter(id: string, position: [number, number, number]): ServerCharacter {
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(...position)
    );
    const collider = this.world.createCollider(
      this.rapier.ColliderDesc.capsule(0.55, 0.35)
          // Characters collide with level geometry, not other players.
        .setCollisionGroups((CollisionGroup.PLAYER_CAPSULE << 16) | CollisionGroup.STATIC_GEOMETRY),
      body
    );
    const controller = this.world.createCharacterController(0.015);
    controller.enableAutostep(0.4, 0.25, false);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.enableSnapToGround(0.2);
    controller.setMaxSlopeClimbAngle(Math.PI / 4);
    controller.setMinSlopeSlideAngle(50 * Math.PI / 180);
    const character = { body, collider, controller, position: new THREE.Vector3(...position) };
    this.characters.set(id, character);
    return character;
  }

  public removeCharacter(id: string): void {
    const c = this.characters.get(id);
    if (!c) return;
    this.world.removeRigidBody(c.body);
    this.characters.delete(id);
  }

  public moveCharacter(id: string, movement: THREE.Vector3): { position: THREE.Vector3; grounded: boolean } {
    const c = this.characters.get(id);
    if (!c) throw new Error(`Missing server character: ${id}`);
    c.controller.computeColliderMovement(
      c.collider,
      { x: movement.x, y: movement.y, z: movement.z },
      undefined,
      (CollisionGroup.PLAYER_CAPSULE << 16) | CollisionGroup.STATIC_GEOMETRY
    );
    const corrected = c.controller.computedMovement();
    const grounded = c.controller.computedGrounded();
    const next = c.position.clone().add(corrected);
    // Apply the corrected transform immediately and queue the same transform for
    // Rapier's next step so the query pipeline and authoritative state stay aligned.
    c.position.copy(next);
    c.body.setTranslation({ x: next.x, y: next.y, z: next.z }, true);
    c.body.setNextKinematicTranslation({ x: next.x, y: next.y, z: next.z });
    return { position: next, grounded };
  }

  public setCharacterPosition(id: string, position: [number, number, number]): void {
    const c = this.characters.get(id);
    if (!c) return;
    c.position.set(position[0], position[1], position[2]);
    c.body.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
    c.body.setNextKinematicTranslation({ x: position[0], y: position[1], z: position[2] });
  }

  public step(): void {
    this.world.step();
  }

  public raycast(origin: [number, number, number], direction: [number, number, number], maxDistance: number): any {
    const dir = new THREE.Vector3(...direction).normalize();
    const ray = new this.rapier.Ray(
      { x: origin[0], y: origin[1], z: origin[2] },
      { x: dir.x, y: dir.y, z: dir.z }
    );
    const staticOnlyGroups = (0xffff << 16) | CollisionGroup.STATIC_GEOMETRY;
    return this.world.castRayAndGetNormal(ray, maxDistance, true, undefined, staticOnlyGroups) as any;
  }

  private buildArena(): void {
    for (const box of ARENA_BOXES) {
      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed().setTranslation(...box.position)
      );

      let collider = this.rapier.ColliderDesc.cuboid(...box.halfExtents)
        .setCollisionGroups((CollisionGroup.STATIC_GEOMETRY << 16) | 0xffff);

      if (box.rotationX || box.rotationY) {
        const q = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(box.rotationX || 0, box.rotationY || 0, 0)
        );
        collider = collider.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      }

      const created = this.world.createCollider(collider, body);
      (created as any).userData = { type: box.type };
    }
  }

  public dispose(): void {
    this.world.free();
    this.characters.clear();
  }
}
