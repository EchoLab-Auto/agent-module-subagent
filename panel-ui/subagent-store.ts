//! 子代理任务在**面板扩展**里的投影。
//!
//! 这份状态原先住在 Panel 壳的 `AppState.tasks` 里（连同 `nextSubagentSeq`、
//! `state_domains/orchestration.ts` 的两个 helper、`TasksPanel.vue`）。按外壳
//! 边界，任务属于提供它的模块：壳只给 `acceptEvent` 钩子、几个通用查询钩子
//! （`sessionBusy` / `cancelSessionWork` / `onCoreRemoved`）和入口插槽。
//!
//! ## 数据来源
//!
//! | 事件 | 作用 |
//! |---|---|
//! | `SubagentStarted` | 建一条 running 任务（objective = 派发文案） |
//! | `SubagentCompleted` | 把最近一条 running 收尾成 completed / failed |
//!
//! 任务列表**有上限**（[`TASK_CAP`]）：这是给人看的活动流，不是账本。

import { ref } from 'vue';
import { state } from '@echo-agent/panel';

/** 任务上限（壳里曾是 128，迁移时原样保留）。 */
export const TASK_CAP = 128;

export type OrchKind = 'subagent' | 'reply';
export type OrchStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type BranchStatus = 'running' | 'succeeded' | 'completed' | 'failed' | 'cancelled';

export interface BranchActivity {
  branchId: string;
  task: string;
  target: string;
  status: BranchStatus;
  startedAtMs: number;
  completedAtMs: number | null;
  result: string | null;
}

export interface OrchActivity {
  id: string;
  sequence: number | null;
  sessionId: string;
  /** 归属上游 core（多上游聚合；null = 单上游/未标注）。 */
  core?: string | null;
  /** 归属人格（同名会话跨人格不互相收尾/串显）。 */
  teamId?: string | null;
  kind: OrchKind;
  objective: string;
  status: OrchStatus;
  createdAtMs: number;
  completedAtMs: number | null;
  branches: BranchActivity[];
}

/** 任务列表（模块私有投影）。 */
export const tasks = ref<OrchActivity[]>([]);

let nextSeq = 0;

function push(task: OrchActivity): void {
  const next = [...tasks.value, task];
  tasks.value = next.length > TASK_CAP ? next.slice(next.length - TASK_CAP) : next;
}

/** 派发了一次子代理。`task` 是模型给出的目标文案。 */
export function startSubagent(
  sessionId: string,
  core: string | null,
  task: string,
  teamId: string | null = null,
): void {
  nextSeq += 1;
  const now = Date.now();
  push({
    id: `subagent-${nextSeq}`,
    sequence: null,
    sessionId,
    core,
    teamId,
    kind: 'subagent',
    objective: task,
    status: 'running',
    createdAtMs: now,
    completedAtMs: null,
    branches: [
      {
        branchId: 'subagent',
        task,
        target: '父 Agent',
        status: 'running',
        startedAtMs: now,
        completedAtMs: null,
        result: null,
      },
    ],
  });
}

/** 子代理结束：把**最近一条**匹配的 running 任务收尾。 */
export function completeSubagent(
  sessionId: string,
  core: string | null,
  success: boolean,
  teamId: string | null = null,
): void {
  const list = [...tasks.value];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const task = list[i]!;
    if (
      task.sessionId === sessionId &&
      (task.core ?? null) === core &&
      // team 有值时精确匹配：同一 core 内多个人格都可能有同名会话，只按 core
      // 匹配会把 A 人格的任务收尾成 B 人格的。
      (teamId == null || (task.teamId ?? null) === teamId) &&
      task.kind === 'subagent' &&
      task.status === 'running'
    ) {
      const completedAtMs = Date.now();
      list[i] = {
        ...task,
        status: success ? 'completed' : 'failed',
        completedAtMs,
        branches: task.branches.map((branch) =>
          branch.branchId === 'subagent'
            ? { ...branch, status: success ? 'succeeded' : 'failed', completedAtMs }
            : branch,
        ),
      };
      tasks.value = list;
      return;
    }
  }
}

