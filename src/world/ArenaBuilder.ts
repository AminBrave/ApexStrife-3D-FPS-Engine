/**
 * ArenaBuilder.ts
 * Shared collision/visual town arena with sunset lighting and material-aware surfaces.
 */
import * as THREE from 'three';
import { PhysicsEngine } from '../physics/PhysicsEngine';
import { ARENA_BOXES } from './ArenaDefinition';
import { SURFACE_MATERIALS, type SurfaceMaterialId } from './SurfaceMaterial';

export class ArenaBuilder {
  private scene: THREE.Scene;
  private physicsEngine: PhysicsEngine;

  constructor(scene: THREE.Scene, physicsEngine: PhysicsEngine) {
    this.scene = scene;
    this.physicsEngine = physicsEngine;
  }

  public build(): void {
    this.buildLighting();
    this.buildSharedGeometry();
    this.buildStreetDetails();
    this.createTargetDummy(new THREE.Vector3(-8, 0, -8), 'Target Dummy A');
    this.createTargetDummy(new THREE.Vector3(0, 0, -22), 'Target Dummy B');
    this.createTargetDummy(new THREE.Vector3(-18, 0, -32), 'Target Dummy C');
  }

  private buildLighting(): void {
    this.scene.background = new THREE.Color(0x5d7894);

    const hemi = new THREE.HemisphereLight(0xffc58a, 0x263044, 1.65);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffb36b, 3.0);
    sun.position.set(-28, 42, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 130;
    sun.shadow.camera.left = -55;
    sun.shadow.camera.right = 55;
    sun.shadow.camera.top = 55;
    sun.shadow.camera.bottom = -55;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    const warmFill = new THREE.PointLight(0xff8a52, 9, 38);
    warmFill.position.set(20, 7, -24);
    this.scene.add(warmFill);

    const coolFill = new THREE.PointLight(0x6aa8ff, 4, 42);
    coolFill.position.set(-25, 5, 10);
    this.scene.add(coolFill);

    const street = new THREE.PointLight(0xffd28a, 7, 18);
    street.position.set(10, 4, 29);
    this.scene.add(street);
  }

