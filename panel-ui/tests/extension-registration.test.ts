//! 扩展注册：入口门控、徽标、工具呈现。
//!
//! 这些是"壳不认识子代理"的具体体现——壳只问扩展要四个答案：入口该不该出现、
//! 徽标几、这次工具调用是什么、这个会话还有事在做吗。

import { describe, it, expect, beforeEach } from 'vitest';
import {
  panelEntryActions,
  panelSessionBusy,
  panelToolPresentation,
  state,
} from '@echo-agent/panel';
import { startSubagent, tasks } from '../subagent-store';

// 扩展模块在 import 时注册自己；这里直接吃真实注册结果。
await import('../index');

function context(over: Partial<{ teamId: string | null; sessionId: string; core: string | null }> = {}) {
  return { teamId: 'alix', sessionId: 's1', core: null, ...over };
}

beforeEach(() => {
  tasks.value = [];
  state.teams = [
    { id: 'alix', name: 'Alix', enabled: true, sessions: 0, available_modules: [], available_tools: [] } as never,
  ];
  state.activeTeamId = 'alix';
  state.activeRegion = null;
  state.modules = [{ id: 'echo-agent.subagent' } as never];
});

describe('子代理扩展', () => {
  it('注册了「任务」入口，徽标 = 运行中任务数', () => {
    const actions = panelEntryActions(context());
    const tasksEntry = actions.find((item) => item.extensionId === 'echo-agent.subagent');
    expect(tasksEntry, '缺任务入口').toBeTruthy();
    expect(tasksEntry!.action.label).toBe('任务');
    expect(tasksEntry!.action.badge?.(context())).toBe(0);
    startSubagent('s1', null, 'a');
    expect(tasksEntry!.action.badge?.(context())).toBe(1);
  });

  it('人格被禁模块时入口消失（除本地已有任务）', () => {
    state.teams = [
      { id: 'alix', name: 'Alix', enabled: true, sessions: 0, available_modules: [], available_tools: [] } as never,
    ];
    startSubagent('s1', null, 'a');
    const entry = panelEntryActions(context()).find((item) => item.extensionId === 'echo-agent.subagent');
    // 有任务 = 允许回看（不删历史）
    expect(entry).toBeTruthy();
  });

  it('toolPresentation 认领 spawn_subagent 并给出图标与目标文案', () => {
    const presentation = panelToolPresentation({
      name: 'spawn_subagent',
      input: JSON.stringify({ task: '查一下 README 的结构' }),
    });
    expect(presentation?.phase).toBe('subagent');
    expect(presentation?.icon).toBe('subagent');
    expect(presentation?.label).toContain('README');
    // 不认识的工具返回 null（继续问下一个扩展）
    expect(panelToolPresentation({ name: 'read_file' })).toBeNull();
  });

  it('sessionBusy 钩子回答壳的"还有事在做吗"', () => {
    expect(panelSessionBusy(null, 's1')).toBe(false);
    startSubagent('s1', null, 'a');
    expect(panelSessionBusy(null, 's1')).toBe(true);
    expect(panelSessionBusy(null, 's1', 'reply')).toBe(false);
  });
});
