import threading
import unittest
from gamepad_service import Service, Backend, validate


class InstrumentedBackend(Backend):
    def __init__(self):
        super().__init__(dry_run=True)
        self.started = threading.Event()
        self.reset_failed = False

    def apply(self, action):
        super().apply(action)
        self.started.set()

    def reset(self):
        if self.reset_failed:
            self.neutral = False
            raise RuntimeError('Injected reset failure')
        super().reset()


class RecordingService(Service):
    def __init__(self):
        self.responses = []
        super().__init__(backend=InstrumentedBackend(), dry_run=True)

    def emit(self, value):
        self.responses.append(value)


class Tests(unittest.TestCase):
    def test_entire_sequence_validated_before_input(self):
        invalid = [
            {'buttons': ['BAD'], 'durationMs': 30},
            {'buttons': [], 'durationMs': True},
            {'buttons': [], 'durationMs': 1600},
            {'buttons': [], 'durationMs': 30, 'leftStick': {'x': float('nan'), 'y': 0}},
            {'buttons': [], 'durationMs': 30, 'leftTrigger': float('inf')},
            {'buttons': [], 'durationMs': 30, 'rightTrigger': -1},
        ]
        for action in invalid:
            with self.assertRaises(ValueError):
                validate([{'buttons': ['A'], 'durationMs': 20}, action])

    def test_reset_ack_is_neutral_and_old_queued_generation_never_applies(self):
        service = RecordingService()
        lease = service.begin('run')
        cancel = service.cancel
        job = {'id': 'first', 'runId': 'run', 'generation': lease['generation'], 'cancel': cancel, 'actions': [{'buttons': [], 'leftStick': {'x': .5, 'y': 0}, 'durationMs': 1500}]}
        worker = threading.Thread(target=service.execute, args=(job,))
        worker.start()
        self.assertTrue(service.backend.started.wait(1))
        reset = service.invalidate('test')
        self.assertTrue(reset['neutral'])
        self.assertTrue(service.backend.neutral)
        worker.join(1)
        self.assertFalse(worker.is_alive())
        service.execute({**job, 'id': 'queued'})
        self.assertEqual(service.backend.applied_count, 1)
        self.assertEqual(service.responses[-1]['status'], 'cancelled')
        with self.assertRaisesRegex(ValueError, 'Stale'):
            service.enqueue({'id': 'late', 'runId': 'run', 'generation': lease['generation'], 'actions': job['actions']})

    def test_reset_failure_is_not_reported_neutral(self):
        service = RecordingService()
        service.begin('run')
        service.backend.reset_failed = True
        with self.assertRaisesRegex(RuntimeError, 'reset failed'):
            service.invalidate('reset')
        self.assertFalse(service.backend.neutral)
        with self.assertRaises(RuntimeError):
            service.begin('new')

    def test_new_lease_cannot_revive_old_cancel_event(self):
        service = RecordingService()
        first = service.begin('old')
        old_cancel = service.cancel
        next_lease = service.begin('new')
        self.assertTrue(old_cancel.is_set())
        self.assertGreater(next_lease['generation'], first['generation'])
        service.execute({'id': 'old', 'runId': 'old', 'generation': first['generation'], 'cancel': old_cancel, 'actions': [{'buttons': ['A'], 'durationMs': 20}]})
        self.assertEqual(service.backend.applied_count, 0)
        service.execute({'id': 'new', 'runId': 'new', 'generation': next_lease['generation'], 'cancel': service.cancel, 'actions': [{'buttons': [], 'durationMs': 20}]})
        self.assertEqual(service.backend.applied_count, 1)
        self.assertTrue(service.responses[-1]['ok'])


if __name__ == '__main__':
    unittest.main()
