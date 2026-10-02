import assert from 'node:assert/strict';
import { stepHorizontalVelocity } from '../src/gameplay/MovementSimulation';

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

console.log('gameplay tests passed');
