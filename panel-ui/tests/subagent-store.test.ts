//! 子代理任务投影：行为与迁移前的壳内实现逐条等价。
//!
//! 迁移背景：这些断言原本写在 Panel 壳的 `state.tasks` 上。任务投影搬进模块
//! 后，**同一批不变量**必须继续被守住——作用域隔离（core / team）、收尾配对、
//! 取消、上游回收、容量上限。测试对象换成模块自己的 store，判据一条没少。

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TASK_CAP,
  cancelSessionWork,
  completeSubagent,
  dropCore,
  isSessionBusy,
  reset,
  startSubagent,
  tasks,
  tasksFor,
} from '../subagent-store';

beforeEach(() => {
  reset();
});

describe('子代理任务投影', () => {
  it('派发即建一条 running 任务，objective 来自文案', () => {
    startSubagent('s1', null, '查一下 README');
    expect(tasks.value).toHaveLength(1);
    const task = tasks.value[0]!;
    expect(task.kind).toBe('subagent');
    expect(task.status).toBe('running');
    expect(task.objective).toBe('查一下 README');
    expect(task.branches[0]?.status).toBe('running');
  });

  it('完成事件把最近一条 running 收尾（成功 / 失败）', () => {
    startSubagent('s1', null, 'a');
    startSubagent('s1', null, 'b');
    completeSubagent('s1', null, true);
    expect(tasks.value[1]!.status).toBe('completed');
    expect(tasks.value[0]!.status).toBe('running');
    completeSubagent('s1', null, false);
    expect(tasks.value[0]!.status).toBe('failed');
  });

  it('跨 core 的完成事件不收尾他 core 的任务', () => {
    startSubagent('s1', 'core-a', 'a');
    completeSubagent('s1', 'core-b', true);
    expect(tasks.value[0]!.status).toBe('running');
  });

  it('team 有值时精确匹配（同名会话跨人格不互相收尾）', () => {
    startSubagent('s1', null, 'alix 的任务', 'alix');
    completeSubagent('s1', null, true, 'other');
    expect(tasks.value[0]!.status).toBe('running');
    completeSubagent('s1', null, true, 'alix');
    expect(tasks.value[0]!.status).toBe('completed');
  });

  it('取消把 running 任务与分支都标 cancelled（不动已完成项）', () => {
    startSubagent('s1', null, 'a');
    startSubagent('s2', null, 'b');
    completeSubagent('s2', null, true);
    cancelSessionWork(null, 's1');
    expect(tasks.value[0]!.status).toBe('cancelled');
    expect(tasks.value[0]!.branches[0]!.status).toBe('cancelled');
    expect(tasks.value[1]!.status).toBe('completed');
  });

  it('上游移除只清归属它的任务', () => {
    startSubagent('s1', 'core-a', 'a');
    startSubagent('s1', 'core-b', 'b');
    dropCore('core-a');
    expect(tasks.value).toHaveLength(1);
    expect(tasks.value[0]!.core).toBe('core-b');
  });

  it('容量上限：超出后丢最旧的', () => {
    for (let i = 0; i < TASK_CAP + 5; i += 1) startSubagent('s1', null, `t${i}`);
    expect(tasks.value).toHaveLength(TASK_CAP);
    expect(tasks.value[0]!.objective).toBe('t5');
  });

  it('isSessionBusy 支持按 kind 过滤（壳的 sessionBusy 钩子用它）', () => {
    startSubagent('s1', null, 'a');
    expect(isSessionBusy(null, 's1')).toBe(true);
    expect(isSessionBusy(null, 's1', 'reply')).toBe(false);
    expect(isSessionBusy(null, 's1', 'subagent')).toBe(true);
    expect(isSessionBusy(null, 's2')).toBe(false);
  });

  it('tasksFor 按会话 / 全局 / core 过滤', () => {
    startSubagent('s1', 'core-a', 'a');
    startSubagent('s2', 'core-a', 'b');
    startSubagent('s1', 'core-b', 'c');
    expect(tasksFor('core-a', 's1').map((t) => t.objective)).toEqual(['a']);
    expect(tasksFor('core-a', 'global').map((t) => t.objective)).toEqual(['a', 'b']);
    expect(tasksFor(null, 's1').map((t) => t.objective)).toEqual(['a', 'c']);
  });
});
