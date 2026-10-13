// Presets only fill the composer. They never start a task or relax host safety budgets.
export const acceptanceCases = [
  { id: 'hud', label: '只读正例 · 生命值',
    prompt: '不要移动，只调用一次 wait_for_state，等待预算 10000ms，检查固定成功条件，然后总结验证结果。',
    condition: '游戏画面左上角清晰可见红色生命值心形图标。',
    note: '先进入生命值 HUD 可见的场景。人工核对心形图标；预期 passed，移动次数为 0。' },
  { id: 'move', label: '移动后验证 · 安全平地',
    prompt: '先观察画面。仅在安全可移动的场景调用一次 move_for，direction=forward，durationMs=500；否则报告受阻。根据动作后的独立验证总结，不再追加移动，不按时长推算距离。',
    condition: '',
    note: '仅在无悬崖、敌人或菜单的安全场景测试。必须自行填写真实地标和可见的前后变化判据；不要填米数。预期一次移动后有新帧和独立验证。' },
  { id: 'negative', label: '只读负例 · 不存在的文字',
    prompt: '不要移动，只调用一次 wait_for_state，等待预算 10000ms，检查固定成功条件。未满足应如实报告受阻，不要把工具执行完成当作目标完成。',
    condition: '当前游戏画面清晰显示完整文字「GAMEPILOT_TEST_TARGET_7F3A」。',
    note: '先确认画面没有这段完整文字。预期 failed/受阻；超时或无法判断不是负例验证通过，需要保留并重测。' },
  { id: 'unknown', label: '只读无法判断 · 不可见距离',
    prompt: '不要移动，只调用一次 wait_for_state，等待预算 10000ms，检查固定成功条件。截图不足以证明时必须返回无法判断，不得猜测精确距离。',
    condition: '仅凭这两张游戏截图确认角色与正前方最近石柱的世界坐标距离恰好为 3.000 米。',
    note: '使用没有世界坐标/精确距离读数的场景。预期 inconclusive/受阻；不能用模型自信程度替代证据。' },
  { id: 'cancel', label: '验证期间 F8 · 零移动',
    prompt: '不要移动，只调用一次 wait_for_state，等待预算 10000ms，检查固定成功条件，然后总结验证结果。',
    condition: '游戏画面左上角清晰可见红色生命值心形图标。',
    note: '运行后保持 Cemu 前台，在右侧出现“独立验证”阶段时按 F8。预期 canceled、最终归零、非 passed；若模型先结束需重测。' },
] as const;
export type AcceptanceCaseId = typeof acceptanceCases[number]['id'];
