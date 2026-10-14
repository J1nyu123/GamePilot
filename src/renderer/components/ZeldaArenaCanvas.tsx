import { useEffect, useRef, useState, useCallback } from 'react';
import type { ImportedImage } from '../../contracts/debug';

export interface TargetLandmark {
  id: 'red' | 'yellow' | 'blue';
  name: string;
  color: string;
  glowColor: string;
  x: number;
  y: number;
  radius: number;
  label: string;
}

export const ARENA_TARGETS: TargetLandmark[] = [
  { id: 'red', name: '红色目标 (火之祭坛)', color: '#ef4444', glowColor: 'rgba(239, 68, 68, 0.45)', x: 960, y: 190, radius: 70, label: 'RED TARGET' },
  { id: 'yellow', name: '黄色目标 (雷之祭坛)', color: '#eab308', glowColor: 'rgba(234, 179, 8, 0.45)', x: 260, y: 360, radius: 70, label: 'YELLOW TARGET' },
  { id: 'blue', name: '蓝色目标 (水之祭坛)', color: '#3b82f6', glowColor: 'rgba(59, 130, 246, 0.45)', x: 640, y: 560, radius: 70, label: 'BLUE TARGET' },
];

export interface PlannedPhase {
  phaseIndex: number;
  targetId: 'red' | 'yellow' | 'blue';
  targetName: string;
  x: number;
  y: number;
  description?: string;
}

// Particle effect on arrival
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  maxLife: number;
}

// Global arena instance for AI Agent closed loop
let arenaInstance: {
  getState(): { linkX: number; linkY: number; targets: TargetLandmark[] };
  moveLink(dx: number, dy: number): void;
  setLinkPos(x: number, y: number): void;
  setPlannedRoute(phases: PlannedPhase[], currentPhaseIdx: number): void;
  setVirtualStick(x: number, y: number, active: boolean): void;
  triggerArrival(targetId: 'red' | 'yellow' | 'blue'): void;
  captureFrame(): ImportedImage;
} | null = null;

export function getArenaInstance() {
  return arenaInstance;
}

