/**
 * ArenaDefinition.ts
 * Single source of truth for gameplay-critical arena collision geometry and spawn points.
 */

export interface ArenaBox {
  position: [number, number, number];
  halfExtents: [number, number, number];
  rotationY?: number;
  rotationX?: number;
  type: string;
}

export const ARENA_SPAWNS: [number, number, number][] = [
  [0, 1.02, 8],
  [8, 1.02, 8],
  [-8, 1.02, 8],
  [0, 1.02, -2],
  [12, 4.9, -25],
  [-12, 1.02, -2],
];

export const ARENA_BOXES: ArenaBox[] = [
  { position: [0, -1, 0], halfExtents: [45, 1, 45], type: 'ground' },
  { position: [0, 6, -45], halfExtents: [45, 6, 1], type: 'wall' },
  { position: [0, 6, 45], halfExtents: [45, 6, 1], type: 'wall' },
  { position: [-45, 6, 0], halfExtents: [1, 6, 45], type: 'wall' },
  { position: [45, 6, 0], halfExtents: [1, 6, 45], type: 'wall' },

  { position: [12, 4, -25], halfExtents: [7, 0.3, 6], type: 'platform' },
  { position: [6, 2, -19], halfExtents: [0.4, 2, 0.4], type: 'pillar' },
  { position: [18, 2, -19], halfExtents: [0.4, 2, 0.4], type: 'pillar' },
  { position: [6, 2, -31], halfExtents: [0.4, 2, 0.4], type: 'pillar' },
  { position: [18, 2, -31], halfExtents: [0.4, 2, 0.4], type: 'pillar' },

  { position: [12, 2, -14.5], halfExtents: [2, 0.25, 4.75], rotationX: -25 * Math.PI / 180, type: 'ramp' },

  { position: [0, 1, -10], halfExtents: [1.6, 1, 0.6], rotationY: 0.1, type: 'crate' },
  { position: [-4.5, 0.75, -12], halfExtents: [1, 0.75, 1], rotationY: 0.35, type: 'crate' },
  { position: [5, 0.75, -8], halfExtents: [1.1, 0.75, 1.1], rotationY: -0.2, type: 'crate' },
  { position: [-14, 1.2, -18], halfExtents: [2, 1.2, 0.8], rotationY: 0.4, type: 'crate' },
  { position: [-18, 0.8, -24], halfExtents: [1.25, 0.8, 1.25], type: 'crate' },
  { position: [18, 1, -5], halfExtents: [1.5, 1, 0.75], rotationY: -0.3, type: 'crate' },
  { position: [22, 1.4, -14], halfExtents: [2.1, 1.4, 0.9], rotationY: 0.2, type: 'crate' },
  { position: [-8, 1.2, 10], halfExtents: [1.75, 1.2, 0.75], type: 'crate' },
  { position: [8, 1.2, 10], halfExtents: [1.75, 1.2, 0.75], type: 'crate' },
];

export const ARENA_FLOOR_TOP = 0;
export const ARENA_MIN_Y = -8;
