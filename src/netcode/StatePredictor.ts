/**
 * StatePredictor.ts
 * Manages client-side input buffering, local trajectory prediction,
 * server reconciliation rollback and re-simulation loops, and visual error smoothing.
 */

import * as THREE from 'three';
import { CharacterController, MovementInput } from '../physics/CharacterController';
import { eventBus } from '../core/EventBus';

export interface PlayerInput extends MovementInput {
  sequence: number;
  timestamp: number;
  pitch: number;
  fire: boolean;
  reload: boolean;
  weaponIndex: number;
}

export interface PlayerState {
  position: [number, number, number];
  velocity: [number, number, number];
  yaw: number;
  pitch: number;
  isGrounded: boolean;
  isCrouching: boolean;
}

export interface InputHistoryEntry {
  sequence: number;
  timestamp: number;
  input: PlayerInput;
  predictedState: PlayerState;
}

export class StatePredictor {
  private inputBuffer: InputHistoryEntry[] = [];
  private readonly maxBufferSize: number = 240; // 4 seconds at 60Hz
  private readonly reconciliationThresholdSq: number = 0.0016; // 0.04m error threshold squared

  // Visual error smoothing (prevents visual snapping on rollback)
  public visualOffset: THREE.Vector3 = new THREE.Vector3();
  private readonly visualDecayRate: number = 20.0; // Decay smoothing speed

  public rollbackCount: number = 0;
  public lastAcknowledgedSequence: number = 0;

  /**
   * Record a locally predicted input and the resulting state.
   */
  public recordInput(input: PlayerInput, state: PlayerState): void {
    this.inputBuffer.push({
      sequence: input.sequence,
      timestamp: input.timestamp,
      input: { ...input },
      predictedState: {
        position: [...state.position],
        velocity: [...state.velocity],
        yaw: state.yaw,
        pitch: state.pitch,
        isGrounded: state.isGrounded,
        isCrouching: state.isCrouching,
      },
    });

    if (this.inputBuffer.length > this.maxBufferSize) {
      this.inputBuffer.shift();
    }
  }

  /**
   * Reconcile local state with authoritative server snapshot.
   */
  public reconcile(
    lastAckSequence: number,
    serverState: PlayerState,
    controller: CharacterController,
    fixedTimestep: number
  ): void {
    this.lastAcknowledgedSequence = lastAckSequence;

    // Find the recorded predicted input matching the server ack sequence
    const ackIdx = this.inputBuffer.findIndex((entry) => entry.sequence === lastAckSequence);
    if (ackIdx === -1) {
      // Input too old or pruned; discard all older than ack
      this.inputBuffer = this.inputBuffer.filter((e) => e.sequence > lastAckSequence);
      return;
    }

    const recorded = this.inputBuffer[ackIdx];
    const sPos = serverState.position;
    const pPos = recorded.predictedState.position;

    // Compute Euclidean distance squared between predicted and server state
    const dx = pPos[0] - sPos[0];
    const dy = pPos[1] - sPos[1];
    const dz = pPos[2] - sPos[2];
    const errorSq = dx * dx + dy * dy + dz * dz;

    // Check if error exceeds tolerance
    if (errorSq > this.reconciliationThresholdSq) {
      this.rollbackCount++;
      const errorMag = Math.sqrt(errorSq);

      // Store pre-rollback visual position for smooth transition
      const preRollbackPos = controller.position.clone();

      // 1. Roll back to server authoritative state
      controller.position.set(sPos[0], sPos[1], sPos[2]);
      controller.velocity.set(serverState.velocity[0], serverState.velocity[1], serverState.velocity[2]);
      controller.isGrounded = serverState.isGrounded;
      controller.isCrouching = serverState.isCrouching;

      // 2. Re-simulate all unacknowledged inputs up to the latest sequence
      const unacknowledged = this.inputBuffer.slice(ackIdx + 1);
      for (const entry of unacknowledged) {
        controller.update(fixedTimestep, entry.input);
        // Overwrite predicted state in buffer with newly corrected simulation
        entry.predictedState.position = [controller.position.x, controller.position.y, controller.position.z];
        entry.predictedState.velocity = [controller.velocity.x, controller.velocity.y, controller.velocity.z];
        entry.predictedState.isGrounded = controller.isGrounded;
        entry.predictedState.isCrouching = controller.isCrouching;
      }

      // 3. Set visual offset for interpolation decay (prevents camera snap)
      this.visualOffset.copy(preRollbackPos).sub(controller.position);
      // Clamp visual offset to avoid disorienting glitches
      this.visualOffset.clampLength(0, 0.4);

      eventBus.emit('net:reconciled', {
        errorMagnitude: errorMag,
        resimulatedTicks: unacknowledged.length,
      });
    }

    // Prune acknowledged inputs
    this.inputBuffer = this.inputBuffer.slice(ackIdx + 1);
  }

  /**
   * Update visual offset decay towards zero.
   */
  public updateVisualSmoothing(deltaTime: number): void {
    if (this.visualOffset.lengthSq() > 0.00001) {
      this.visualOffset.lerp(new THREE.Vector3(0, 0, 0), this.visualDecayRate * deltaTime);
    } else {
      this.visualOffset.set(0, 0, 0);
    }
  }

  public getPendingInputCount(): number {
    return this.inputBuffer.length;
  }

  public clear(): void {
    this.inputBuffer = [];
    this.visualOffset.set(0, 0, 0);
  }
}
