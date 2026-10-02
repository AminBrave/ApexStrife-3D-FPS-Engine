/**
 * ArenaDefinition.ts
 * Single source of truth for gameplay-critical arena collision geometry and spawn points.
 */
import type { SurfaceMaterialId } from './SurfaceMaterial';

export interface ArenaBox {
  position: [number, number, number];
  halfExtents: [number, number, number];
  rotationY?: number;
  rotationX?: number;
  type: string;
  material: SurfaceMaterialId;
}

export const ARENA_SPAWNS: [number, number, number][] = [
  [0, 1.02, 8], [8, 1.02, 8], [-8, 1.02, 8],
  [0, 1.02, -2], [12, 5.22, -25], [-12, 1.02, -2],
];

export const ARENA_BOXES: ArenaBox[] = [
  { position: [0, -1, 0], halfExtents: [45, 1, 45], type: 'ground', material: 'asphalt' },
  { position: [0, 6, -45], halfExtents: [45, 6, 1], type: 'wall', material: 'concrete' },
  { position: [0, 6, 45], halfExtents: [45, 6, 1], type: 'wall', material: 'concrete' },
  { position: [-45, 6, 0], halfExtents: [1, 6, 45], type: 'wall', material: 'concrete' },
  { position: [45, 6, 0], halfExtents: [1, 6, 45], type: 'wall', material: 'concrete' },

  { position: [12, 4, -25], halfExtents: [7, 0.3, 6], type: 'platform', material: 'metal' },
  { position: [6, 2, -19], halfExtents: [0.4, 2, 0.4], type: 'pillar', material: 'metal' },
  { position: [18, 2, -19], halfExtents: [0.4, 2, 0.4], type: 'pillar', material: 'metal' },
  { position: [6, 2, -31], halfExtents: [0.4, 2, 0.4], type: 'pillar', material: 'metal' },
  { position: [18, 2, -31], halfExtents: [0.4, 2, 0.4], type: 'pillar', material: 'metal' },
  { position: [12, 2, -14.5], halfExtents: [2, 0.25, 4.75], rotationX: -25 * Math.PI / 180, type: 'ramp', material: 'metal' },

  { position: [0, 1, -10], halfExtents: [1.6, 1, 0.6], rotationY: 0.1, type: 'crate', material: 'wood' },
  { position: [-4.5, 0.75, -12], halfExtents: [1, 0.75, 1], rotationY: 0.35, type: 'crate', material: 'wood' },
  { position: [5, 0.75, -8], halfExtents: [1.1, 0.75, 1.1], rotationY: -0.2, type: 'crate', material: 'wood' },
  { position: [-14, 1.2, -18], halfExtents: [2, 1.2, 0.8], rotationY: 0.4, type: 'crate', material: 'wood' },
  { position: [-18, 0.8, -24], halfExtents: [1.25, 0.8, 1.25], type: 'crate', material: 'wood' },
  { position: [18, 1, -5], halfExtents: [1.5, 1, 0.75], rotationY: -0.3, type: 'crate', material: 'wood' },
  { position: [22, 1.4, -14], halfExtents: [2.1, 1.4, 0.9], rotationY: 0.2, type: 'crate', material: 'wood' },
  { position: [-8, 1.2, 10], halfExtents: [1.75, 1.2, 0.75], type: 'crate', material: 'wood' },
  { position: [8, 1.2, 10], halfExtents: [1.75, 1.2, 0.75], type: 'crate', material: 'wood' },

  // Town block: segmented walls leave navigable street/door openings.
  { position: [-27, 3.0, -24], halfExtents: [8, 3, 0.55], type: 'building_wall', material: 'brick' },
  { position: [-35, 3.0, -31], halfExtents: [0.55, 3, 7], type: 'building_wall', material: 'brick' },
  { position: [-19, 3.0, -31], halfExtents: [0.55, 3, 7], type: 'building_wall', material: 'brick' },
  { position: [-27, 5.9, -31], halfExtents: [8, 0.45, 0.7], type: 'roof', material: 'metal' },
  { position: [-27, 1.8, -17], halfExtents: [2.2, 1.8, 0.5], type: 'shop_counter', material: 'wood' },

  { position: [29, 3.0, -28], halfExtents: [9, 3, 0.55], type: 'building_wall', material: 'concrete' },
  { position: [20, 3.0, -20], halfExtents: [0.55, 3, 8], type: 'building_wall', material: 'concrete' },
  { position: [38, 3.0, -20], halfExtents: [0.55, 3, 8], type: 'building_wall', material: 'concrete' },
  { position: [29, 5.8, -20], halfExtents: [9, 0.45, 0.7], type: 'roof', material: 'metal' },

  // Street furniture / hard cover.
  { position: [-2, 0.65, 22], halfExtents: [2.2, 0.65, 0.8], type: 'dumpster', material: 'metal' },
  { position: [17, 0.65, 20], halfExtents: [1.8, 0.65, 0.8], type: 'dumpster', material: 'metal' },
  { position: [-24, 1.0, 12], halfExtents: [3, 1, 0.5], type: 'barrier', material: 'concrete' },
  { position: [24, 1.0, 12], halfExtents: [3, 1, 0.5], type: 'barrier', material: 'concrete' },
  { position: [-6, 1.5, 29], halfExtents: [0.45, 1.5, 0.45], type: 'streetlight', material: 'metal' },
  { position: [10, 1.5, 29], halfExtents: [0.45, 1.5, 0.45], type: 'streetlight', material: 'metal' },
  { position: [-6, 3.8, 29], halfExtents: [2.0, 0.18, 0.18], type: 'streetlight_arm', material: 'metal' },
  { position: [10, 3.8, 29], halfExtents: [2.0, 0.18, 0.18], type: 'streetlight_arm', material: 'metal' },
];

export const ARENA_FLOOR_TOP = 0;
export const ARENA_MIN_Y = -8;
