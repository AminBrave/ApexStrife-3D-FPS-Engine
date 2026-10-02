/**
 * main.ts
 * Application bootstrapper and dependency wireup.
 * Connects Engine, Rapier Physics, PlayerController, WeaponManager,
 * StatePredictor, Interpolator, and NetworkManager.
 */

import { Engine } from './core/Engine';
import { PhysicsEngine } from './physics/PhysicsEngine';
import { ArenaBuilder } from './world/ArenaBuilder';
import { CharacterController } from './physics/CharacterController';
import { FirstPersonCamera } from './player/FirstPersonCamera';
import { WeaponManager } from './weapons/WeaponManager';
import { RecoilSystem } from './weapons/RecoilSystem';
import { StatePredictor } from './netcode/StatePredictor';
import { Interpolator } from './netcode/Interpolator';
import { NetworkManager } from './netcode/NetworkManager';
import { PlayerController } from './player/PlayerController';

export interface GameInstance {
  engine: Engine;
  physicsEngine: PhysicsEngine;
  characterController: CharacterController;
  camera: FirstPersonCamera;
  weaponManager: WeaponManager;
  recoilSystem: RecoilSystem;
  statePredictor: StatePredictor;
  interpolator: Interpolator;
  networkManager: NetworkManager;
  playerController: PlayerController;
  dispose: () => void;
}

export async function bootstrapGame(canvas: HTMLCanvasElement): Promise<GameInstance> {
  // 1. Initialize Decoupled Dual-Camera Engine
  const engine = new Engine({
    canvas,
    fixedTimestep: 1 / 60,
    maxAccumulatedTime: 0.1,
  });

  // 2. Initialize Rapier3D Physics Engine
  const physicsEngine = new PhysicsEngine();
  await physicsEngine.init();

  // 3. Build Sci-Fi Tactical Training Arena
  const arenaBuilder = new ArenaBuilder(engine.worldScene, physicsEngine);
  arenaBuilder.build();
  // Populate Rapier's broad-phase before the first character-controller query.
  physicsEngine.step(1 / 60);

  // 4. Kinematic Character Controller
  const characterController = new CharacterController(physicsEngine);

  // 5. First-Person Camera System (Pitch/Yaw, Bobbing, Landing Dip, Dual-Cam Sync)
  const camera = new FirstPersonCamera({
    worldCamera: engine.worldCamera,
    viewmodelCamera: engine.viewmodelCamera,
    domElement: canvas,
    mouseSensitivity: 0.0022,
    adsMultiplier: 0.52,
    baseFov: 75,
    adsFov: 46,
  });

  // 6. Weapon System & Recoil Engine
  const weaponManager = new WeaponManager(
    engine.viewmodelScene,
    engine.viewmodelCamera,
    engine.worldScene,
    physicsEngine
  );
  const recoilSystem = weaponManager.recoilSystem;

  // 7. Netcode: Client-side State Predictor & Entity Interpolator
  const statePredictor = new StatePredictor();
  const interpolator = new Interpolator(engine.worldScene);

  // 8. Netcode: Network Manager
  const networkManager = new NetworkManager();

  // Snapshot reception is wired after PlayerController creation so one authoritative
  // handler owns movement reconciliation, remote interpolation, and combat state.

  // Wire welcome packet for initial spawn
  networkManager.onWelcomeCallback = (welcome) => {
    characterController.setPosition({
      x: welcome.spawnPosition[0],
      y: welcome.spawnPosition[1],
      z: welcome.spawnPosition[2],
    } as any);
  };

  // 9. Player Controller (Input listener, prediction registration, character driving)
  const playerController = new PlayerController(
    characterController,
    camera,
    weaponManager,
    statePredictor,
    networkManager
  );

  networkManager.onSnapshotCallback = (snapshot) => {
    statePredictor.reconcile(
      snapshot.lastAckSequence,
      snapshot.authoritativeState,
      characterController,
      1 / 60
    );
    interpolator.handleSnapshot(
      snapshot.timestamp,
      snapshot.entities,
      networkManager.clientId
    );

    playerController.health = snapshot.health;
    playerController.maxHealth = snapshot.maxHealth;
    playerController.shield = snapshot.shield;
    playerController.maxShield = snapshot.maxShield;
    weaponManager.ammoInMag = [
      snapshot.ammoInMag.ar,
      snapshot.ammoInMag.shotgun,
      snapshot.ammoInMag.sniper,
      snapshot.ammoInMag.plasma,
    ];
    weaponManager.ammoInReserve = [
      snapshot.ammoInReserve.ar,
      snapshot.ammoInReserve.shotgun,
      snapshot.ammoInReserve.sniper,
      snapshot.ammoInReserve.plasma,
    ];

    const weaponIndex = ['ar', 'shotgun', 'sniper', 'plasma'].indexOf(snapshot.weaponId);
    if (weaponIndex >= 0 && weaponIndex !== weaponManager.currentWeaponIndex) {
      weaponManager.currentWeaponIndex = weaponIndex;
    }
  };

  // Connect to authoritative WebSocket server
  networkManager.connect();

  // 10. Register Fixed Physics Loop (60Hz)
  engine.registerFixedUpdate((fixedDeltaTime) => {
    // Process input & simulate player kinematics
    playerController.fixedUpdate(fixedDeltaTime);
    // Step Rapier3D physics simulation
    physicsEngine.step(fixedDeltaTime);
  });

  // 11. Register Variable Render Loop (RAF)
  engine.registerVariableUpdate((deltaTime, alpha) => {
    // Smooth camera visual interpolation and weapon viewmodel animations
    playerController.variableUpdate(deltaTime, alpha);
    // Interpolate remote proxies
    interpolator.update(networkManager.getServerTime());
  });

  // Start Game Engine Loop
  engine.start();

  return {
    engine,
    physicsEngine,
    characterController,
    camera,
    weaponManager,
    recoilSystem,
    statePredictor,
    interpolator,
    networkManager,
    playerController,
    dispose: () => {
      engine.dispose();
      physicsEngine.dispose();
      camera.dispose();
      weaponManager.dispose();
      playerController.dispose();
      networkManager.dispose();
    },
  };
}