export default function ZeldaArenaCanvas({
  stickX = 0,
  stickY = 0,
  onTargetArrival,
}: {
  stickX?: number;
  stickY?: number;
  onTargetArrival?(target: TargetLandmark): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef({ x: 640, y: 360, angle: 0, animTick: 0 });
  const stickRef = useRef({ x: stickX, y: stickY, active: false });
  const routeRef = useRef<{ phases: PlannedPhase[]; currentIdx: number }>({ phases: [], currentIdx: 0 });
  const particlesRef = useRef<Particle[]>([]);

  const [activeArrival, setActiveArrival] = useState<'red' | 'yellow' | 'blue' | null>(null);
  const [hudInfo, setHudInfo] = useState({ x: 640, y: 360, nearest: '黄色目标', dist: 380 });
  const [displayStick, setDisplayStick] = useState({ x: 0, y: 0, active: false });

  useEffect(() => {
    stickRef.current = { x: stickX, y: stickY, active: Math.abs(stickX) > 0.05 || Math.abs(stickY) > 0.05 };
    setDisplayStick(stickRef.current);
  }, [stickX, stickY]);

  // Capture current canvas screenshot as an ImportedImage
  const captureFrame = useCallback((): ImportedImage => {
    const canvas = canvasRef.current;
    const dataUrl = canvas ? canvas.toDataURL('image/jpeg', 0.88) : '';
    const now = Date.now();
    return {
      id: `arena-frame-${now}`,
      name: `塞尔达沙盒 · 实时画面 #${Math.floor(now / 100) % 10000}`,
      path: '/observations/arena-live.jpg',
      importedAt: now,
      mimeType: 'image/jpeg',
      width: 1280,
      height: 720,
      size: Math.round(dataUrl.length * 0.75),
      dataUrl,
      source: 'import',
    };
  }, []);

  // Register global arena instance
  useEffect(() => {
    arenaInstance = {
      getState: () => ({
        linkX: posRef.current.x,
        linkY: posRef.current.y,
        targets: ARENA_TARGETS,
      }),
      moveLink: (dx, dy) => {
        posRef.current.x = Math.max(80, Math.min(1200, posRef.current.x + dx));
        posRef.current.y = Math.max(80, Math.min(640, posRef.current.y + dy));
      },
      setLinkPos: (x, y) => {
        posRef.current.x = x;
        posRef.current.y = y;
      },
      setPlannedRoute: (phases, currentIdx) => {
        routeRef.current = { phases, currentIdx };
      },
      setVirtualStick: (x, y, active) => {
        stickRef.current = { x, y, active };
        setDisplayStick({ x, y, active });
      },
      triggerArrival: (targetId) => {
        const target = ARENA_TARGETS.find(t => t.id === targetId);
        if (!target) return;
        // Spawn particle bursts
        for (let i = 0; i < 35; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 40 + Math.random() * 140;
          particlesRef.current.push({
            x: target.x,
            y: target.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: target.color,
            life: 1.0,
            maxLife: 0.8 + Math.random() * 0.6,
          });
        }
      },
      captureFrame,
    };

    return () => {
      // Do not clear instance immediately if component temporarily unmounts
    };
  }, [captureFrame]);

  // Keyboard controls for manual play (WASD / Arrows)
  useEffect(() => {
    const keys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        keys.add(e.code);
        updateFromKeys();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
      updateFromKeys();
    };
    const updateFromKeys = () => {
      let kx = 0, ky = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) kx -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) kx += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) ky += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) ky -= 1;
      if (kx !== 0 || ky !== 0) {
        stickRef.current = { x: kx, y: ky, active: true };
        setDisplayStick({ x: kx, y: ky, active: true });
      } else {
        stickRef.current = { x: stickX, y: stickY, active: Math.abs(stickX) > 0.05 || Math.abs(stickY) > 0.05 };
        setDisplayStick(stickRef.current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [stickX, stickY]);

  // Main 60 FPS Render & Physics Loop
  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastTime = performance.now();
    let tickCount = 0;

    const render = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;
      tickCount++;

      // 1. Physics update based on current joystick deflection
      const { x: sx, y: sy } = stickRef.current;
      const speed = 280; // Pixels per second at full stick
      if (Math.abs(sx) > 0.08 || Math.abs(sy) > 0.08) {
        posRef.current.x = Math.max(90, Math.min(1190, posRef.current.x + sx * speed * dt));
        posRef.current.y = Math.max(90, Math.min(630, posRef.current.y - sy * speed * dt)); // Invert Y
        posRef.current.angle = Math.atan2(-sy, sx);
        posRef.current.animTick += dt * 10;
      }

      const link = posRef.current;

      // 2. Check collision/arrival with landmarks
      let arrivedThisFrame: 'red' | 'yellow' | 'blue' | null = null;
      let minTarget = ARENA_TARGETS[0];
      let minDist = 9999;

      for (const target of ARENA_TARGETS) {
        const d = Math.hypot(link.x - target.x, link.y - target.y);
        if (d < minDist) {
          minDist = d;
          minTarget = target;
        }
        if (d <= target.radius) {
          arrivedThisFrame = target.id;
        }
      }

      if (arrivedThisFrame !== activeArrival) {
        setActiveArrival(arrivedThisFrame);
        if (arrivedThisFrame) {
          const t = ARENA_TARGETS.find(item => item.id === arrivedThisFrame);
          if (t && onTargetArrival) onTargetArrival(t);
        }
      }

      if (tickCount % 6 === 0) {
        setHudInfo({
          x: Math.round(link.x),
          y: Math.round(link.y),
          nearest: minTarget.name,
          dist: Math.round(minDist),
        });
      }

      // Update particle effects
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) {
          particlesRef.current.splice(i, 1);
        }
      }

      // 3. Clear canvas & Draw Field
      ctx.clearRect(0, 0, 1280, 720);

      // Grassland gradient base
      const grass = ctx.createRadialGradient(640, 360, 100, 640, 360, 700);
      grass.addColorStop(0, '#385e2b');
      grass.addColorStop(0.6, '#2d4d22');
      grass.addColorStop(1, '#1e3316');
      ctx.fillStyle = grass;
      ctx.fillRect(0, 0, 1280, 720);

      // Ancient cobblestone grid
      ctx.strokeStyle = 'rgba(74, 110, 60, 0.25)';
      ctx.lineWidth = 1;
      for (let x = 80; x < 1280; x += 100) {
        ctx.beginPath();
        ctx.moveTo(x, 40);
        ctx.lineTo(x, 680);
        ctx.stroke();
      }
      for (let y = 60; y < 720; y += 100) {
        ctx.beginPath();
        ctx.moveTo(40, y);
        ctx.lineTo(1240, y);
        ctx.stroke();
      }

      // Stone Arena Boundary
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 12;
      ctx.strokeRect(40, 40, 1200, 640);

      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 4;
      ctx.strokeRect(46, 46, 1188, 628);

      // Corner Pillar Bricks
      ctx.fillStyle = '#64748b';
      [[40, 40], [1200, 40], [40, 640], [1200, 640]].forEach(([cx, cy]) => {
        ctx.fillRect(cx - 10, cy - 10, 60, 60);
      });

      // 4. Draw Planned Multi-Target Waypoint Route
      const { phases, currentIdx } = routeRef.current;
      if (phases.length > 0) {
        ctx.save();
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';

        let prevX = link.x;
        let prevY = link.y;

        for (let i = 0; i < phases.length; i++) {
          const ph = phases[i];
          const isDone = i < currentIdx;
          const isActive = i === currentIdx;

          ctx.strokeStyle = isDone
            ? 'rgba(34, 197, 94, 0.4)'
            : isActive
            ? 'rgba(56, 189, 248, 0.85)'
            : 'rgba(148, 163, 184, 0.35)';

          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(ph.x, ph.y);
          ctx.stroke();

          prevX = ph.x;
          prevY = ph.y;
        }
        ctx.restore();
      }

      // 5. Draw Targets (Red, Yellow, Blue Pillars)
      for (const t of ARENA_TARGETS) {
        const isReached = arrivedThisFrame === t.id;
        const pulse = Math.sin(time / 250) * 6;

        // Check if this target is in planned route
        const phaseOrderIdx = phases.findIndex(p => p.targetId === t.id);
        const isPlanned = phaseOrderIdx !== -1;
        const isCurrentPhase = isPlanned && phaseOrderIdx === currentIdx;
        const isCompletedPhase = isPlanned && phaseOrderIdx < currentIdx;

        // Outer glow
        const glow = ctx.createRadialGradient(t.x, t.y, 10, t.x, t.y, t.radius + 20 + pulse);
        glow.addColorStop(0, isCurrentPhase ? 'rgba(56, 189, 248, 0.6)' : t.glowColor);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius + 25 + pulse, 0, Math.PI * 2);
        ctx.fill();

        // Target Pedestal Base
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.ellipse(t.x, t.y + 16, t.radius - 8, (t.radius - 8) * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Target Shrine Ring
        ctx.strokeStyle = isReached ? '#ffffff' : isCurrentPhase ? '#38bdf8' : t.color;
        ctx.lineWidth = isReached || isCurrentPhase ? 5 : 3;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
        ctx.stroke();

        // Concentric beacon ripple
        ctx.strokeStyle = isCurrentPhase ? '#38bdf8' : t.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const rippleR = ((time / 15) % t.radius);
        ctx.arc(t.x, t.y, rippleR, 0, Math.PI * 2);
        ctx.stroke();

        // Pillar Spire
        ctx.fillStyle = '#334155';
        ctx.fillRect(t.x - 14, t.y - 40, 28, 45);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(t.x + 4, t.y - 40, 10, 45);

        // Glowing Crystal Gem on top
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.arc(t.x, t.y - 46, 12 + (isReached ? 3 : 0), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(t.x - 3, t.y - 49, 4, 0, Math.PI * 2);
        ctx.fill();

        // Label
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 13px "Cascadia Code", Consolas, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(t.name, t.x, t.y + 44);

        // Waypoint sequence badge if planned
        if (isPlanned) {
          const badgeX = t.x;
          const badgeY = t.y - 68;
          ctx.fillStyle = isCompletedPhase ? '#15803d' : isCurrentPhase ? '#0284c7' : '#334155';
          ctx.beginPath();
          ctx.roundRect(badgeX - 42, badgeY - 10, 84, 20, 10);
          ctx.fill();
          ctx.strokeStyle = isCurrentPhase ? '#38bdf8' : '#94a3b8';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 10px sans-serif';
          ctx.fillText(
            isCompletedPhase
              ? `✓ 第 ${phaseOrderIdx + 1} 阶段`
              : isCurrentPhase
              ? `▶ 第 ${phaseOrderIdx + 1} 阶段`
              : `待定 ${phaseOrderIdx + 1}`,
            badgeX,
            badgeY + 4
          );
        }

        if (isReached) {
          ctx.fillStyle = '#22c55e';
          ctx.font = 'bold 12px sans-serif';
          ctx.fillText('✓ 已到达目标点！', t.x, t.y + 64);
        }
      }

      // Draw particle effects
      for (const p of particlesRef.current) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 6. Draw Link Character
      // Link Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(link.x, link.y + 24, 20, 9, 0, 0, Math.PI * 2);
      ctx.fill();

      // Bobbing walking step offset
      const isWalking = Math.abs(sx) > 0.08 || Math.abs(sy) > 0.08;
      const bobY = isWalking ? Math.sin(link.animTick) * 3 : 0;
      const legOffset = isWalking ? Math.sin(link.animTick) * 6 : 0;

      // Boots
      ctx.fillStyle = '#78350f';
      ctx.fillRect(link.x - 10 + legOffset, link.y + 16, 7, 10);
      ctx.fillRect(link.x + 3 - legOffset, link.y + 16, 7, 10);

      // Link Body (Champion's Tunic Blue)
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(link.x - 13, link.y - 8 + bobY, 26, 26);

      // Belt
      ctx.fillStyle = '#78350f';
      ctx.fillRect(link.x - 13, link.y + 8 + bobY, 26, 4);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(link.x - 4, link.y + 7 + bobY, 8, 6);

      // Master Sword on Back
      ctx.save();
      ctx.translate(link.x, link.y);
      ctx.rotate(0.35);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(10, -32 + bobY, 4, 38);
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(8, -12 + bobY, 8, 4);
      ctx.restore();

      // Head & Blonde Hair
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(link.x, link.y - 18 + bobY, 14, 0, Math.PI * 2);
      ctx.fill();

      // Face skin
      ctx.fillStyle = '#fed7aa';
      ctx.beginPath();
      ctx.arc(link.x, link.y - 16 + bobY, 10, 0, Math.PI * 2);
      ctx.fill();

      // Hair bangs
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(link.x, link.y - 20 + bobY, 13, Math.PI, Math.PI * 2);
      ctx.fill();

      // Facing orientation pointer (small forward dot)
      const lookX = link.x + Math.cos(link.angle) * 16;
      const lookY = link.y + Math.sin(link.angle) * 16;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(lookX, lookY, 3, 0, Math.PI * 2);
      ctx.fill();

      // 7. HUD Overlay: Coordinates & Control Helper (Top-Left)
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(56, 56, 320, 56);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.strokeRect(56, 56, 320, 56);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 12px "Cascadia Code", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`林克坐标: (${Math.round(link.x)}, ${Math.round(link.y)})`, 70, 78);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '11px sans-serif';
      ctx.fillText(`最近地标: ${hudInfo.nearest} (${hudInfo.dist} px)`, 70, 98);

      // 8. Visual Stick Deflection HUD (Top-Right of Canvas)
      const stickHudX = 1170;
      const stickHudY = 110;
      const stickHudRadius = 38;

      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.beginPath();
      ctx.arc(stickHudX, stickHudY, stickHudRadius + 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = stickRef.current.active ? '#38bdf8' : '#334155';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Crosshairs
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(stickHudX - stickHudRadius, stickHudY);
      ctx.lineTo(stickHudX + stickHudRadius, stickHudY);
      ctx.moveTo(stickHudX, stickHudY - stickHudRadius);
      ctx.lineTo(stickHudX, stickHudY + stickHudRadius);
      ctx.stroke();

      // Deflected thumbstick position
      const thumbX = stickHudX + stickRef.current.x * stickHudRadius;
      const thumbY = stickHudY - stickRef.current.y * stickHudRadius; // Invert Y

      // Vector deflection line
      if (stickRef.current.active) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(stickHudX, stickHudY);
        ctx.lineTo(thumbX, thumbY);
        ctx.stroke();
      }

      // Thumb stick head
      ctx.fillStyle = stickRef.current.active ? '#0284c7' : '#475569';
      ctx.beginPath();
      ctx.arc(thumbX, thumbY, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = stickRef.current.active ? '#bae6fd' : '#94a3b8';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Stick value text
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '10px "Cascadia Code", monospace';
      ctx.textAlign = 'center';
      const sxText = (stickRef.current.x >= 0 ? '+' : '') + stickRef.current.x.toFixed(2);
      const syText = (stickRef.current.y >= 0 ? '+' : '') + stickRef.current.y.toFixed(2);
      ctx.fillText(`左摇杆 [${sxText}, ${syText}]`, stickHudX, stickHudY + stickHudRadius + 28);
      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [activeArrival, onTargetArrival]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '12px',
        zIndex: 10,
        display: 'flex',
        gap: '6px',
        background: 'rgba(15, 23, 42, 0.85)',
        padding: '5px 8px',
        borderRadius: '6px',
        border: '1px solid #334155',
        fontSize: '10px',
      }}>
        <button
          type="button"
          className="button secondary"
          style={{ padding: '3px 8px', fontSize: '10px' }}
          onClick={() => {
            posRef.current.x = 640;
            posRef.current.y = 360;
            if (arenaInstance) {
              arenaInstance.setPlannedRoute([], 0);
            }
          }}
        >
          ↺ 重置林克居中
        </button>
        <span style={{ color: '#94a3b8', alignSelf: 'center' }}>
          {activeArrival ? (
            <span style={{ color: '#4ade80' }}>● 已就位: {activeArrival.toUpperCase()}</span>
          ) : (
            <span>等待 AI 指令...</span>
          )}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          background: '#0d1311',
          display: 'block',
        }}
      />
    </div>
  );
}
