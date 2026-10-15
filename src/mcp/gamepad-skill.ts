import { ControllerBackend } from './controller-backend';
import {
  XBOX_BUTTONS,
  type XboxButton,
  type ToolDefinition,
  GAMEPAD_TOOL_DEFINITIONS,
} from './tool-definitions';

export { XBOX_BUTTONS, type XboxButton, type ToolDefinition, GAMEPAD_TOOL_DEFINITIONS };

export async function executeGamepadTool(
  toolName: string,
  args: Record<string, any>,
  backend: ControllerBackend
): Promise<{ ok: boolean; message: string; state?: any }> {
  try {
    const definition = GAMEPAD_TOOL_DEFINITIONS.find(tool => tool.name === toolName);
    if (!definition) throw new Error(`Unknown gamepad tool: ${toolName}`);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object');
    for (const field of definition.parameters.required ?? []) if (!Object.hasOwn(args, field)) throw new Error(`Missing parameter: ${field}`);
    for (const [field, value] of Object.entries(args)) {
      const schema = definition.parameters.properties[field] as { type: string; enum?: readonly unknown[]; minimum?: number; maximum?: number } | undefined;
      if (!schema) throw new Error(`Unknown parameter: ${field}`);
      if (schema.type === 'string' && typeof value !== 'string' || schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))
        || schema.type === 'integer' && !Number.isInteger(value) || schema.enum && !schema.enum.includes(value)
        || schema.minimum !== undefined && (typeof value !== 'number' || value < schema.minimum)
        || schema.maximum !== undefined && (typeof value !== 'number' || value > schema.maximum)) throw new Error(`Invalid parameter: ${field}`);
    }
    switch (toolName) {
      case 'gamepad_press_button': {
        const button = args.button as XboxButton;
        const duration = args.duration_ms ? Number(args.duration_ms) : undefined;
        backend.pressButton(button, duration);
        return {
          ok: true,
          message: duration
            ? `Button '${button}' pressed for ${duration}ms (auto-release scheduled).`
            : `Button '${button}' pressed (holding).`,
          state: backend.getState(),
        };
      }

      case 'gamepad_release_button': {
        const button = args.button as XboxButton;
        backend.releaseButton(button);
        return {
          ok: true,
          message: `Button '${button}' released.`,
          state: backend.getState(),
        };
      }

      case 'gamepad_set_stick': {
        const stick = args.stick as 'left' | 'right';
        const x = Number(args.x);
        const y = Number(args.y);
        const duration = args.duration_ms ? Number(args.duration_ms) : undefined;
        backend.setStick(stick, x, y, duration);
        return {
          ok: true,
          message: duration
            ? `${stick.toUpperCase()} stick tilted to (${x.toFixed(2)}, ${y.toFixed(2)}) for ${duration}ms (auto-center scheduled).`
            : `${stick.toUpperCase()} stick tilted to (${x.toFixed(2)}, ${y.toFixed(2)}).`,
          state: backend.getState(),
        };
      }

      case 'gamepad_set_trigger': {
        const trigger = args.trigger as 'left' | 'right';
        const value = Number(args.value);
        const duration = args.duration_ms ? Number(args.duration_ms) : undefined;
        backend.setTrigger(trigger, value, duration);
        return {
          ok: true,
          message: duration
            ? `${trigger.toUpperCase()} trigger pressed to ${value.toFixed(2)} for ${duration}ms (auto-release scheduled).`
            : `${trigger.toUpperCase()} trigger pressed to ${value.toFixed(2)}.`,
          state: backend.getState(),
        };
      }

      case 'gamepad_reset_all': {
        backend.resetAll();
        return {
          ok: true,
          message: 'All virtual gamepad buttons and axes reset to neutral.',
          state: backend.getState(),
        };
      }

      case 'gamepad_get_state': {
        return {
          ok: true,
          message: 'Retrieved virtual gamepad state.',
          state: backend.getState(),
        };
      }

      default:
        return {
          ok: false,
          message: `Unknown gamepad tool: ${toolName}`,
        };
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
