"""GamePilot private JSONL input service, protocol 2.

Adapted from the frozen UI-TARS/GamePilot prototype (Apache-2.0).
One reader, one execution worker, a watchdog; all device writes share one lock.
--dry-run never imports vgamepad. Startup sends only a neutral reset.
"""
import argparse
import json
import math
import queue
import sys
import threading
import time

BUTTONS = {
    'A': 'A', 'B': 'B', 'X': 'X', 'Y': 'Y', 'LB': 'LEFT_SHOULDER',
    'RB': 'RIGHT_SHOULDER', 'BACK': 'BACK', 'START': 'START',
    'LS': 'LEFT_THUMB', 'RS': 'RIGHT_THUMB',
    'DPAD_UP': 'DPAD_UP', 'DPAD_DOWN': 'DPAD_DOWN',
    'DPAD_LEFT': 'DPAD_LEFT', 'DPAD_RIGHT': 'DPAD_RIGHT',
}


def validate(actions):
    if not isinstance(actions, list) or not 1 <= len(actions) <= 8:
        raise ValueError('Expected 1..8 actions')
    total = 0
    for action in actions:
        if not isinstance(action, dict) or set(action) - {'buttons', 'durationMs', 'leftStick', 'rightStick', 'leftTrigger', 'rightTrigger'}:
            raise ValueError('Invalid action fields')
        buttons = action.get('buttons')
        if not isinstance(buttons, list) or len(buttons) > 3 or any(not isinstance(b, str) or b not in BUTTONS for b in buttons) or len(set(buttons)) != len(buttons):
            raise ValueError('Invalid buttons')
        duration = action.get('durationMs')
        if type(duration) is not int or not 20 <= duration <= 1500:
            raise ValueError('Invalid duration')
        total += duration
        for name in ('leftTrigger', 'rightTrigger'):
            value = action.get(name, 0)
            if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError('Invalid trigger')
        for name in ('leftStick', 'rightStick'):
            if name in action:
                stick = action[name]
                if not isinstance(stick, dict) or set(stick) != {'x', 'y'} or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 1 for v in stick.values()):
                    raise ValueError('Invalid stick')
    if total > 4000:
        raise ValueError('Sequence exceeds 4000ms')
    return actions


class Backend:
    def __init__(self, dry_run=False):
        self.pad = None
        self.neutral = False
        self.applied_count = 0
        if not dry_run:
            import vgamepad as vg
            self.vg = vg
            self.pad = vg.VX360Gamepad()

    def reset(self):
        self.neutral = False
        if self.pad is not None:
            self.pad.reset()
            self.pad.update()
        self.neutral = True

    def apply(self, action):
        self.neutral = False
        if self.pad is not None:
            self.pad.reset()
            for button in action['buttons']:
                self.pad.press_button(button=getattr(self.vg.XUSB_BUTTON, 'XUSB_GAMEPAD_' + BUTTONS[button]))
            left = action.get('leftStick', {'x': 0, 'y': 0})
            right = action.get('rightStick', {'x': 0, 'y': 0})
            self.pad.left_joystick_float(x_value_float=left['x'], y_value_float=left['y'])
            self.pad.right_joystick_float(x_value_float=right['x'], y_value_float=right['y'])
            self.pad.left_trigger_float(value_float=action.get('leftTrigger', 0))
            self.pad.right_trigger_float(value_float=action.get('rightTrigger', 0))
            self.pad.update()
        self.applied_count += 1