/** 用户取消该会话的工作：把 running 任务与分支标成 cancelled。 */
export function cancelSessionWork(core: string | null, sessionId: string): void {
  const now = Date.now();
  tasks.value = tasks.value.map((task) =>
    task.sessionId === sessionId && (task.core ?? null) === core && task.status === 'running'
      ? {
          ...task,
          status: 'cancelled',
          completedAtMs: now,
          branches: task.branches.map((branch) =>
            branch.status === 'running'
              ? { ...branch, status: 'cancelled', completedAtMs: now }
              : branch,
          ),
        }
      : task,
  );
}

/** 上游 core 被移除：清掉归属它的任务。 */
export function dropCore(core: string): void {
  tasks.value = tasks.value.filter((task) => (task.core ?? null) !== core);
}

/** 重连（Core 可能已重启）：运行期任务全部作废。 */
export function reset(): void {
  tasks.value = [];
}

/** 某会话是否有 running 任务（`kind` 可选过滤）——壳的 `sessionBusy` 用它。 */
export function isSessionBusy(
  core: string | null,
  sessionId: string,
  kind?: string,
): boolean {
  return tasks.value.some(
    (task) =>
      task.sessionId === sessionId &&
      (core == null || (task.core ?? null) === core) &&
      task.status === 'running' &&
      (kind === undefined || task.kind === kind),
  );
}

/** 某作用域下的任务（面板与徽标用）。 */
export function tasksFor(core: string | null, sessionId: string | null): OrchActivity[] {
  const inCore = (task: OrchActivity) => core == null || (task.core ?? null) === core;
  return sessionId && sessionId !== 'global'
    ? tasks.value.filter((task) => task.sessionId === sessionId && inCore(task))
    : tasks.value.filter(inCore);
}

/** 当前人格是否允许用委派工具（决定入口显隐；与模块挂载判据配合）。 */
export function delegationAllowed(
  team: { available_modules?: string[]; enabled_modules?: string[]; available_tools?: string[]; disabled_tools?: string[]; enabled_tools?: string[] } | null | undefined,
  moduleId: string,
  toolName: string,
): boolean {
  if (!team) return true;
  const modules = team.available_modules;
  const moduleOk =
    modules === undefined
      ? !team.enabled_modules?.length || team.enabled_modules.includes(moduleId)
      : modules.length === 0 || modules.includes(moduleId);
  if (!moduleOk) return false;
  if (team.disabled_tools?.includes(toolName)) return false;
  const tools = team.available_tools;
  if (tools === undefined) {
    return !team.enabled_tools?.length || team.enabled_tools.includes(toolName);
  }
  return tools.length === 0 || tools.includes(toolName);
}

/** 消费一帧事件（`acceptEvent` 的实现体）。返回 true = 已消费。 */
export function consumeEvent(event: unknown): boolean {
  const frame = event as Record<string, unknown>;
  const started = frame.SubagentStarted as
    | { session_id: string; task: string; team_id?: string | null; core?: string | null }
    | undefined;
  if (started) {
    startSubagent(started.session_id, started.core ?? null, started.task, started.team_id ?? null);
    return true;
  }
  const completed = frame.SubagentCompleted as
    | { session_id: string; success: boolean; team_id?: string | null; core?: string | null }
    | undefined;
  if (completed) {
    completeSubagent(
      completed.session_id,
      completed.core ?? null,
      completed.success,
      completed.team_id ?? null,
    );
    return true;
  }
  return false;
}

/** 供组件判断"当前是否还有 running 任务"（每秒刷新耗时用）。 */
export function hasRunning(core: string | null, sessionId: string | null): boolean {
  return tasksFor(core, sessionId).some((task) => task.status === 'running');
}

/** 兼容壳的旧签名：读当前 activeTeamId（供 `cancelSessionWork` 之外的场景）。 */
export function currentTeamId(): string | null {
  return state.activeTeamId ?? null;
}
