export default {
  extends: ['@commitlint/config-conventional'],
  prompt: {
    messages: {
      type: '选择你要提交的类型:',
      scope: '选择一个提交范围（可选）:',
      customScope: '请输入自定义的提交范围:',
      subject: '填写简短精炼的变更描述:\n',
      body: '填写更加详细的变更描述（可选）。使用 "|" 换行:\n',
      breaking: '列举非兼容性重大的变更（可选）。使用 "|" 换行:\n',
      footerPrefixsSelect: '选择关联issue前缀（可选）:',
      customFooterPrefixs: '输入关联issue前缀:',
      confirmCommit: '是否提交或修改commit?',
      min: '至少 %d 个字符',
      emptyWarning: '不能为空',
      upperLimitWarning: '超出长度限制',
      lowerLimitWarning: '低于最小长度',
    },
    types: [
      { value: 'feat', name: 'feat:     ✨  新功能', emoji: ':sparkles:' },
      { value: 'fix', name: 'fix:      🐛  修复问题', emoji: ':bug:' },
      { value: 'docs', name: 'docs:     📝  文档变更', emoji: ':memo:' },
      { value: 'style', name: 'style:    💄  代码格式调整', emoji: ':lipstick:' },
      { value: 'refactor', name: 'refactor: ♻️   代码重构（非修复/新增）', emoji: ':recycle:' },
      { value: 'perf', name: 'perf:     🚀  性能优化', emoji: ':rocket:' },
      { value: 'test', name: 'test:     ✅  测试相关变更', emoji: ':white_check_mark:' },
      { value: 'build', name: 'build:    🛠  构建系统或依赖变更', emoji: ':hammer_and_wrench:' },
      { value: 'ci', name: 'ci:       🎡  CI 配置或脚本变更', emoji: ':ferris_wheel:' },
      { value: 'chore', name: 'chore:    🔨  杂项变更（不影响代码）', emoji: ':hammer:' },
      { value: 'revert', name: 'revert:   ⏪️  回退代码', emoji: ':rewind:' },
    ],
    useEmoji: true,
    confirmColorize: true,
    emojiAlign: 'center',
    scopes: [],
    allowCustomScopes: true,
    allowEmptyScopes: true,
    customScopesAlign: 'bottom',
    customScopesAlias: '自定义',
    emptyScopesAlias: '跳过',
    upperCaseSubject: false,
    allowBreakingChanges: ['feat', 'fix'],
    questions: {
      scope: {
        description: '请选择本次变更范围（如模块名、文件夹名）',
      },
      subject: {
        description: '请填写简短描述（建议祈使句）',
      },
      body: {
        description: '请填写详细描述（可选）',
      },
      isBreaking: {
        description: '是否包含破坏性变更？',
      },
      breakingBody: {
        description: '破坏性变更需补充说明，请填写详细描述',
      },
      breaking: {
        description: '请描述破坏性变更内容',
      },
      isIssueAffected: {
        description: '是否关联 Issue？',
      },
      issuesBody: {
        description: '若要关闭 Issue，请补充详细说明',
      },
      issues: {
        description: '请填写 Issue 引用（例如: "fix #123", "re #123"）',
      },
    },
  },
};
