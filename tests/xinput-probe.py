"""Independent OS-side observer; does not import vgamepad or emit input."""
import ctypes
import json
import time

class Pad(ctypes.Structure):
    _fields_ = [('buttons', ctypes.c_ushort), ('lt', ctypes.c_ubyte), ('rt', ctypes.c_ubyte),
                ('lx', ctypes.c_short), ('ly', ctypes.c_short), ('rx', ctypes.c_short), ('ry', ctypes.c_short)]
class State(ctypes.Structure):
    _fields_ = [('packet', ctypes.c_ulong), ('pad', Pad)]

api = ctypes.WinDLL('xinput1_4')
try:
    while True:
        states = []
        for index in range(4):
            state = State()
            if api.XInputGetState(index, ctypes.byref(state)) == 0:
                states.append(dict(index=index, **{name: getattr(state.pad, name) for name, _ in Pad._fields_}))
        print(json.dumps(states), flush=True)
        time.sleep(0.01)
except (BrokenPipeError, KeyboardInterrupt):
    pass
