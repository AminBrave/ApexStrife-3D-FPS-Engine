/**
 * HUD.tsx
 * High-tech tactical FPS HUD overlay with dynamic recoil crosshair,
 * hitmarkers, damage indicators, ammo/health status, weapon wheel, killfeed, and netgraph.
 */

import React, { useEffect, useState, useRef } from 'react';
import { Shield, Heart, Zap, Crosshair, Wifi, Volume2, VolumeX, Settings, Award } from 'lucide-react';
import { GameInstance } from '../main';
import { eventBus } from '../core/EventBus';
import { soundSynth } from '../audio/SoundSynthesizer';

interface KillfeedEntry {
  id: string;
  killer: string;
  victim: string;
  weapon: string;
  headshot: boolean;
  time: number;
}

interface HUDProps {
  game: GameInstance | null;
  isLocked: boolean;
  onLockClick: () => void;
}

export const HUD: React.FC<HUDProps> = ({ game, isLocked, onLockClick }) => {
  // Stats
  const [health, setHealth] = useState<number>(100);
  const [shield, setShield] = useState<number>(50);
  const [ammo, setAmmo] = useState<number>(30);
  const [reserve, setReserve] = useState<number>(180);
  const [weaponName, setWeaponName] = useState<string>('Valkyrie AR-9');
  const [weaponIndex, setWeaponIndex] = useState<number>(0);
  const [isAiming, setIsAiming] = useState<boolean>(false);
  const [isReloading, setIsReloading] = useState<boolean>(false);
  const [reloadProgress, setReloadProgress] = useState<number>(0);

  // Crosshair dynamic spread
  const [spreadPx, setSpreadPx] = useState<number>(8);
  const [hitmarker, setHitmarker] = useState<{ active: boolean; isHeadshot: boolean }>({
    active: false,
    isHeadshot: false,
  });
  const [damageFlash, setDamageFlash] = useState<boolean>(false);

  // Netcode metrics
  const [fps, setFps] = useState<number>(60);
  const [ping, setPing] = useState<number>(24);
  const [rollbacks, setRollbacks] = useState<number>(0);

  // Killfeed & Score
  const [killfeed, setKillfeed] = useState<KillfeedEntry[]>([]);
  const [kills, setKills] = useState<number>(0);
  const [deaths, setDeaths] = useState<number>(0);
  const [score, setScore] = useState<number>(0);
  const [showScoreboard, setShowScoreboard] = useState<boolean>(false);

  // Settings
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [sensitivity, setSensitivity] = useState<number>(2.2);
  const [fov, setFov] = useState<number>(75);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const hitmarkerTimeout = useRef<number | null>(null);

  // Listen to EventBus
  useEffect(() => {
    const unsubHit = eventBus.on('weapon:hit', ({ isHeadshot }) => {
      setHitmarker({ active: true, isHeadshot });
      if (hitmarkerTimeout.current) clearTimeout(hitmarkerTimeout.current);
      hitmarkerTimeout.current = window.setTimeout(() => {
        setHitmarker({ active: false, isHeadshot: false });
      }, 140);
    });

    const unsubDamaged = eventBus.on('player:damaged', () => {
      setDamageFlash(true);
      setTimeout(() => setDamageFlash(false), 220);
    });

    const unsubKillfeed = eventBus.on('net:killfeed', (entry) => {
      const newEntry: KillfeedEntry = {
        id: Math.random().toString(),
        ...entry,
        time: Date.now(),
      };
      setKillfeed((prev) => [newEntry, ...prev.slice(0, 5)]);
    });

    const unsubReloadStart = eventBus.on('weapon:reload:start', () => {
      setIsReloading(true);
      setReloadProgress(0);
    });

    const unsubReloadFinish = eventBus.on('weapon:reload:finish', () => {
      setIsReloading(false);
      setReloadProgress(100);
    });

    const unsubAds = eventBus.on('weapon:ads:toggle', ({ isAiming }) => {
      setIsAiming(isAiming);
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        setShowScoreboard(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        setShowScoreboard(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      unsubHit();
      unsubDamaged();
      unsubKillfeed();
      unsubReloadStart();
      unsubReloadFinish();
      unsubAds();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Frame polling for dynamic state
  useEffect(() => {
    if (!game) return;
    const interval = setInterval(() => {
      setHealth(Math.round(game.playerController.health));
      setShield(Math.round(game.playerController.shield));
      setAmmo(game.weaponManager.currentMagAmmo);
      setReserve(game.weaponManager.currentReserve);
      setWeaponName(game.weaponManager.currentWeapon.name);
      setWeaponIndex(game.weaponManager.currentWeaponIndex);
      setKills(game.playerController.kills);
      setDeaths(game.playerController.deaths);
      setScore(game.playerController.score);
      setFps(game.engine.fps);
      setPing(game.networkManager.ping);
      setRollbacks(game.statePredictor.rollbackCount);

      // Convert radians spread to screen pixel radius
      const spreadVal = game.weaponManager.recoilSystem.currentSpread;
      setSpreadPx(Math.round(spreadVal * 700));
    }, 50);

    return () => clearInterval(interval);
  }, [game]);

  const handleSensitivityChange = (val: number) => {
    setSensitivity(val);
    if (game) {
      game.camera.mouseSensitivity = (val / 1000);
    }
  };

  const handleFovChange = (val: number) => {
    setFov(val);
    if (game) {
      game.camera.baseFov = val;
    }
  };

  const toggleSound = () => {
    const next = !isMuted;
    setIsMuted(next);
    soundSynth.isMuted = next;
  };

  const isSniperADS = isAiming && weaponIndex === 2;

  return (
    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden font-sans text-white">
      {/* Damage Screen Flash */}
      <div
        className={`absolute inset-0 bg-red-600/30 transition-opacity duration-150 pointer-events-none ${
          damageFlash ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Sniper Optic Scope Overlay */}
      {isSniperADS && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-black/85" />
          {/* Scope Reticle Circle */}
          <div className="relative w-[540px] h-[540px] rounded-full border border-cyan-400/50 shadow-[0_0_80px_rgba(0,240,255,0.4)] bg-transparent flex items-center justify-center overflow-hidden">
            {/* Crosshair Lines */}
            <div className="absolute w-full h-[1.5px] bg-cyan-400" />
            <div className="absolute h-full w-[1.5px] bg-cyan-400" />
            {/* Center Mil-Dots */}
            <div className="absolute w-2 h-2 rounded-full border border-red-500 bg-red-500/80" />
            <div className="absolute w-12 h-12 rounded-full border border-cyan-400/30" />
            <div className="absolute w-28 h-28 rounded-full border border-cyan-400/20" />
            {/* Range markers */}
            <div className="absolute bottom-16 text-[10px] tracking-widest text-cyan-400 font-mono">
              RANGE: OPTIC 12X CALIBRATED
            </div>
          </div>
        </div>
      )}

      {/* Standard Crosshair with Dynamic Spread Expansion */}
      {!isSniperADS && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
          {/* Center pip */}
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(0,240,255,0.9)]" />

          {/* Top Reticle */}
          <div
            className="absolute w-[2px] bg-cyan-300 shadow-[0_0_4px_rgba(0,240,255,0.8)]"
            style={{ height: '8px', transform: `translateY(-${spreadPx + 6}px)` }}
          />
          {/* Bottom Reticle */}
          <div
            className="absolute w-[2px] bg-cyan-300 shadow-[0_0_4px_rgba(0,240,255,0.8)]"
            style={{ height: '8px', transform: `translateY(${spreadPx + 6}px)` }}
          />
          {/* Left Reticle */}
          <div
            className="absolute h-[2px] bg-cyan-300 shadow-[0_0_4px_rgba(0,240,255,0.8)]"
            style={{ width: '8px', transform: `translateX(-${spreadPx + 6}px)` }}
          />
          {/* Right Reticle */}
          <div
            className="absolute h-[2px] bg-cyan-300 shadow-[0_0_4px_rgba(0,240,255,0.8)]"
            style={{ width: '8px', transform: `translateX(${spreadPx + 6}px)` }}
          />

          {/* Hitmarker Flash */}
          {hitmarker.active && (
            <div
              className={`absolute text-2xl font-black scale-125 transition-transform ${
                hitmarker.isHeadshot ? 'text-red-500 shadow-red-500' : 'text-white'
              }`}
            >
              ✕
            </div>
          )}
        </div>
      )}

      {/* Top Left: Netgraph & Telemetry */}
      <div className="absolute top-4 left-4 flex flex-col gap-1 text-[11px] font-mono bg-black/60 backdrop-blur-md p-3 rounded-lg border border-slate-700/60 shadow-lg pointer-events-auto">
        <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-xs">
          <Wifi className="w-3.5 h-3.5" />
          <span>ApexStrife 60Hz Netcode</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-slate-300 mt-1">
          <div>FPS: <span className="text-white font-bold">{fps}</span></div>
          <div>PING: <span className="text-green-400 font-bold">{ping}ms</span></div>
          <div>SERVER: <span className="text-slate-400 font-bold">60.0 Hz</span></div>
          <div>ROLLBACKS: <span className="text-amber-400 font-bold">{rollbacks}</span></div>
        </div>
      </div>

      {/* Top Right: Killfeed & Header Controls */}
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2 pointer-events-auto">
        <div className="flex items-center gap-2">
          <button
            onClick={toggleSound}
            className="p-2 rounded-lg bg-black/60 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-lg bg-black/60 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
            title="Settings"
          >
            <Settings className="w-4 h-4 text-slate-300" />
          </button>
        </div>

        {/* Killfeed Stack */}
        <div className="flex flex-col gap-1.5 w-64">
          {killfeed.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between text-xs px-2.5 py-1 rounded bg-black/70 border border-slate-800 backdrop-blur shadow animate-fade-in"
            >
              <span className={`font-semibold ${entry.killer === 'You' ? 'text-green-400' : 'text-slate-200'}`}>
                {entry.killer}
              </span>
              <span className="text-[10px] text-cyan-400 font-mono px-1">
                [{entry.weapon}]
              </span>
              <span className="text-red-400 font-semibold flex items-center gap-1">
                {entry.victim}
                {entry.headshot && <span className="text-[10px] text-red-500 font-black">⚡HS</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Left: Vitals (Health & Armor) */}
      <div className="absolute bottom-6 left-6 flex flex-col gap-2 bg-black/70 backdrop-blur-md p-4 rounded-xl border border-slate-800 shadow-2xl min-w-[260px]">
        {/* Shield / Armor */}
        <div>
          <div className="flex items-center justify-between text-xs font-mono mb-1">
            <span className="flex items-center gap-1.5 text-cyan-400 font-semibold">
              <Shield className="w-3.5 h-3.5" /> SHIELD
            </span>
            <span className="text-cyan-300 font-bold">{shield} / 50</span>
          </div>
          <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-cyan-900/50">
            <div
              className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 transition-all duration-200"
              style={{ width: `${(shield / 50) * 100}%` }}
            />
          </div>
        </div>

        {/* Health */}
        <div>
          <div className="flex items-center justify-between text-xs font-mono mb-1">
            <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
              <Heart className="w-3.5 h-3.5" /> HEALTH
            </span>
            <span className="text-emerald-300 font-bold">{health} / 100</span>
          </div>
          <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-emerald-900/50">
            <div
              className={`h-full transition-all duration-200 ${
                health > 35
                  ? 'bg-gradient-to-r from-emerald-600 to-emerald-400'
                  : 'bg-gradient-to-r from-red-600 to-red-400 animate-pulse'
              }`}
              style={{ width: `${health}%` }}
            />
          </div>
        </div>

        {/* Score & K/D */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px] font-mono text-slate-400">
          <span>SCORE: <b className="text-amber-400">{score}</b></span>
          <span>KILLS: <b className="text-white">{kills}</b> / DEATHS: <b className="text-white">{deaths}</b></span>
        </div>
      </div>

      {/* Bottom Center: Weapon Selector Bar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/65 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-800 shadow-xl">
        {game?.weaponManager.weapons.map((w, idx) => (
          <button
            key={w.id}
            onClick={() => game?.weaponManager.switchWeapon(idx)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition flex flex-col items-center pointer-events-auto cursor-pointer ${
              weaponIndex === idx
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/80 shadow-[0_0_12px_rgba(0,240,255,0.3)]'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <span className="text-[10px] text-slate-500">[{idx + 1}]</span>
            <span className="font-bold whitespace-nowrap">{w.name.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      {/* Bottom Right: Active Ammo & Reload Counter */}
      <div className="absolute bottom-6 right-6 flex flex-col items-end gap-1 bg-black/70 backdrop-blur-md p-4 rounded-xl border border-slate-800 shadow-2xl min-w-[200px]">
        <div className="text-xs font-mono text-cyan-400 tracking-wider font-semibold">
          {weaponName}
        </div>
        <div className="flex items-baseline gap-2">
          <span className={`text-4xl font-black font-mono tracking-tight ${ammo <= 5 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
            {ammo}
          </span>
          <span className="text-base font-mono text-slate-400">/ {reserve}</span>
        </div>

        {/* Reload Bar */}
        {isReloading && (
          <div className="w-full mt-2">
            <div className="text-[10px] font-mono text-amber-400 tracking-widest uppercase mb-0.5">
              RELOADING...
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-amber-900">
              <div className="h-full bg-amber-400 animate-pulse w-full" />
            </div>
          </div>
        )}
      </div>

      {/* Scoreboard Modal (Hold TAB) */}
      {showScoreboard && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-6 pointer-events-auto">
          <div className="w-full max-w-xl bg-slate-900/90 border border-cyan-500/40 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-700">
              <div className="flex items-center gap-2 text-cyan-400 font-bold text-lg font-mono">
                <Award className="w-5 h-5" />
                TACTICAL SCOREBOARD
              </div>
              <span className="text-xs text-slate-400 font-mono">SERVER 60Hz AUTHORITATIVE</span>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800">
                    <th className="py-2">OPERATIVE</th>
                    <th className="py-2 text-center">KILLS</th>
                    <th className="py-2 text-center">DEATHS</th>
                    <th className="py-2 text-center">SCORE</th>
                    <th className="py-2 text-right">PING</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  <tr className="text-cyan-300 font-bold bg-cyan-950/30">
                    <td className="py-2.5">You (Local Operative)</td>
                    <td className="py-2.5 text-center text-white">{kills}</td>
                    <td className="py-2.5 text-center text-white">{deaths}</td>
                    <td className="py-2.5 text-center text-amber-400">{score}</td>
                    <td className="py-2.5 text-right text-green-400">{ping}ms</td>
                  </tr>
                  <tr className="text-slate-300">
                    <td className="py-2.5">Nexus-01 [BOT]</td>
                    <td className="py-2.5 text-center">2</td>
                    <td className="py-2.5 text-center">1</td>
                    <td className="py-2.5 text-center text-amber-400">300</td>
                    <td className="py-2.5 text-right text-slate-500">12ms</td>
                  </tr>
                  <tr className="text-slate-300">
                    <td className="py-2.5">Viper-02 [BOT]</td>
                    <td className="py-2.5 text-center">3</td>
                    <td className="py-2.5 text-center">0</td>
                    <td className="py-2.5 text-center text-amber-400">450</td>
                    <td className="py-2.5 text-right text-slate-500">14ms</td>
                  </tr>
                  <tr className="text-slate-300">
                    <td className="py-2.5">Ghost-03 [BOT]</td>
                    <td className="py-2.5 text-center">1</td>
                    <td className="py-2.5 text-center">2</td>
                    <td className="py-2.5 text-center text-amber-400">150</td>
                    <td className="py-2.5 text-right text-slate-500">18ms</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-6 pointer-events-auto">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-base text-white">Engine & Control Settings</h3>
              <button
                onClick={() => setShowSettings(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono text-slate-300 mb-1">
                <span>Mouse Sensitivity:</span>
                <span className="text-cyan-400 font-bold">{sensitivity.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="6.0"
                step="0.1"
                value={sensitivity}
                onChange={(e) => handleSensitivityChange(parseFloat(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono text-slate-300 mb-1">
                <span>Field of View (FOV):</span>
                <span className="text-cyan-400 font-bold">{fov}°</span>
              </div>
              <input
                type="range"
                min="60"
                max="105"
                step="1"
                value={fov}
                onChange={(e) => handleFovChange(parseInt(e.target.value, 10))}
                className="w-full accent-cyan-400"
              />
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pointer Lock Overlay (Click to Lock Cursor & Enter Combat) */}
      {!isLocked && (
        <div
          onClick={onLockClick}
          className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center p-6 cursor-pointer pointer-events-auto transition hover:bg-black/50"
        >
          <div className="bg-slate-900/95 border border-cyan-500/50 p-8 rounded-2xl shadow-2xl max-w-lg text-center flex flex-col items-center gap-5">
            <div className="w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-400 flex items-center justify-center text-cyan-400 shadow-[0_0_20px_rgba(0,240,255,0.4)] animate-pulse">
              <Crosshair className="w-8 h-8" />
            </div>

            <div>
              <h1 className="text-2xl font-black tracking-wider text-white uppercase font-mono">
                ApexStrife 3D
              </h1>
              <p className="text-xs text-cyan-400 font-mono mt-1">
                DUAL-CAMERA 60Hz PREDICTED FPS ENGINE
              </p>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed max-w-md">
              Click anywhere to lock your cursor and enter the tactical training facility.
              Experience client-side prediction, server reconciliation, multi-axis spring recoil,
              and physics-driven combat.
            </p>

            {/* Tactical Control Instructions */}
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-left w-full bg-black/60 p-3 rounded-lg border border-slate-800">
              <div><span className="text-cyan-400">[WASD]</span> Move</div>
              <div><span className="text-cyan-400">[LMB]</span> Fire Weapon</div>
              <div><span className="text-cyan-400">[SHIFT]</span> Sprint</div>
              <div><span className="text-cyan-400">[RMB]</span> Aim Down Sights (ADS)</div>
              <div><span className="text-cyan-400">[SPACE]</span> Jump</div>
              <div><span className="text-cyan-400">[1-4] / Scroll</span> Switch Weapon</div>
              <div><span className="text-cyan-400">[C / CTRL]</span> Crouch</div>
              <div><span className="text-cyan-400">[R]</span> Reload Mag</div>
              <div><span className="text-cyan-400">[TAB]</span> Scoreboard</div>
              <div><span className="text-cyan-400">[ESC]</span> Unlock Cursor</div>
            </div>

            <button
              onClick={onLockClick}
              className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-sm tracking-wider uppercase rounded-xl shadow-lg shadow-cyan-500/25 transition cursor-pointer"
            >
              Click to Engage (Lock Cursor)
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
