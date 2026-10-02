/**
 * Engine.ts
 * Core runtime managing the dual-camera rendering pipeline, decoupled 60Hz fixed
 * physics timestep loop, RAF execution, WebGL context lifecycle, and window resizing.
 */

import * as THREE from 'three';

export interface EngineConfig {
  canvas: HTMLCanvasElement;
  fixedTimestep?: number; // Default 1/60s (0.016667)
  maxAccumulatedTime?: number; // Default 0.1s to prevent spiral-of-death on tab unfocus
}

export type FixedUpdateCallback = (fixedDeltaTime: number) => void;
export type VariableUpdateCallback = (deltaTime: number, alpha: number) => void;

export class Engine {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly worldScene: THREE.Scene;
  public readonly viewmodelScene: THREE.Scene;
  public readonly worldCamera: THREE.PerspectiveCamera;
  public readonly viewmodelCamera: THREE.PerspectiveCamera;

  private fixedTimestep: number;
  private maxAccumulatedTime: number;
  private accumulator: number = 0;
  private lastTime: number = 0;
  private isRunning: boolean = false;
  private animationFrameId: number | null = null;

  // Callbacks
  private fixedUpdateCallbacks: Set<FixedUpdateCallback> = new Set();
  private variableUpdateCallbacks: Set<VariableUpdateCallback> = new Set();

  // Metrics
  public fps: number = 60;
  private frameCount: number = 0;
  private lastFpsUpdate: number = 0;

  constructor(config: EngineConfig) {
    this.fixedTimestep = config.fixedTimestep ?? 1 / 60;
    this.maxAccumulatedTime = config.maxAccumulatedTime ?? 0.1;

    // Initialize WebGL2 Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: config.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });

    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false; // Essential for dual-camera rendering
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Scenes
    this.worldScene = new THREE.Scene();
    this.worldScene.background = new THREE.Color(0x0a0c12);
    this.worldScene.fog = new THREE.FogExp2(0x0a0c12, 0.015);

    this.viewmodelScene = new THREE.Scene();

    // Cameras
    const aspect = window.innerWidth / window.innerHeight;
    this.worldCamera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    this.viewmodelCamera = new THREE.PerspectiveCamera(54, aspect, 0.01, 20);

    // Initial setup
    this.handleResize = this.handleResize.bind(this);
    this.handleContextLost = this.handleContextLost.bind(this);
    this.handleContextRestored = this.handleContextRestored.bind(this);
    this.loop = this.loop.bind(this);

    window.addEventListener('resize', this.handleResize);
    config.canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    config.canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);
  }

  public registerFixedUpdate(cb: FixedUpdateCallback): () => void {
    this.fixedUpdateCallbacks.add(cb);
    return () => this.fixedUpdateCallbacks.delete(cb);
  }

  public registerVariableUpdate(cb: VariableUpdateCallback): () => void {
    this.variableUpdateCallbacks.add(cb);
    return () => this.variableUpdateCallbacks.delete(cb);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.lastFpsUpdate = performance.now();
    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private loop(currentTime: number): void {
    if (!this.isRunning) return;

    // Delta time calculation in seconds
    let deltaTime = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    // Cap delta time to prevent physics explosion/spiral-of-death on background tabs
    if (deltaTime > this.maxAccumulatedTime) {
      deltaTime = this.maxAccumulatedTime;
    }

    // Accumulate time for fixed timestep physics
    this.accumulator += deltaTime;

    // Run fixed physics updates
    while (this.accumulator >= this.fixedTimestep) {
      for (const cb of this.fixedUpdateCallbacks) {
        cb(this.fixedTimestep);
      }
      this.accumulator -= this.fixedTimestep;
    }

    // Alpha blending factor for smooth visual interpolation between ticks
    const alpha = this.accumulator / this.fixedTimestep;

    // Run variable updates (camera, particle animation, viewmodel lerps)
    for (const cb of this.variableUpdateCallbacks) {
      cb(deltaTime, alpha);
    }

    // Render Dual-Camera Pipeline
    this.render();

    // Track FPS
    this.frameCount++;
    if (currentTime - this.lastFpsUpdate >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / (currentTime - this.lastFpsUpdate));
      this.frameCount = 0;
      this.lastFpsUpdate = currentTime;
    }

    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  /**
   * Dual-camera rendering pipeline:
   * 1. Clear color and depth buffers.
   * 2. Render the World Scene through the World Camera (environment, props, players, bullets).
   * 3. Clear depth buffer only.
   * 4. Render the Viewmodel Scene through the Viewmodel Camera (arms, gun) on top.
   * This guarantees weapons NEVER clip through walls, doorways, or player colliders.
   */
  public render(): void {
    // Synchronize viewmodel camera transform to world camera position & orientation
    this.viewmodelCamera.position.copy(this.worldCamera.position);
    this.viewmodelCamera.quaternion.copy(this.worldCamera.quaternion);

    // Pass 1: World
    this.renderer.clear();
    this.renderer.render(this.worldScene, this.worldCamera);

    // Pass 2: Viewmodel (clears depth buffer so weapon always appears in front)
    this.renderer.clearDepth();
    this.renderer.render(this.viewmodelScene, this.viewmodelCamera);
  }

  private handleResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;

    this.worldCamera.aspect = aspect;
    this.worldCamera.updateProjectionMatrix();

    this.viewmodelCamera.aspect = aspect;
    this.viewmodelCamera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  private handleContextLost(event: Event): void {
    event.preventDefault();
    console.warn('[Engine] WebGL Context lost. Pausing loop.');
    this.stop();
  }

  private handleContextRestored(): void {
    console.info('[Engine] WebGL Context restored. Resuming loop.');
    this.start();
  }

  public dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    this.fixedUpdateCallbacks.clear();
    this.variableUpdateCallbacks.clear();
    this.renderer.dispose();
  }
}
