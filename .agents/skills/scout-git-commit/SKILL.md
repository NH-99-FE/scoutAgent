---
name: scout-git-commit
description: Review, stage, validate, and create Git commits for the Scout Agent repository. Use when the user asks Codex to commit changes, prepare a commit, choose a commit message, inspect staged/unstaged changes before committing, or follow Scout/Pi-aligned repository commit conventions with commitlint, cz-git, husky, and lint-staged.
---

# Scout Git Commit

Use this skill to create repository-quality commits for `F:\myAgent\scout` and related Scout worktrees.

## Core Workflow

1. Inspect the working tree before touching it:
   - Run `git status --short`.
   - Run `git diff --stat`, `git diff`, and `git diff --staged` as needed.
   - Identify user changes already present. Never revert or overwrite unrelated user work.
2. Read repository commit configuration when it may have changed:
   - `commitlint.config.js` defines allowed commit types and cz-git prompts.
   - `package.json` defines `pnpm commit`, `lint-staged`, and validation scripts.
   - `AGENTS.md` defines Scout/Pi development and test expectations.
3. Decide whether a commit is appropriate:
   - Commit only the changes that belong to the requested task.
   - If unrelated changes exist, stage explicit paths only.
   - If staged changes already exist and may be user-staged, inspect them and preserve intent.
4. Validate before committing:
   - Prefer targeted tests/checks based on changed packages.
   - For broad or cross-layer changes, run `pnpm test` and/or `pnpm lint` when feasible.
   - For package-specific work, use that package's scripts from its `package.json`.
   - If checks are skipped or fail, say why before committing; do not hide failures.
5. Stage deliberately:
   - Use explicit `git add -- <paths>` for task-owned files.
   - Avoid `git add .` unless the user explicitly wants every current change included.
   - In Codex managed environments, request escalation for `git add` because it writes the Git index.
6. Commit with a Scout-style message:
   - Prefer direct `git commit -m "<subject>"` for non-interactive execution.
   - When the commit touches many code files or spans multiple concepts, include a body with additional `-m` arguments.
   - `pnpm commit` is available for interactive cz-git flows, but direct commits are better for agents.
   - In Codex managed environments, request escalation for `git commit` because it writes refs and may run hooks.
7. Report the result:
   - 用中文汇报提交结果；包含 commit hash、message、已运行的验证命令和剩余 working-tree 状态。
   - If using the Codex desktop app, emit the required git directives after successful stage/commit.

## Message Convention

Use Conventional Commits with the repository's cz-git emoji convention:

```text
type(scope): :emoji: concise subject
```

Examples from this repository:

```text
feat(webview): :sparkles: tree page style adjustments
fix(webview): :bug: handle focus display issue
refactor(agent): :recycle: align session context rebuild
test(extension): :white_check_mark: cover retry recovery
docs: :memo: update development notes
```

Allowed types and preferred emoji aliases:

```text
feat: :sparkles:
fix: :bug:
docs: :memo:
style: :lipstick:
refactor: :recycle:
perf: :rocket:
test: :white_check_mark:
build: :hammer_and_wrench:
ci: :ferris_wheel:
chore: :hammer:
revert: :rewind:
```

Choose scope from the primary package or layer when clear:

```text
shared
ai
agent
extension
host
webview
docs
build
```

Use a narrower scope when it better matches local history, such as `tree`, `session`, `provider`, or `harness`. Omit the scope only when the change is truly repo-wide.

Keep the subject concise and imperative. 默认使用中文填写提交 subject；保留 Conventional Commit 的 type/scope/emoji 英文结构。只有用户明确要求、仓库近期历史明显使用英文，或英文更能避免歧义时，才使用英文 subject。

## Commit Body

Add a detailed body when the staged change is more than a small, obvious edit. This is expected when many code files are included, when implementation and tests are both substantial, or when the change affects multiple behaviors.

Use the body to summarize what changed, why it changed, and any validation that matters. 默认使用中文填写 body：

```text
git commit -m "feat(webview): :sparkles: 优化会话树折叠与搜索体验" `
  -m "重绘会话树分支连线与折叠锚点高亮。" `
  -m "增加搜索防抖、折叠状态重置和对应 tree 回归测试。"
```

For the interactive `pnpm commit` / cz-git prompt, the body field is `填写更加详细的变更描述（可选）。使用 "|" 换行:`. Enter each body paragraph separated by `|`, for example:

```text
重绘会话树分支连线与折叠锚点高亮。|增加搜索防抖、折叠状态重置和对应 tree 回归测试。
```

Do not pad trivial commits with a body. Prefer a body over an overlong subject.

## Validation Heuristics

Map changed paths to likely checks:

```text
packages/shared       pnpm test or targeted shared tests
packages/ai           pnpm -C packages/ai test
packages/agent        pnpm test with targeted agent tests when available
packages/extension    package scripts such as check-types/package when present
packages/webview      pnpm -C packages/webview test
root config           pnpm lint and/or pnpm test when feasible
docs only             usually no tests; run formatting only if touched by hooks
```

Let risk set the validation depth. Cross-layer session/runtime/compaction/tree protocol work needs regression tests. Narrow docs or metadata commits may only need status and formatting awareness.

## Safety Rules

- Never use destructive commands such as `git reset --hard` or `git checkout --` unless the user explicitly asks.
- Do not amend, squash, rebase, push, or create branches unless requested.
- Do not include secrets from `.env` or local config files.
- If hooks modify files during commit, inspect `git status --short` afterward and explain any remaining changes.
- If the commit fails because hooks changed files, re-stage only task-owned hook changes and retry once.

