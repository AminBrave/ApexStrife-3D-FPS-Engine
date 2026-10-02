import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CollisionGroup } from '../physics/PhysicsEngine';

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
        .setCollisionGroups((CollisionGroup.PLAYER_CAPSULE << 16) | (CollisionGroup.STATIC_GEOMETRY | CollisionGroup.PLAYER_CAPSULE)),
      body
    );
    const controller = this.world.createCharacterController(0.015);
    controller.enableAutostep(0.4, 0.25, true);
    controller.enableSnapToGround(0.35);
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
    c.controller.computeColliderMovement(c.collider, { x: movement.x, y: movement.y, z: movement.z });
    const corrected = c.controller.computedMovement();
    const grounded = c.controller.computedGrounded();
    const next = c.position.clone().add(corrected);
    // The authoritative server does not rely on a separate physics integration
    // step for kinematic movement. Keep the body transform synchronized immediately
    // so the next character-controller query starts from the position we just solved.
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
    const addBox = (position: [number, number, number], half: [number, number, number], rotation?: RAPIER.Rotation) => {
      const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(...position));
      const collider = this.rapier.ColliderDesc.cuboid(...half)
        .setCollisionGroups((CollisionGroup.STATIC_GEOMETRY << 16) | 0xffff);
      if (rotation) collider.setRotation(rotation);
      this.world.createCollider(collider, body);
    };

    addBox([0, -1, 0], [45, 1, 45]);
    addBox([0, 6, -45], [45, 6, 1]);
    addBox([0, 6, 45], [45, 6, 1]);
    addBox([-45, 6, 0], [1, 6, 45]);
    addBox([45, 6, 0], [1, 6, 45]);

    addBox([12, 4, -25], [7, 0.3, 6]);
    for (const p of [[6,2,-19],[18,2,-19],[6,2,-31],[18,2,-31]] as [number,number,number][]) addBox(p, [0.4,2,0.4]);

    const crates: [number,number,number,number,number,number,number][] = [
      [0,1,-10,1.6,1,0.6,0.1],[-4.5,0.75,-12,1,0.75,1,0.35],[5,0.75,-8,1.1,0.75,1.1,-0.2],
      [-14,1.2,-18,2,1.2,0.8,0.4],[-18,0.8,-24,1.25,0.8,1.25,0],
      [18,1,-5,1.5,1,0.75,-0.3],[22,1.4,-14,2.1,1.4,0.9,0.2],
      [-8,1.2,10,1.75,1.2,0.75,0],[8,1.2,10,1.75,1.2,0.75,0],
    ];
    for (const [x,y,z,hx,hy,hz,ry] of crates) {
      addBox([x,y,z],[hx,hy,hz], { x: 0, y: Math.sin(ry / 2), z: 0, w: Math.cos(ry / 2) });
    }

    const rampAngle = -25 * Math.PI / 180;
    addBox([12,2,-14.5],[2,0.25,4.75], { x: Math.sin(rampAngle / 2), y: 0, z: 0, w: Math.cos(rampAngle / 2) });
  }

  public dispose(): void {
    this.world.free();
    this.characters.clear();
  }
}
