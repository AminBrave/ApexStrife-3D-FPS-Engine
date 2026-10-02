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
}

export const WEAPONS: Record<WeaponId, ServerWeaponDefinition> = {
  ar: { id: 'ar', kind: 'hitscan', damage: 28, headshotMultiplier: 2, fireRate: 650, magazineSize: 30, reserveAmmo: 180, reloadTime: 1.8 },
  shotgun: { id: 'shotgun', kind: 'hitscan', damage: 15, headshotMultiplier: 1.5, fireRate: 110, magazineSize: 8, reserveAmmo: 48, reloadTime: 2.4, pelletCount: 8 },
  sniper: { id: 'sniper', kind: 'hitscan', damage: 95, headshotMultiplier: 2.5, fireRate: 48, magazineSize: 5, reserveAmmo: 25, reloadTime: 2.8 },
  plasma: { id: 'plasma', kind: 'projectile', damage: 110, headshotMultiplier: 1, fireRate: 85, magazineSize: 4, reserveAmmo: 16, reloadTime: 2.6, projectileSpeed: 52, splashRadius: 6.5 },
};

export function weaponIdFromIndex(index: number): WeaponId {
  return (['ar', 'shotgun', 'sniper', 'plasma'] as WeaponId[])[Math.max(0, Math.min(3, Math.floor(index)))] ?? 'ar';
}
