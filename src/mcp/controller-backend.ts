import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { XBOX_BUTTONS, type XboxButton } from './tool-definitions';
export { XBOX_BUTTONS, type XboxButton };

export interface ControllerState {
  buttons: XboxButton[];
  leftStick: { x: number; y: number };
  rightStick: { x: number; y: number };
  leftTrigger: number;
  rightTrigger: number;
  neutral: boolean;
  activeTimers: number;
  backend: 'vgamepad-native' | 'emulator';
}

/**
 * ControllerBackend provides atomic, zero-prior virtual gamepad control.
 * It manages an in-memory state and communicates with Python vgamepad if present on Windows,
 * with automatic fallback to high-fidelity emulation in cross-platform/sandbox environments.
 */
export class ControllerBackend {
  private buttons = new Set<XboxButton>();
  private leftStick = { x: 0, y: 0 };
  private rightStick = { x: 0, y: 0 };
  private leftTrigger = 0;
  private rightTrigger = 0;

  private timers = new Map<string, NodeJS.Timeout>();
  private pythonProcess: ChildProcess | null = null;
  private backendType: 'vgamepad-native' | 'emulator' = 'emulator';
  private runId = `session-${Date.now()}`;
  private generation = 0;
  private requestId = 0;

  constructor(options: { rootDir?: string; forceEmulator?: boolean } = {}) {
    const root = options.rootDir || process.cwd();
    const pythonScript = resolve(root, 'python/gamepad_service.py');

    if (!options.forceEmulator && existsSync(pythonScript) && process.platform === 'win32') {
      try {
        this.initPythonBackend(pythonScript);
      } catch {
        this.backendType = 'emulator';
      }
    } else {
      this.backendType = 'emulator';
    }
  }

  private initPythonBackend(scriptPath: string) {
    const py = spawn('python', [scriptPath], { stdio: ['pipe', 'pipe', 'inherit'] });
    py.on('error', () => {
      this.backendType = 'emulator';
      this.pythonProcess = null;
    });
    py.on('exit', () => {
      this.backendType = 'emulator';
      this.pythonProcess = null;
    });

    this.pythonProcess = py;
    this.backendType = 'vgamepad-native';
    this.sendPython({ op: 'begin', id: `req-${++this.requestId}`, runId: this.runId });
  }

  private sendPython(msg: Record<string, unknown>) {
    if (this.pythonProcess?.stdin?.writable) {
      this.pythonProcess.stdin.write(JSON.stringify(msg) + '\n');
    }
  }

  /**
   * Hardware Safety Watchdog:
   * Sets a safety timer that automatically releases an input if not explicitly updated or cancelled.
   */
  private scheduleRelease(key: string, durationMs: number, onRelease: () => void) {
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.timers.delete(key);
      onRelease();
    }, Math.max(20, Math.min(durationMs, 10000))); // Enforce strict 10s ceiling

    this.timers.set(key, timer);
  }

  private clearSchedule(key: string) {
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(key);
    }
  }

  public pressButton(button: XboxButton, durationMs?: number): void {
    if (!XBOX_BUTTONS.includes(button)) {
      throw new Error(`Invalid button '${button}'. Supported: ${XBOX_BUTTONS.join(', ')}`);
    }

    this.buttons.add(button);
    this.syncNative();

    if (durationMs !== undefined && durationMs > 0) {
      this.scheduleRelease(`btn:${button}`, durationMs, () => {
        this.releaseButton(button);
      });
    }
  }

  public releaseButton(button: XboxButton): void {
    this.clearSchedule(`btn:${button}`);
    this.buttons.delete(button);
    this.syncNative();
  }

  public setStick(stick: 'left' | 'right', x: number, y: number, durationMs?: number): void {
    const clampedX = Math.max(-1.0, Math.min(1.0, Number(x) || 0));
    const clampedY = Math.max(-1.0, Math.min(1.0, Number(y) || 0));

    if (stick === 'left') {
      this.leftStick = { x: clampedX, y: clampedY };
    } else {
      this.rightStick = { x: clampedX, y: clampedY };
    }
    this.syncNative();

    if (durationMs !== undefined && durationMs > 0) {
      this.scheduleRelease(`stick:${stick}`, durationMs, () => {
        if (stick === 'left') {
          this.leftStick = { x: 0, y: 0 };
        } else {
          this.rightStick = { x: 0, y: 0 };
        }
        this.syncNative();
      });
    }
  }

  public setTrigger(trigger: 'left' | 'right', value: number, durationMs?: number): void {
    const clamped = Math.max(0.0, Math.min(1.0, Number(value) || 0));

    if (trigger === 'left') {
      this.leftTrigger = clamped;
    } else {
      this.rightTrigger = clamped;
    }
    this.syncNative();

    if (durationMs !== undefined && durationMs > 0) {
      this.scheduleRelease(`trigger:${trigger}`, durationMs, () => {
        if (trigger === 'left') {
          this.leftTrigger = 0;
        } else {
          this.rightTrigger = 0;
        }
        this.syncNative();
      });
    }
  }

  public resetAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    this.buttons.clear();
    this.leftStick = { x: 0, y: 0 };
    this.rightStick = { x: 0, y: 0 };
    this.leftTrigger = 0;
    this.rightTrigger = 0;

    if (this.pythonProcess) {
      this.sendPython({ op: 'reset', id: `req-${++this.requestId}` });
    }
  }

  private syncNative() {
    if (!this.pythonProcess) return;

    this.sendPython({
      op: 'execute_sequence',
      id: `act-${++this.requestId}`,
      runId: this.runId,
      generation: this.generation,
      actions: [
        {
          buttons: Array.from(this.buttons),
          leftStick: this.leftStick,
          rightStick: this.rightStick,
          leftTrigger: this.leftTrigger,
          rightTrigger: this.rightTrigger,
          durationMs: 50,
        },
      ],
    });
  }

  public getState(): ControllerState {
    const isNeutral =
      this.buttons.size === 0 &&
      this.leftStick.x === 0 &&
      this.leftStick.y === 0 &&
      this.rightStick.x === 0 &&
      this.rightStick.y === 0 &&
      this.leftTrigger === 0 &&
      this.rightTrigger === 0;

    return {
      buttons: Array.from(this.buttons),
      leftStick: { ...this.leftStick },
      rightStick: { ...this.rightStick },
      leftTrigger: this.leftTrigger,
      rightTrigger: this.rightTrigger,
      neutral: isNeutral,
      activeTimers: this.timers.size,
      backend: this.backendType,
    };
  }

  public close(): void {
    this.resetAll();
    if (this.pythonProcess) {
      this.sendPython({ op: 'shutdown', id: `req-${++this.requestId}` });
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
  }
}
