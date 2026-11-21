//! 子代理模块的 Panel UI 扩展入口。
//!
//! ## 边界
//!
//! 面板壳只提供**插槽与机制**：入口按钮位（含徽标）、覆盖层外壳、事件钩子、
//! 几个通用查询钩子（`sessionBusy` / `cancelSessionWork` / `onCoreRemoved` /
//! `toolPresentation`）。壳不知道"子代理"是什么，也没有任务字段。
//!
//! 本文件把子代理接到这些点上：
//!
//! | 壳能力 | 子代理怎么用 |
//! |---|---|
//! | `entries` | 入口行「任务」按钮；`when` = 模块挂载 + 人格允许用委派工具，或本地已有任务 |
//! | `entries[].badge` | 徽标 = 当前会话运行中任务数 |
//! | `overlays` | 点开后的「任务与分支」面板（本模块的组件） |
//! | `acceptEvent` | 归约 `SubagentStarted` / `SubagentCompleted`（**放行**给壳：壳还要用它们更新活动相位） |
//! | `sessionBusy` | 壳在回合收尾时问"这个会话还有事在做吗" |
//! | `cancelSessionWork` | 用户取消：把 running 任务标 cancelled |
//! | `onCoreRemoved` | 上游移除：清掉归属它的任务 |
//! | `toolPresentation` | 告诉壳"这次工具调用在派子代理"，以及它的目标文案 |
//!
//! 数据来自 Core 的两个通用事件（`SubagentStarted` / `SubagentCompleted`），
//! 不是某个模块专用协议——壳照样不认识它们的语义。

import { watch } from 'vue';
import {
  currentTeam,
  definePanelExtension,
  registerPanelExtension,
  state,
  teamModuleEnabled,
  teamToolAvailable,
} from '@echo-agent/panel';
import TasksPanel from './components/TasksPanel.vue';
import {
  cancelSessionWork as cancelTasks,
  consumeEvent,
  delegationAllowed,
  dropCore,
  hasRunning,
  isSessionBusy,
  reset,
  tasks,
  tasksFor,
} from './subagent-store';

/** 模块 id（与 `crates/agent-module-subagent/src/lib.rs::MODULE_ID` 同值）。 */
export const MODULE_ID = 'echo-agent.subagent';
/** 委派工具名（与 `SPAWN_SUBAGENT_TOOL` 同值）。 */
export const SPAWN_SUBAGENT_TOOL = 'spawn_subagent';

/** 当前人格是否允许委派。 */
function allowed(teamId: string | null): boolean {
  const team =
    teamId === null ? currentTeam(state) : state.teams.find((item) => item.id === teamId) ?? null;
  if (!team) return false;
  return (
    teamModuleEnabled(team, MODULE_ID) && teamToolAvailable(team, SPAWN_SUBAGENT_TOOL)
  );
}

/** 入口显隐：人格允许委派，或本地已有任务记录（模块后被禁用时仍可回看）。 */
function entryVisible(teamId: string | null): boolean {
  if (allowed(teamId) && delegationAllowed(currentTeam(state), MODULE_ID, SPAWN_SUBAGENT_TOOL)) {
    return true;
  }
  return tasksFor(state.activeRegion ?? null, null).length > 0;
}

registerPanelExtension(
  definePanelExtension({
    id: MODULE_ID,
    hooks: {
      /** 归约本模块关心的两帧；**返回 true**——壳还要用它们更新活动相位。 */
      acceptEvent(event) {
        consumeEvent(event);
        return true;
      },
      /** 壳用它决定回合收尾（不传 kind = "还有事在做吗"）。 */
      sessionBusy(core, sessionId, kind) {
        // 壳的 core 判定含"null = 单上游/未标注"，store 里同一口径。
        return isSessionBusy(core, sessionId, kind);
      },
      /** 用户取消：本模块的投影就地标 cancelled（Core 侧另由命令停止）。 */
      cancelSessionWork(core, sessionId) {
        cancelTasks(core, sessionId);
      },
      onCoreRemoved(core) {
        dropCore(core);
      },
      /** 工具行呈现：壳不再按工具名匹配（历史上 `run_subagent` 分叉出过事故）。 */
      toolPresentation(tool) {
        if (tool.name !== SPAWN_SUBAGENT_TOOL) return null;
        // `icon` 用壳的封闭词汇（`ToolIcon.vue` 的 IconKind）：本模块不必自带
        // 一套 SVG，壳也不必认识 `spawn_subagent` 这个名字。
        return { phase: 'subagent', label: objectiveOf(tool.input), icon: 'subagent' };
      },
      setup(context) {
        // 重连（Core 可能已重启）：运行期任务全部作废。
        watch(
          () => state.connected,
          (connected, previous) => {
            if (connected && previous === false) reset();
          },
        );
        // 任务变化后重算入口徽标（`panelEntryActions` 读的是注册表，
        // 徽标由 `badge` 现算，这里只需让消费方重渲染）。
        watch(tasks, () => {
          void context.sessionId.value;
        });
      },
    },
    entries: [
      {
        id: 'tasks',
        label: '任务',
        icon: 'split',
        title: '任务与分支',
        when: (context) => entryVisible(context.teamId),
        badge: (context) =>
          tasksFor(context.core, context.sessionId).filter((task) => task.status === 'running').length,
      },
    ],
    overlays: [{ id: 'tasks', label: '任务与分支', component: TasksPanel }],
  }),
);

/** 从工具入参里取派发目标文案（`{"task": "..."}`，容错解析）。 */
function objectiveOf(input: string | undefined): string | undefined {
  if (!input) return undefined;
  try {
    const parsed = JSON.parse(input) as { task?: unknown };
    if (typeof parsed.task !== 'string') return undefined;
    const oneLine = parsed.task.replace(/\s+/g, ' ').trim();
    return oneLine.length > 72 ? `${oneLine.slice(0, 71)}…` : oneLine;
  } catch {
    return undefined;
  }
}

// 供测试与调试：暴露"该会话是否还有 running 任务"。
export { hasRunning };
