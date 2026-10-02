export type WeaponId = 'ar' | 'shotgun' | 'sniper' | 'plasma';
export type WeaponKind = 'hitscan' | 'projectile';

export interface ServerWeaponDefinition {
  id: WeaponId;
  kind: WeaponKind;
  damage: number;
  headshotMultiplier: number;
  fireRate: number;
  magazineSize: number;
  reserveAmmo: number;
  reloadTime: number;
  projectileSpeed?: number;
  splashRadius?: number;
  pelletCount?: number;
  spreadRadians: number;
}

export const WEAPONS: Record<WeaponId, ServerWeaponDefinition> = {
  ar: { id: 'ar', kind: 'hitscan', damage: 28, headshotMultiplier: 2, fireRate: 650, magazineSize: 30, reserveAmmo: 180, reloadTime: 1.8, spreadRadians: 0.007 },
  shotgun: { id: 'shotgun', kind: 'hitscan', damage: 15, headshotMultiplier: 1.5, fireRate: 110, magazineSize: 8, reserveAmmo: 48, reloadTime: 2.4, pelletCount: 8, spreadRadians: 0.045 },
  sniper: { id: 'sniper', kind: 'hitscan', damage: 95, headshotMultiplier: 2.5, fireRate: 48, magazineSize: 5, reserveAmmo: 25, reloadTime: 2.8, spreadRadians: 0.002 },
  plasma: { id: 'plasma', kind: 'projectile', damage: 110, headshotMultiplier: 1, fireRate: 85, magazineSize: 4, reserveAmmo: 16, reloadTime: 2.6, projectileSpeed: 52, splashRadius: 6.5, spreadRadians: 0.01 },
};

export function weaponIdFromIndex(index: number): WeaponId {
  return (['ar', 'shotgun', 'sniper', 'plasma'] as WeaponId[])[Math.max(0, Math.min(3, Math.floor(index)))] ?? 'ar';
}


/** Deterministic shot spread shared by server-side validation and future client presentation. */
export function deterministicSpread(seed: number, pelletIndex: number, radius: number): [number, number] {
  let x = (seed ^ Math.imul(pelletIndex + 1, 0x9e3779b9)) >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  const u = (x >>> 0) / 4294967296;
  x = (x * 1664525 + 1013904223) >>> 0;
  const v = (x >>> 0) / 4294967296;
  const r = Math.sqrt(u) * radius;
  const a = v * Math.PI * 2;
  return [Math.cos(a) * r, Math.sin(a) * r];
}
