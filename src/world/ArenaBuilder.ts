/**
 * ArenaBuilder.ts
 * Generates the sci-fi combat training facility arena:
 * floors, perimeter containment walls, ramps, elevated catwalks, tactical cover crates,
 * dynamic shadows, atmospheric lighting, and interactive target dummies.
 */

import * as THREE from 'three';
import { PhysicsEngine } from '../physics/PhysicsEngine';

export class ArenaBuilder {
  private scene: THREE.Scene;
  private physicsEngine: PhysicsEngine;

  constructor(scene: THREE.Scene, physicsEngine: PhysicsEngine) {
    this.scene = scene;
    this.physicsEngine = physicsEngine;
  }

  public build(): void {
    // 1. Lighting Setup
    const ambientLight = new THREE.AmbientLight(0x1a2233, 1.2);
    this.scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0x384a68, 0x111622, 0.8);
    this.scene.add(hemiLight);

    // Key directional light with high quality shadow mapping
    const dirLight = new THREE.DirectionalLight(0xdde8ff, 2.2);
    dirLight.position.set(25, 45, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 120;
    const d = 45;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0005;
    this.scene.add(dirLight);

    // Atmospheric neon accent point lights
    const cyanLight = new THREE.PointLight(0x00f0ff, 3.5, 28);
    cyanLight.position.set(-15, 6, -10);
    this.scene.add(cyanLight);

    const orangeLight = new THREE.PointLight(0xff6600, 3.5, 28);
    orangeLight.position.set(15, 6, -20);
    this.scene.add(orangeLight);

    // 2. Materials
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x181c24,
      roughness: 0.65,
      metalness: 0.35,
    });

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x222733,
      roughness: 0.7,
      metalness: 0.2,
    });

    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x2e3648,
      roughness: 0.5,
      metalness: 0.6,
    });

    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.45,
      metalness: 0.5,
    });

    const neonCyan = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const neonOrange = new THREE.MeshBasicMaterial({ color: 0xff6600 });

    // 3. Main Arena Floor (90m x 90m)
    const floorGeom = new THREE.BoxGeometry(90, 2, 90);
    const floorMesh = new THREE.Mesh(floorGeom, floorMat);
    floorMesh.position.set(0, -1, 0);
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);

    // Grid markings on floor
    const grid = new THREE.GridHelper(90, 45, 0x00f0ff, 0x263345);
    grid.position.y = 0.02;
    this.scene.add(grid);

    // Physics floor
    this.physicsEngine.createStaticBox(
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(45, 1, 45),
      undefined,
      { type: 'ground' }
    );

    // 4. Perimeter Walls (Height: 12m)
    const wallHeight = 12;
    const wallThickness = 2;
    const halfWidth = 45;

    const wallsData = [
      { pos: new THREE.Vector3(0, wallHeight / 2, -halfWidth), size: new THREE.Vector3(90, wallHeight, wallThickness) },
      { pos: new THREE.Vector3(0, wallHeight / 2, halfWidth), size: new THREE.Vector3(90, wallHeight, wallThickness) },
      { pos: new THREE.Vector3(-halfWidth, wallHeight / 2, 0), size: new THREE.Vector3(wallThickness, wallHeight, 90) },
      { pos: new THREE.Vector3(halfWidth, wallHeight / 2, 0), size: new THREE.Vector3(wallThickness, wallHeight, 90) },
    ];

    wallsData.forEach(({ pos, size }) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), wallMat);
      mesh.position.copy(pos);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.scene.add(mesh);

      // Neon trim strip on wall
      const trimGeom = new THREE.BoxGeometry(size.x > size.z ? size.x : 0.4, 0.25, size.z > size.x ? size.z : 0.4);
      const trimMesh = new THREE.Mesh(trimGeom, neonCyan);
      trimMesh.position.set(pos.x, 3.5, pos.z);
      this.scene.add(trimMesh);

      this.physicsEngine.createStaticBox(
        pos,
        new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2),
        undefined,
        { type: 'wall' }
      );
    });

    // 5. High Catwalk / Elevated Sniping Platform (y = 4.0m)
    const platformPos = new THREE.Vector3(12, 4.0, -25);
    const platformSize = new THREE.Vector3(14, 0.6, 12);

    const platformMesh = new THREE.Mesh(
      new THREE.BoxGeometry(platformSize.x, platformSize.y, platformSize.z),
      accentMat
    );
    platformMesh.position.copy(platformPos);
    platformMesh.castShadow = true;
    platformMesh.receiveShadow = true;
    this.scene.add(platformMesh);

    this.physicsEngine.createStaticBox(
      platformPos,
      new THREE.Vector3(platformSize.x / 2, platformSize.y / 2, platformSize.z / 2),
      undefined,
      { type: 'platform' }
    );

    // Platform support pillars
    const pillarPositions = [
      new THREE.Vector3(6, 2, -19),
      new THREE.Vector3(18, 2, -19),
      new THREE.Vector3(6, 2, -31),
      new THREE.Vector3(18, 2, -31),
    ];
    pillarPositions.forEach((pPos) => {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 4, 12), accentMat);
      pillar.position.copy(pPos);
      pillar.castShadow = true;
      this.scene.add(pillar);

      this.physicsEngine.createStaticBox(
        pPos,
        new THREE.Vector3(0.4, 2, 0.4),
        undefined,
        { type: 'pillar' }
      );
    });

    // 6. Slanted Access Ramp (Testing character slope climb)
    const rampLength = 9.5;
    const rampWidth = 4.0;
    const rampThickness = 0.5;
    const rampAngle = (25 * Math.PI) / 180; // 25 degree gentle climbable slope

    const rampPos = new THREE.Vector3(12, 2.0, -14.5);
    const rampMesh = new THREE.Mesh(
      new THREE.BoxGeometry(rampWidth, rampThickness, rampLength),
      accentMat
    );
    rampMesh.rotation.x = -rampAngle;
    rampMesh.position.copy(rampPos);
    rampMesh.castShadow = true;
    rampMesh.receiveShadow = true;
    this.scene.add(rampMesh);

    const rampQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-rampAngle, 0, 0));
    this.physicsEngine.createStaticBox(
      rampPos,
      new THREE.Vector3(rampWidth / 2, rampThickness / 2, rampLength / 2),
      rampQuat,
      { type: 'ramp' }
    );

    // 7. Tactical Cover Crates & Barrier Blocks
    const crates = [
      // Central skirmish cover
      { pos: new THREE.Vector3(0, 1.0, -10), size: new THREE.Vector3(3.2, 2.0, 1.2), rotY: 0.1 },
      { pos: new THREE.Vector3(-4.5, 0.75, -12), size: new THREE.Vector3(2.0, 1.5, 2.0), rotY: 0.35 },
      { pos: new THREE.Vector3(5.0, 0.75, -8), size: new THREE.Vector3(2.2, 1.5, 2.2), rotY: -0.2 },
      // Left lane cover
      { pos: new THREE.Vector3(-14, 1.2, -18), size: new THREE.Vector3(4.0, 2.4, 1.6), rotY: 0.4 },
      { pos: new THREE.Vector3(-18, 0.8, -24), size: new THREE.Vector3(2.5, 1.6, 2.5), rotY: 0.0 },
      // Right lane obstacles
      { pos: new THREE.Vector3(18, 1.0, -5), size: new THREE.Vector3(3.0, 2.0, 1.5), rotY: -0.3 },
      { pos: new THREE.Vector3(22, 1.4, -14), size: new THREE.Vector3(4.2, 2.8, 1.8), rotY: 0.2 },
      // Back sniper cover
      { pos: new THREE.Vector3(-8, 1.2, 10), size: new THREE.Vector3(3.5, 2.4, 1.5), rotY: 0 },
      { pos: new THREE.Vector3(8, 1.2, 10), size: new THREE.Vector3(3.5, 2.4, 1.5), rotY: 0 },
    ];

    crates.forEach(({ pos, size, rotY }) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), crateMat);
      mesh.position.copy(pos);
      mesh.rotation.y = rotY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      // Fluorescent warning stripe on crate
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(size.x * 1.01, 0.15, size.z * 1.01), neonOrange);
      stripe.position.copy(pos);
      stripe.rotation.y = rotY;
      this.scene.add(stripe);

      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
      this.physicsEngine.createStaticBox(
        pos,
        new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2),
        quat,
        { type: 'crate' }
      );
    });

    // 8. Target Dummies for Practice Shooting
    this.createTargetDummy(new THREE.Vector3(-8, 0, -8), 'Target Dummy A');
    this.createTargetDummy(new THREE.Vector3(0, 0, -22), 'Target Dummy B');
    this.createTargetDummy(new THREE.Vector3(-18, 0, -32), 'Target Dummy C');
  }

  private createTargetDummy(pos: THREE.Vector3, name: string): void {
    const dummyGroup = new THREE.Group();
    dummyGroup.position.copy(pos);

    // Stand base
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.2, 16), baseMat);
    base.position.y = 0.1;
    dummyGroup.add(base);

    // Pole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 10), baseMat);
    pole.position.y = 0.65;
    dummyGroup.add(pole);

    // Torso Target (Red bullseye)
    const torsoMat = new THREE.MeshStandardMaterial({ color: 0xbb2222, metalness: 0.3 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.15), torsoMat);
    torso.position.y = 1.35;
    torso.castShadow = true;
    (torso as any).userData = { id: name, type: 'dummy', part: 'body' };
    dummyGroup.add(torso);

    // Head Target (Yellow headshot zone)
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, metalness: 0.4 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), headMat);
    head.position.y = 1.85;
    head.castShadow = true;
    (head as any).userData = { id: name, type: 'dummy', part: 'head' };
    dummyGroup.add(head);

    this.scene.add(dummyGroup);

    // Physics colliders for target torso and head
    this.physicsEngine.createStaticBox(
      new THREE.Vector3(pos.x, pos.y + 1.35, pos.z),
      new THREE.Vector3(0.25, 0.35, 0.1),
      undefined,
      { id: name, type: 'dummy', part: 'body' }
    );

    this.physicsEngine.createStaticBox(
      new THREE.Vector3(pos.x, pos.y + 1.85, pos.z),
      new THREE.Vector3(0.18, 0.18, 0.18),
      undefined,
      { id: name, type: 'dummy', part: 'head' }
    );
  }
}