  private buildSharedGeometry(): void {
    const grid = new THREE.GridHelper(90, 45, 0x6e8092, 0x394552);
    grid.position.y = 0.02;
    this.scene.add(grid);

    for (const box of ARENA_BOXES) {
      const size = new THREE.Vector3(box.halfExtents[0] * 2, box.halfExtents[1] * 2, box.halfExtents[2] * 2);
      const materialId = box.material as SurfaceMaterialId;
      const surface = SURFACE_MATERIALS[materialId] ?? SURFACE_MATERIALS.concrete;
      const material = new THREE.MeshStandardMaterial({
        color: this.colorForType(box.type, materialId),
        roughness: surface.roughness,
        metalness: surface.metalness,
      });

      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
      mesh.position.set(...box.position);
      mesh.rotation.x = box.rotationX ?? 0;
      mesh.rotation.y = box.rotationY ?? 0;
      mesh.castShadow = box.type !== 'ground';
      mesh.receiveShadow = true;
      mesh.userData = { type: box.type, material: materialId };
      this.scene.add(mesh);

      if (box.type === 'crate' || box.type === 'dumpster') this.addObjectDetail(mesh, box.type, size);
      if (box.type === 'building_wall') this.addWindows(box.position, size, box.rotationY ?? 0);
      if (box.type === 'streetlight_arm') {
        const lamp = new THREE.PointLight(0xffc878, 2.5, 12);
        lamp.position.set(box.position[0] + 1.5, box.position[1] - 0.1, box.position[2]);
        this.scene.add(lamp);
      }

      const quat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(box.rotationX ?? 0, box.rotationY ?? 0, 0)
      );
      this.physicsEngine.createStaticBox(
        new THREE.Vector3(...box.position),
        new THREE.Vector3(...box.halfExtents),
        quat,
        { type: box.type, material: materialId }
      );
    }
  }

  private colorForType(type: string, material: SurfaceMaterialId): number {
    if (type === 'ground') return 0x313943;
    if (type === 'building_wall') return material === 'brick' ? 0x7b4a3b : 0x626a73;
    if (type === 'roof') return 0x343b45;
    if (type === 'crate' || type === 'shop_counter') return 0x6b4a2f;
    if (type === 'dumpster') return 0x3f5860;
    if (type === 'streetlight' || type === 'streetlight_arm') return 0x252a30;
    if (type === 'barrier') return 0x8b8f92;
    return material === 'metal' ? 0x4e5967 : 0x59616b;
  }

  private addObjectDetail(mesh: THREE.Mesh, type: string, size: THREE.Vector3): void {
    const accent = new THREE.MeshStandardMaterial({ color: type === 'dumpster' ? 0x172126 : 0xc27a35, metalness: 0.65, roughness: 0.35 });
    const lid = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.86, 0.06, size.z * 0.86), accent);
    lid.position.set(0, size.y * 0.53, 0);
    mesh.add(lid);
  }

  private addWindows(position: [number, number, number], size: THREE.Vector3, rotationY: number): void {
    const glass = new THREE.MeshBasicMaterial({ color: 0x9ddcff, transparent: true, opacity: 0.7 });
    const count = Math.max(2, Math.floor(size.x / 3));
    for (let i = 0; i < count; i++) {
      const x = -size.x * 0.5 + (i + 0.5) * (size.x / count);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.1, 0.05), glass);
      pane.position.set(position[0] + x, position[1] + 1.9, position[2] - size.z * 0.51);
      pane.rotation.y = rotationY;
      pane.userData = { material: 'glass' };
      this.scene.add(pane);
    }
  }

  private buildStreetDetails(): void {
    // Simple town geometry that is visual-only; gameplay collision remains driven by ARENA_BOXES.
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x20252b, roughness: 0.92 });
    const road = new THREE.Mesh(new THREE.BoxGeometry(48, 0.04, 5), roadMat);
    road.position.set(0, 0.025, 24);
    road.receiveShadow = true;
    this.scene.add(road);

    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffd78a });
    for (let x = -20; x <= 20; x += 8) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(4, 0.045, 0.12), lineMat);
      line.position.set(x, 0.05, 24);
      this.scene.add(line);
    }

    const signMat = new THREE.MeshStandardMaterial({ color: 0x35404c, metalness: 0.7, roughness: 0.35 });
    const sign = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 10), signMat);
    pole.position.y = 1.2;
    sign.add(pole);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.55, 0.08), new THREE.MeshBasicMaterial({ color: 0xff9b58 }));
    board.position.y = 2.35;
    sign.add(board);
    sign.position.set(-10, 0, 24);
    this.scene.add(sign);
  }

  private createTargetDummy(pos: THREE.Vector3, name: string): void {
    const group = new THREE.Group();
    group.position.copy(pos);

    const baseMat = new THREE.MeshStandardMaterial({ color: 0x33373d, metalness: 0.8, roughness: 0.35 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.2, 16), baseMat);
    base.position.y = 0.1;
    group.add(base);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 10), baseMat);
    pole.position.y = 0.65;
    group.add(pole);

    const torsoMat = new THREE.MeshStandardMaterial({ color: 0xbb332f, metalness: 0.25, roughness: 0.6 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.15), torsoMat);
    torso.position.y = 1.35;
    torso.castShadow = true;
    torso.userData = { id: name, type: 'dummy', part: 'body' };
    group.add(torso);

    const headMat = new THREE.MeshStandardMaterial({ color: 0xffcc55, metalness: 0.25, roughness: 0.5 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), headMat);
    head.position.y = 1.85;
    head.castShadow = true;
    head.userData = { id: name, type: 'dummy', part: 'head' };
    group.add(head);

    this.scene.add(group);
    this.physicsEngine.createStaticBox(
      new THREE.Vector3(pos.x, pos.y + 1.35, pos.z),
      new THREE.Vector3(0.25, 0.35, 0.1),
      undefined,
      { id: name, type: 'dummy', part: 'body', material: 'metal' },
      { sensor: true }
    );
    this.physicsEngine.createStaticBox(
      new THREE.Vector3(pos.x, pos.y + 1.85, pos.z),
      new THREE.Vector3(0.18, 0.18, 0.18),
      undefined,
      { id: name, type: 'dummy', part: 'head', material: 'metal' },
      { sensor: true }
    );
  }
}
