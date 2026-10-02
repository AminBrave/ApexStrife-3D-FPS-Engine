/**
 * SurfaceMaterial.ts
 * Shared surface metadata for collision and bullet-impact presentation.
 */
export type SurfaceMaterialId = 'concrete' | 'metal' | 'wood' | 'glass' | 'asphalt' | 'dirt' | 'brick';

export interface SurfaceMaterial {
  id: SurfaceMaterialId;
  impactColor: number;
  sparkCount: number;
  sparkSpeed: number;
  roughness: number;
  metalness: number;
}

export const SURFACE_MATERIALS: Record<SurfaceMaterialId, SurfaceMaterial> = {
  concrete: { id: 'concrete', impactColor: 0xd9e0e6, sparkCount: 10, sparkSpeed: 5, roughness: 0.9, metalness: 0.05 },
  metal: { id: 'metal', impactColor: 0xffb347, sparkCount: 24, sparkSpeed: 9, roughness: 0.32, metalness: 0.9 },
  wood: { id: 'wood', impactColor: 0xffc47a, sparkCount: 6, sparkSpeed: 4, roughness: 0.85, metalness: 0.0 },
  glass: { id: 'glass', impactColor: 0xbfefff, sparkCount: 18, sparkSpeed: 6, roughness: 0.08, metalness: 0.05 },
  asphalt: { id: 'asphalt', impactColor: 0xffd080, sparkCount: 5, sparkSpeed: 3, roughness: 0.95, metalness: 0.0 },
  dirt: { id: 'dirt', impactColor: 0xa68a6d, sparkCount: 3, sparkSpeed: 2.5, roughness: 1, metalness: 0 },
  brick: { id: 'brick', impactColor: 0xff8b55, sparkCount: 7, sparkSpeed: 4, roughness: 0.92, metalness: 0.0 },
};
