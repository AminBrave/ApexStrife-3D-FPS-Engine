/**
 * App.tsx
 * Mounts the 3D WebGL dual-camera canvas and binds the React HUD overlay.
 */

import React, { useEffect, useRef, useState } from 'react';
import { bootstrapGame, GameInstance } from './main';
import { HUD } from './ui/HUD';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [game, setGame] = useState<GameInstance | null>(null);
  const [isLocked, setIsLocked] = useState<boolean>(false);

  useEffect(() => {
    if (!canvasRef.current) return;

    let instance: GameInstance | null = null;
    let isMounted = true;

    bootstrapGame(canvasRef.current).then((g) => {
      if (!isMounted) {
        g.dispose();
        return;
      }
      instance = g;
      setGame(g);
    });

    const onPointerLockChange = () => {
      setIsLocked(document.pointerLockElement === canvasRef.current);
    };

    document.addEventListener('pointerlockchange', onPointerLockChange);

    return () => {
      isMounted = false;
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      if (instance) {
        instance.dispose();
      }
    };
  }, []);

  const handleLockClick = () => {
    if (game) {
      game.camera.requestPointerLock();
    } else if (canvasRef.current) {
      canvasRef.current.requestPointerLock();
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950">
      {/* 3D WebGL Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full block outline-none cursor-crosshair"
        tabIndex={0}
      />

      {/* Cyberpunk Tactical HUD Overlay */}
      <HUD
        game={game}
        isLocked={isLocked}
        onLockClick={handleLockClick}
      />
    </div>
  );
}
