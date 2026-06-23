// ============================================================
// Session message projection cache — 投影记忆化协作类
// 负责：按 raw branch 数组的引用稳定性缓存 ScoutMessage 投影结果，
// 以及在 AgentSession 生命周期切换时显式失效。
// ============================================================

import type { ScoutMessage } from '@scout-agent/shared';
import type { SessionTreeEntry } from '../../core/session/index.ts';
import { projectSessionBranchToScoutMessages } from './session-message-projector.ts';

// ---------- 不变量 ----------
//
// 命中条件：cache.branch === currentBranch（引用相等）。
//
// 上游契约（由 AgentSession.cachedBranch + SessionManager.getBranch 共同维持）：
//   1) branch 内容变化时，引用必须整体替换为新数组。
//   2) 引用未变时，branch 内容不可被原地 mutate。
// 只要不变量成立，引用相等 ⇒ 内容相等 ⇒ 投影结果可复用。

/**
 * 稳定的空 branch 投影结果。
 * 当 AgentSession 缺席（启动/切换/销毁中间态）时，project() 始终返回这个引用，
 * 避免每次调用都新建空数组导致 cache miss + 多余写入。
 */
const EMPTY_PROJECTION: readonly ScoutMessage[] = Object.freeze([]);

interface ProjectionEntry {
  readonly branch: readonly SessionTreeEntry[];
  readonly messages: ScoutMessage[];
}

export class SessionMessageProjectionCache {
  private entry?: ProjectionEntry;

  /**
   * 按 branch 引用查询投影；命中则返回缓存结果，未命中则重算并缓存。
   * branch 为 undefined（session 未就绪）时返回稳定的空数组。
   */
  project(branch: readonly SessionTreeEntry[] | undefined): ScoutMessage[] {
    if (!branch) return EMPTY_PROJECTION as ScoutMessage[];
    if (this.entry?.branch === branch) return this.entry.messages;
    const messages = projectSessionBranchToScoutMessages(branch);
    this.entry = { branch, messages };
    return messages;
  }

  /**
   * 显式失效。应在 AgentSession 切换、解绑、coordinator dispose 时调用，
   * 让上一会话的 branch 引用不再被 cache 持有，便于即时 GC。
   */
  invalidate(): void {
    this.entry = undefined;
  }
}
