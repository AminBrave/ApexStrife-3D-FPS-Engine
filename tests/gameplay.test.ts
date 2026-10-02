import assert from 'node:assert/strict';
import { stepHorizontalVelocity } from '../src/gameplay/MovementSimulation';
import { ARENA_BOXES, ARENA_SPAWNS, ARENA_FLOOR_TOP } from '../src/world/ArenaDefinition';
import { WEAPONS, deterministicSpread } from '../src/gameplay/WeaponDefinitions';

function state(grounded = true) {
  return { velocity: [0, 0, 0] as [number, number, number], isGrounded: grounded };
}

{
  const s = state();
  stepHorizontalVelocity(s, { moveForward: 1, moveRight: 1, sprint: false, crouch: false, yaw: 0 }, 1 / 60);
  const speed = Math.hypot(s.velocity[0], s.velocity[2]);
  assert(speed <= 7 + 1e-9, 'diagonal movement must not exceed walk speed');
}

{
  const s = { velocity: [7, 0, 0] as [number, number, number], isGrounded: true };
  stepHorizontalVelocity(s, { moveForward: 0, moveRight: 0, sprint: false, crouch: false, yaw: 0 }, 1 / 60);
  assert(s.velocity[0] < 7, 'ground friction must reduce velocity');
}

{
  const s = state();
  stepHorizontalVelocity(s, { moveForward: 1, moveRight: 0, sprint: true, crouch: false, yaw: 0 }, 1 / 60);
  assert(Math.hypot(s.velocity[0], s.velocity[2]) <= 11.5 + 1e-9, 'sprint must respect the configured speed cap');
}

assert.equal(ARENA_BOXES[0].type, 'ground');
assert.equal(ARENA_BOXES[0].position[1] + ARENA_BOXES[0].halfExtents[1], ARENA_FLOOR_TOP, 'arena floor top must be y=0');
const platform = ARENA_BOXES.find(box => box.type === 'platform');
assert(platform, 'arena must contain the elevated platform');
const platformTop = platform.position[1] + platform.halfExtents[1];
assert(ARENA_SPAWNS[4][1] > platformTop + 0.85, 'elevated spawn must place the capsule above the platform');
for (const spawn of ARENA_SPAWNS) {
  assert(spawn[1] > ARENA_FLOOR_TOP, 'every spawn must place the capsule above the floor');
  assert(Math.abs(spawn[0]) < 44 && Math.abs(spawn[2]) < 44, 'every spawn must be inside the perimeter');
}

console.log('gameplay tests passed');

assert(deterministicSpread(42, 0, WEAPONS.ar.spreadRadians)[0] === deterministicSpread(42, 0, WEAPONS.ar.spreadRadians)[0], 'weapon spread must be deterministic');
assert(WEAPONS.shotgun.pelletCount === 8, 'shotgun pellet count must remain authoritative');
for (const weapon of Object.values(WEAPONS)) {
  assert(weapon.spreadRadians >= 0 && weapon.spreadRadians < 0.2, 'weapon spread must remain within gameplay bounds');
}
console.log('Authoritative weapon tests passed.');
