import { createWebGamepilot } from './web-adapter';

// Capture the preload API before main.tsx installs the browser fallback.
export const desktopApi = window.gamepilot;
let sandboxApi: ReturnType<typeof createWebGamepilot> | undefined;
export function getSandboxApi() {
  return sandboxApi ??= createWebGamepilot();
}
