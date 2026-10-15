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
  backend: 'emulator';
}

/**
 * ControllerBackend provides atomic, zero-prior virtual gamepad control.
 * It manages simulated state only and never creates a physical controller.
 * Every simulated hold expires after at most ten seconds.
 */
export class ControllerBackend {
  private buttons = new Set<XboxButton>();
  private leftStick = { x: 0, y: 0 };
  private rightStick = { x: 0, y: 0 };
  private leftTrigger = 0;
  private rightTrigger = 0;

  private timers = new Map<string, NodeJS.Timeout>();
  constructor(options: { rootDir?: string; forceEmulator?: boolean } = {}) {
    if (options.forceEmulator === false) throw new Error('Native input is not validated or available; MCP provides an in-memory emulator only');
  }

  /**
   * Simulated hold watchdog:
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

    this.scheduleRelease(`btn:${button}`, durationMs ?? 10000, () => this.releaseButton(button));
  }

  public releaseButton(button: XboxButton): void {
    this.clearSchedule(`btn:${button}`);
    this.buttons.delete(button);
  }

  public setStick(stick: 'left' | 'right', x: number, y: number, durationMs?: number): void {
    const clampedX = Math.max(-1.0, Math.min(1.0, Number(x) || 0));
    const clampedY = Math.max(-1.0, Math.min(1.0, Number(y) || 0));

    if (stick === 'left') {
      this.leftStick = { x: clampedX, y: clampedY };
    } else {
      this.rightStick = { x: clampedX, y: clampedY };
    }

    this.scheduleRelease(`stick:${stick}`, durationMs ?? 10000, () => {
      if (stick === 'left') this.leftStick = { x: 0, y: 0 };
      else this.rightStick = { x: 0, y: 0 };
    });
  }

  public setTrigger(trigger: 'left' | 'right', value: number, durationMs?: number): void {
    const clamped = Math.max(0.0, Math.min(1.0, Number(value) || 0));

    if (trigger === 'left') {
      this.leftTrigger = clamped;
    } else {
      this.rightTrigger = clamped;
    }

    this.scheduleRelease(`trigger:${trigger}`, durationMs ?? 10000, () => {
      if (trigger === 'left') this.leftTrigger = 0;
      else this.rightTrigger = 0;
    });
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
      backend: 'emulator',
    };
  }

  public close(): void {
    this.resetAll();
  }
}