class Service:
    def __init__(self, backend=None, dry_run=False, watchdog_seconds=2.0):
        self.backend = backend or Backend(dry_run)
        self.dry_run = dry_run
        self.watchdog_seconds = watchdog_seconds
        self.lock = threading.RLock()
        self.output_lock = threading.Lock()
        self.outputs = queue.Queue(maxsize=1024)
        self.closed = threading.Event()
        self.jobs = queue.Queue(maxsize=16)
        self.generation = 0
        self.run_id = None
        self.cancel = threading.Event()
        self.last_contact = time.monotonic()
        self.fault = None
        self.worker = None
        self.watch = None
        self.writer = None
        self.backend.reset()

    def emit(self, value):
        # stdout backpressure must never hold the device lock and delay reset.
        try:
            self.outputs.put_nowait(value)
        except queue.Full:
            self.fault = 'Output backpressure'
            self.closed.set()
            self.cancel.set()
            self.invalidate('output_backpressure')

    def writer_loop(self):
        while True:
            value = self.outputs.get()
            if value is None:
                return
            try:
                print(json.dumps(value, allow_nan=False), flush=True)
            except (BrokenPipeError, OSError):
                self.closed.set()
                self.cancel.set()
                try:
                    self.invalidate('output_closed')
                except Exception:
                    pass
                return

    def invalidate(self, reason):
        """Return only after neutral update; old generations can never apply again."""
        with self.lock:
            self.cancel.set()
            self.generation += 1
            self.run_id = None
            try:
                self.backend.reset()
            except Exception:
                self.fault = 'Device reset failed'
                raise RuntimeError(self.fault)
            return {'generation': self.generation, 'neutral': True, 'reason': reason}

    def begin(self, run_id):
        if not isinstance(run_id, str) or not 1 <= len(run_id) <= 100:
            raise ValueError('Invalid runId')
        with self.lock:
            if self.fault:
                raise RuntimeError(self.fault)
            self.invalidate('new_lease')
            self.cancel = threading.Event()
            self.run_id = run_id
            self.last_contact = time.monotonic()
            return {'runId': run_id, 'generation': self.generation, 'neutral': True}

    def enqueue(self, request):
        actions = validate(request.get('actions'))
        with self.lock:
            if self.fault:
                raise RuntimeError(self.fault)
            if type(request.get('generation')) is not int or request['generation'] != self.generation or request.get('runId') != self.run_id or self.run_id is None or self.cancel.is_set():
                raise ValueError('Stale or absent control lease')
            job = {'id': request['id'], 'runId': self.run_id, 'generation': self.generation, 'cancel': self.cancel, 'actions': actions}
            self.jobs.put_nowait(job)
            self.last_contact = time.monotonic()
            self.emit({'event': 'queued', 'id': job['id'], 'generation': job['generation'], 'runId': job['runId']})

    def execute(self, job):
        started = time.monotonic()
        executed = []
        error = None
        interrupted = False
        try:
            for index, action in enumerate(job['actions']):
                with self.lock:
                    if job['generation'] != self.generation or job['cancel'].is_set() or self.closed.is_set():
                        interrupted = True
                        break
                    self.backend.apply(action)
                    self.emit({'event': 'action_start', 'id': job['id'], 'runId': job['runId'], 'generation': job['generation'], 'index': index})
                action_start = time.monotonic()
                interrupted = job['cancel'].wait(action['durationMs'] / 1000)
                with self.lock:
                    if job['generation'] == self.generation:
                        self.backend.reset()
                    if interrupted or job['generation'] != self.generation:
                        interrupted = True
                        break
                    completed = {'index': index, 'durationMs': round((time.monotonic() - action_start) * 1000, 3)}
                    executed.append(completed)
                    self.emit({'event': 'action_end', 'id': job['id'], 'runId': job['runId'], 'generation': job['generation'], **completed, 'neutral': True})
        except Exception:
            error = 'Device execution failed'
            with self.lock:
                self.fault = error
                try:
                    self.invalidate('device_error')
                except Exception:
                    error = 'Device reset failed'
        finally:
            with self.lock:
                interrupted = interrupted or job['cancel'].is_set() or job['generation'] != self.generation
                try:
                    # Never let an old worker overwrite a new lease's input state.
                    if job['generation'] == self.generation:
                        self.backend.reset()
                except Exception:
                    error = self.fault = 'Device reset failed'
                    job['cancel'].set()
                self.emit({'id': job['id'], 'ok': error is None and not interrupted,
                           'status': 'error' if error else 'cancelled' if interrupted else 'executed',
                           'runId': job['runId'], 'generation': job['generation'], 'executed': executed,
                           'durationMs': round((time.monotonic() - started) * 1000, 3), 'neutral': bool(self.backend.neutral), 'error': error})

    def worker_loop(self):
        while True:
            job = self.jobs.get()
            try:
                if job is None:
                    return
                self.execute(job)
            finally:
                self.jobs.task_done()

    def watchdog(self):
        while not self.closed.wait(0.05):
            with self.lock:
                if self.run_id is not None and time.monotonic() - self.last_contact > self.watchdog_seconds:
                    try:
                        result = self.invalidate('heartbeat_lost')
                        self.emit({'event': 'watchdog', **result})
                    except Exception:
                        self.emit({'event': 'fatal', 'error': 'Watchdog reset failed', 'neutral': False})

    def start_threads(self):
        self.writer = threading.Thread(target=self.writer_loop, daemon=True)
        self.worker = threading.Thread(target=self.worker_loop, daemon=True)
        self.watch = threading.Thread(target=self.watchdog, daemon=True)
        self.writer.start()
        self.worker.start()
        self.watch.start()

    def handle(self, request):
        request_id = request.get('id')
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 100:
            raise ValueError('Invalid request id')
        op = request.get('op')
        if op == 'execute_sequence':
            self.enqueue(request)
            return False
        if op == 'begin':
            result = self.begin(request.get('runId'))
        elif op == 'ping':
            with self.lock:
                self.last_contact = time.monotonic()
                result = {'generation': self.generation, 'neutral': bool(self.backend.neutral)}
        elif op in ('reset', 'shutdown'):
            result = self.invalidate(op)
        elif op == 'status':
            with self.lock:
                result = {'generation': self.generation, 'runId': self.run_id, 'neutral': bool(self.backend.neutral), 'appliedCount': self.backend.applied_count}
        else:
            raise ValueError('Unknown operation')
        self.emit({'id': request_id, 'ok': True, **result})
        return op == 'shutdown'

    def close(self):
        self.closed.set()
        try:
            self.invalidate('eof')
        finally:
            if self.worker:
                # Drain invalidated jobs and join the single worker before exit.
                self.jobs.put(None)
                self.worker.join(3)
            if self.watch:
                self.watch.join(1)
            if self.writer:
                try:
                    self.outputs.put(None, timeout=.1)
                except queue.Full:
                    pass
                self.writer.join(1)

    def run(self):
        self.start_threads()
        self.emit({'event': 'ready', 'protocol': 2, 'backend': 'dry-run' if self.dry_run else 'virtual-xbox', 'neutral': True})
        try:
            for line in sys.stdin:
                request_id = None
                try:
                    if len(line) > 65536:
                        raise ValueError('Request too large')
                    request = json.loads(line)
                    if not isinstance(request, dict):
                        raise ValueError('Invalid request')
                    request_id = request.get('id')
                    if self.handle(request):
                        break
                except Exception as exc:
                    self.emit({'id': request_id, 'ok': False, 'error': str(exc), 'neutral': bool(self.backend.neutral)})
        finally:
            self.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    try:
        Service(dry_run=args.dry_run).run()
    except Exception as exc:
        print(json.dumps({'event': 'fatal', 'error': type(exc).__name__ + ': ' + str(exc), 'neutral': False}), flush=True)
        sys.exit(1)
