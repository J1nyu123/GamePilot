import { randomUUID } from 'node:crypto';
import type { AgentEvent, ImportedImage, RunSummary } from '../contracts/debug';
import type { GoalSpec } from '../contracts/verification';
import type { FrameEvidence } from '../contracts/capture';
import type { ModelConfig } from '../main/model-config';
import type { Runner } from '../main/session';
import type { ManualInputController } from '../input/manual-controller';
import type { ApproachExperiment } from '../experiments/approach';
import { runValidation } from '../agent/validation-runtime';
import { RuntimeSupervisor, newSupervisorBudget } from './supervisor';
import { ApproachRunner } from './approach-runner';
import { GameVerifier } from '../verification/verifier';
import { TargetEstimator } from '../state/target-estimator';
// @ts-expect-error Local Pi transport is bundled through the pinned resolver.
import { locateTarget } from '../state/target-model.mjs';

/** Application service shared by IPC and host simulations. Owns run assembly; IPC owns validation. */
export function createRealExecution({ inputController, guard, captureInput, config, evidence, goal, experiment, interrupt }: {
  inputController: ManualInputController; guard(): Promise<void>;
  captureInput(): Promise<{ image: ImportedImage; bytes: Buffer }>;
  config: ModelConfig; evidence: FrameEvidence; goal?: GoalSpec; experiment?: ApproachExperiment; interrupt(): void;
}) {
  const budget = newSupervisorBudget();
  let baseline: ImportedImage | undefined;
  const runner: Runner = async (options, replaceInput, trace) => {
    let approachRunner: ApproachRunner | undefined;
    let result;
    try { result = await inputController.withAgent(options.signal, guard, async (execute, ensureNeutral) => {
        options.signal.throwIfAborted();
        options.onEvent({ sequence: 0, timestamp: Date.now(), type: 'observation_start', text: '正在获取准备完成后的游戏窗口新帧', simulated: false });
        const receipt = baseline ? await ensureNeutral() : undefined;
        const release = receipt ? { id: randomUUID(), receipt, sourceId: evidence.sourceId, identity: evidence.identity, captureGeneration: evidence.generation, receivedAt: Date.now(), order: 'release-ack-then-capture' as const } : undefined;
        const fresh = await captureInput();
        await guard(); options.signal.throwIfAborted();
        if (!baseline) { await replaceInput(fresh.image, fresh.bytes); baseline = fresh.image; }
        else {
          await trace.saveObservation(fresh.image, fresh.bytes, release!);
          budget.observations++;
          options.onEvent({ sequence: 0, timestamp: Date.now(), type: 'observation_resumed', observationId: fresh.image.id, release, text: '恢复后新帧，原始目标参考图保持不变' });
        }
        if (experiment && goal) {
          let turn = 0, toolCallId: string | undefined;
          const emit = (type: string, fields: Partial<AgentEvent>) => options.onEvent({ sequence: 0, timestamp: Date.now(), type, turn, toolCallId, simulated: false, ...fields });
          const verifier = new GameVerifier(config, text => emit('verification_model_text', { text }));
          approachRunner = new ApproachRunner(experiment.spec, goal, fresh.image, options.signal, {
            execute, neutral: ensureNeutral, stop: reason => inputController.stop(reason),
            capture: async signal => { signal.throwIfAborted(); const captured = await captureInput(); signal.throwIfAborted(); await guard(); signal.throwIfAborted(); return captured.image; },
            save: (image, release) => trace.saveObservation(image, Buffer.from(image.dataUrl.split(',')[1], 'base64'), release),
            tracker: new TargetEstimator(request => locateTarget({ config, input: request })), verify: request => verifier.verify(request), emit,
          });
          return approachRunner.run(experiment.strategy, toolRegistry => runValidation({ ...options, maxTurns: Math.min(options.maxTurns ?? 4, 3),
            image: { type: 'image', data: fresh.bytes.toString('base64'), mimeType: fresh.image.mimeType },
            onEvent: event => { if (event.turn) turn = event.turn; if (event.toolCallId) toolCallId = event.toolCallId; options.onEvent(event); },
            toolRegistry,
          }));
        }
        if (goal) {
          let turn = 0, toolCallId: string | undefined;
          const verifier = new GameVerifier(config, text => options.onEvent({ sequence: 0, timestamp: Date.now(), type: 'verification_model_text', turn, toolCallId, text, simulated: false }));
          const supervisor = new RuntimeSupervisor(goal, baseline, options.signal, {
            execute, neutral: ensureNeutral,
            capture: async signal => { const captured = await captureInput(); signal.throwIfAborted(); await guard(); signal.throwIfAborted(); return captured.image; },
            save: (image, release) => trace.saveObservation(image, Buffer.from(image.dataUrl.split(',')[1], 'base64'), release),
            verify: request => verifier.verify(request),
            emit: (type, fields) => options.onEvent({ sequence: 0, timestamp: Date.now(), type, turn, simulated: false, ...fields }),
          }, budget, fresh.image);
          const withSignal = async <T>(signal: AbortSignal | undefined, id: string, work: () => Promise<T>) => {
            toolCallId = id;
            const stop = () => { void inputController.stop('工具调用已取消').catch(() => {}); };
            signal?.throwIfAborted(); signal?.addEventListener('abort', stop, { once: true });
            try { return await work(); } finally { signal?.removeEventListener('abort', stop); }
          };
          const result = await runValidation({ ...options, image: { type: 'image', data: fresh.bytes.toString('base64'), mimeType: fresh.image.mimeType },
            onEvent: event => { if (event.turn) turn = event.turn; options.onEvent(event); },
            verifiedTools: { goal: goal.successCondition, allow: name => supervisor.allow(name),
              move: (args, signal, id) => withSignal(signal, id, () => supervisor.move(args, signal, id)),
              wait: (args, signal, id) => withSignal(signal, id, () => supervisor.wait(args, signal, id)),
            },
          });
          return supervisor.finalize(result);
        }
        return runValidation({ ...options, image: { type: 'image', data: fresh.bytes.toString('base64'), mimeType: fresh.image.mimeType },
          movement: async (args, toolSignal) => {
            const stop = () => { void inputController.stop('工具调用已取消').catch(() => {}); };
            toolSignal?.throwIfAborted(); toolSignal?.addEventListener('abort', stop, { once: true });
            try { return await execute({ skill: 'move_for', ...args, strength: 0.5 }); }
            finally { toolSignal?.removeEventListener('abort', stop); }
          },
        });
      }, interrupt, (type, text, result) => options.onEvent({ sequence: 0, timestamp: Date.now(), type, text, result, simulated: false })); }
    catch (error) {
      if (!approachRunner || !experiment) throw error;
      result = { status: options.signal.aborted ? 'canceled' : 'failed', simulated: false, gameOutcome: 'unverified', turns: 0, completedTools: 0, toolErrors: 0, finalText: '', error: error instanceof Error ? error.message : '输入控制失败' } as RunSummary;
    }
    return approachRunner && experiment ? approachRunner.finish(result, experiment.strategy, inputController.state.neutral === true) : result;
  };
  return { runner, metrics: goal && !experiment ? () => ({ moves: budget.moves, waits: budget.waits, observations: budget.observations, verifierCalls: budget.verifierCalls }) : undefined };
}

