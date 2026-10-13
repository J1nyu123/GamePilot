export const XBOX_BUTTONS = [
  'A', 'B', 'X', 'Y',
  'LB', 'RB',
  'BACK', 'START',
  'LS', 'RS',
  'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT',
] as const;

export type XboxButton = typeof XBOX_BUTTONS[number];

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Standard Zero-Prior Gamepad Tool Schemas.
 * Strictly adheres to hardware controls with NO game-specific verbs or heuristics.
 */
export const GAMEPAD_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'gamepad_press_button',
    description: 'Press an Xbox 360 controller button. If duration_ms is specified, holds the button for that duration and automatically releases it.',
    parameters: {
      type: 'object',
      properties: {
        button: {
          type: 'string',
          enum: XBOX_BUTTONS,
          description: 'The physical button on the Xbox 360 controller.',
        },
        duration_ms: {
          type: 'integer',
          minimum: 20,
          maximum: 5000,
          description: 'Optional hold duration in milliseconds (20–5000ms). If omitted, holds until explicitly released.',
        },
      },
      required: ['button'],
    },
  },
  {
    name: 'gamepad_release_button',
    description: 'Release a previously pressed button on the Xbox 360 controller back to its unpressed state.',
    parameters: {
      type: 'object',
      properties: {
        button: {
          type: 'string',
          enum: XBOX_BUTTONS,
          description: 'The physical button to release.',
        },
      },
      required: ['button'],
    },
  },
  {
    name: 'gamepad_set_stick',
    description: 'Deflect the analog thumbstick along X and Y axes. If duration_ms is specified, holds the deflection vector and automatically centers back to (0, 0).',
    parameters: {
      type: 'object',
      properties: {
        stick: {
          type: 'string',
          enum: ['left', 'right'],
          description: 'Which analog thumbstick to deflect (left or right).',
        },
        x: {
          type: 'number',
          minimum: -1.0,
          maximum: 1.0,
          description: 'Horizontal deflection: -1.0 (full left) to +1.0 (full right). 0.0 is center.',
        },
        y: {
          type: 'number',
          minimum: -1.0,
          maximum: 1.0,
          description: 'Vertical deflection: -1.0 (full down) to +1.0 (full up). 0.0 is center.',
        },
        duration_ms: {
          type: 'integer',
          minimum: 20,
          maximum: 5000,
          description: 'Optional deflection duration in milliseconds (20–5000ms). If omitted, stays deflected until next command.',
        },
      },
      required: ['stick', 'x', 'y'],
    },
  },
  {
    name: 'gamepad_set_trigger',
    description: 'Press the analog trigger (LT or RT) to an analog depth between 0.0 (released) and 1.0 (fully depressed).',
    parameters: {
      type: 'object',
      properties: {
        trigger: {
          type: 'string',
          enum: ['left', 'right'],
          description: 'Which analog trigger to press (left trigger LT or right trigger RT).',
        },
        value: {
          type: 'number',
          minimum: 0.0,
          maximum: 1.0,
          description: 'Trigger depth: 0.0 (released) to 1.0 (fully depressed).',
        },
        duration_ms: {
          type: 'integer',
          minimum: 20,
          maximum: 5000,
          description: 'Optional hold duration in milliseconds (20–5000ms). If omitted, stays pressed until next command.',
        },
      },
      required: ['trigger', 'value'],
    },
  },
  {
    name: 'gamepad_reset_all',
    description: 'Safety reset: immediately releases all buttons, centers both analog sticks to (0, 0), and releases all triggers to 0.0.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'gamepad_get_state',
    description: 'Query the current virtual gamepad hardware state (active pressed buttons, thumbstick deflection coordinates, trigger depths, and neutrality status).',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];
