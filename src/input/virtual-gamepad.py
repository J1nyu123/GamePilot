"""JSON-lines bridge. Only the worker touches ViGEm; stdin cancels active holds."""
import ctypes
import json
import math
import queue
import sys
import threading
import time

BUTTONS = {'A': 0x1000, 'B': 0x2000, 'X': 0x4000, 'Y': 0x8000,
           'LB': 0x100, 'RB': 0x200, 'BACK': 0x20, 'START': 0x10,
           'LS': 0x40, 'RS': 0x80, 'DPAD_UP': 1, 'DPAD_DOWN': 2,
           'DPAD_LEFT': 4, 'DPAD_RIGHT': 8}


def validate(action):
    if not isinstance(action, dict) or set(action) - {'buttons', 'left_x', 'left_y', 'right_x', 'right_y', 'left_trigger', 'right_trigger', 'duration_ms'}:
        raise ValueError('Invalid action fields')
    duration = action.get('duration_ms')
    if type(duration) is not int or not 20 <= duration <= 1000:
        raise ValueError('duration_ms must be 20..1000')
    buttons = action.get('buttons', [])
    if not isinstance(buttons, list) or len(buttons) > 4 or any(b not in BUTTONS for b in buttons) or len(set(buttons)) != len(buttons):
        raise ValueError('Invalid buttons')
    for name in ['left_x', 'left_y', 'right_x', 'right_y', 'left_trigger', 'right_trigger']:
        value = action.get(name, 0)
        if type(value) not in (int, float) or not math.isfinite(value) or not (-1 if name.endswith(('x', 'y')) else 0) <= value <= 1:
            raise ValueError('Invalid axis: ' + name)


def main():
    pad = None
    canceled = threading.Event()
    requests = queue.Queue()
    def reply(value):
        print(json.dumps(value), flush=True)
    def reader():
        try:
            for line in sys.stdin:
                request = json.loads(line)
                if request.get('op') in ('cancel', 'close'):
                    canceled.set()
                requests.put(request)
                if request.get('op') == 'close':
                    return
        finally:
            canceled.set()
            requests.put({'op': 'close'})
    try:
        import vgamepad as vg
        pad = vg.VX360Gamepad()
        pad.reset()
        pad.update()
        reply({'ready': True, 'backend': 'vigem-xbox360', 'neutral': True})
        threading.Thread(target=reader, daemon=True).start()
        user32 = ctypes.WinDLL('user32', use_last_error=True)
        user32.GetForegroundWindow.restype = ctypes.c_void_p
        user32.GetWindowThreadProcessId.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        user32.IsIconic.argtypes = [ctypes.c_void_p]
        while True:
            request = requests.get()
            if request.get('op') == 'close':
                break
            try:
                if request.get('op') == 'cancel':
                    pad.reset(); pad.update()
                    reply({'id': request.get('id'), 'ok': True, 'neutral': True})
                    continue
                if request.get('op') != 'action':
                    raise ValueError('Unknown operation')
                action = request['action']
                validate(action)
                handle, expected_pid = int(request['handle']), int(request['pid'])
                def check():
                    pid = ctypes.c_ulong()
                    user32.GetWindowThreadProcessId(handle, ctypes.byref(pid))
                    if canceled.is_set():
                        raise RuntimeError('Action canceled')
                    if pid.value != expected_pid or user32.IsIconic(handle) or user32.GetForegroundWindow() != handle:
                        raise RuntimeError('Game window lost focus or identity')
                # A cancellation queued before this action must not be forgotten.
                check()
                try:
                    for button in action.get('buttons', []):
                        pad.press_button(button=BUTTONS[button])
                    pad.left_joystick_float(x_value_float=action.get('left_x', 0), y_value_float=action.get('left_y', 0))
                    pad.right_joystick_float(x_value_float=action.get('right_x', 0), y_value_float=action.get('right_y', 0))
                    pad.left_trigger_float(value_float=action.get('left_trigger', 0))
                    pad.right_trigger_float(value_float=action.get('right_trigger', 0))
                    pad.update()
                    until = time.monotonic() + action['duration_ms'] / 1000
                    while time.monotonic() < until:
                        check()
                        time.sleep(0.01)
                finally:
                    pad.reset(); pad.update()
                reply({'id': request['id'], 'ok': True, 'neutral': True, 'released': True, 'backend': 'vigem-xbox360'})
            except Exception as error:
                pad.reset(); pad.update()
                reply({'id': request.get('id'), 'ok': False, 'error': str(error), 'neutral': True})
            finally:
                # Cancel is terminal for this bridge. Host reconnects for the next run.
                if canceled.is_set():
                    break
    except Exception as error:
        reply({'ready': False, 'error': str(error)})
    finally:
        if pad is not None:
            pad.reset(); pad.update()


if __name__ == '__main__':
    main()
