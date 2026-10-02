export interface MovementCommand {
  moveForward: number;
  moveRight: number;
  sprint: boolean;
  crouch: boolean;
  yaw: number;
}

export interface VelocityState {
  velocity: [number, number, number];
  isGrounded: boolean;
}

export const MOVEMENT = {
  walkSpeed: 7,
  sprintSpeed: 11.5,
  crouchSpeed: 3.5,
  groundAcceleration: 14,
  airAcceleration: 2.5,
  groundFriction: 8,
} as const;

export function stepHorizontalVelocity(
  state: VelocityState,
  input: MovementCommand,
  dt: number
): void {
  const crouching = input.crouch;
  const sprinting = input.sprint && input.moveForward > 0 && !crouching;
  const targetSpeed = crouching ? MOVEMENT.crouchSpeed : sprinting ? MOVEMENT.sprintSpeed : MOVEMENT.walkSpeed;

  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  let wishX = sin * input.moveForward + cos * input.moveRight;
  let wishZ = -cos * input.moveForward + sin * input.moveRight;
  const length = Math.hypot(wishX, wishZ);
  if (length > 1) {
    wishX /= length;
    wishZ /= length;
  }

  if (state.isGrounded) {
    const speed = Math.hypot(state.velocity[0], state.velocity[2]);
    if (speed > 0.001) {
      const newSpeed = Math.max(0, speed - speed * MOVEMENT.groundFriction * dt);
      state.velocity[0] *= newSpeed / speed;
      state.velocity[2] *= newSpeed / speed;
    }
  }

  const currentSpeed = state.velocity[0] * wishX + state.velocity[2] * wishZ;
  const addSpeed = Math.max(0, targetSpeed - currentSpeed);
  const acceleration = state.isGrounded ? MOVEMENT.groundAcceleration : MOVEMENT.airAcceleration;
  const accelerationSpeed = Math.min(acceleration * dt * targetSpeed, addSpeed);

  state.velocity[0] += accelerationSpeed * wishX;
  state.velocity[2] += accelerationSpeed * wishZ;
}
