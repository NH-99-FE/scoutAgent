// ============================================================
// Skills Tab — Skills 路径与解析结果管理
// ============================================================

import { AlertTriangle, Folder, Plus, Trash2 } from 'lucide-react';
import type {
  ScoutDiagnostic,
  ScoutDiagnosticType,
  ScoutSkillListItem,
  ScoutSkillScope,
  ScoutSkillSourceKind,
  ScoutSkillStatus,
} from '@scout-agent/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { SkillSettingsController } from '../hooks/skill-settings-state';

const SCOPE_LABELS: Record<ScoutSkillScope, string> = {
  project: '当前项目',
  global: '全局',
};

const DIAGNOSTIC_TYPE_LABELS: Record<ScoutDiagnosticType, string> = {
  info: '信息',
  warning: '警告',
  error: '错误',
  collision: '冲突',
};

const SOURCE_KIND_LABELS: Record<ScoutSkillSourceKind, string> = {
  project_default: '项目默认',
  global_default: '全局默认',
  agents_compat: '兼容目录',
  configured: '额外路径',
  package: 'Package',
  temporary: '临时',
};

const SOURCE_KIND_ORDER: Record<ScoutSkillSourceKind, number> = {
  project_default: 0,
  configured: 1,
  global_default: 2,
  agents_compat: 3,
  package: 4,
  temporary: 5,
};

const SKILL_STATUS_LABELS: Partial<Record<ScoutSkillStatus, string>> = {
  disabled: '禁用',
  missing: '缺失',
};

export function SkillsTab({ controller }: { controller: SkillSettingsController }) {
  const disabled = controller.isLoading || controller.isSaving;

  return (
    <div className="mx-auto box-border flex w-full max-w-6xl min-w-0 flex-col gap-5 overflow-x-hidden px-8 py-5 pr-10 max-[720px]:px-5 max-[720px]:pr-7">
      {controller.error ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
          {controller.error}
        </div>
      ) : null}

      <section className="border-border/70 bg-background/40 min-w-0 overflow-hidden rounded-lg border">
        <div className="border-border/70 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="grid gap-0.5">
            <h2 className="text-base font-semibold">额外 Skills 路径</h2>
            <p className="text-muted-foreground text-xs">
              {getScopeSettingsLabel(controller.draft.scope)}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <ScopeSelect
              value={controller.draft.scope}
              disabled={disabled}
              onChange={controller.setScope}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={controller.addEntry}
            >
              <Plus />
              添加路径
            </Button>
          </div>
        </div>
        <SkillEntryEditor
          entries={controller.currentEntries}
          disabled={disabled}
          onUpdate={controller.updateEntry}
          onRemove={controller.removeEntry}
        />
      </section>

      <section className="border-border/70 bg-background/40 min-w-0 overflow-hidden rounded-lg border p-4">
        <div className="grid gap-0.5">
          <h2 className="text-base font-semibold">自动扫描目录</h2>
          <p className="text-muted-foreground text-xs">无需添加路径，目录存在时会参与解析</p>
        </div>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 text-sm max-[840px]:grid-cols-1">
          <PathRow label="项目默认" path={controller.draft.settings.projectDir} />
          <PathRow label="全局默认" path={controller.draft.settings.globalDir} />
        </div>
        {controller.draft.settings.agentsDirs.length > 0 ? (
          <div className="mt-3 grid gap-2 text-sm">
            <span className="text-muted-foreground text-xs font-medium">
              已存在的 .agents 兼容目录
            </span>
            {controller.draft.settings.agentsDirs.map((path) => (
              <PathValue key={path} path={path} />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground mt-3 text-xs">
            当前没有已存在的 .agents/skills 兼容目录
          </p>
        )}
      </section>

      <section className="border-border/70 bg-background/40 min-w-0 overflow-hidden rounded-lg border">
        <div className="border-border/70 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="grid gap-0.5">
            <h2 className="text-base font-semibold">已解析 Skills</h2>
            <p className="text-muted-foreground text-xs">自动扫描目录与额外路径合并后的结果</p>
          </div>
          <span className="text-muted-foreground text-xs">
            {controller.draft.settings.skills.length}
          </span>
        </div>
        <SkillList
          skills={controller.draft.settings.skills}
          activeScope={controller.draft.scope}
          disabled={disabled}
          getSkillEnabled={controller.getSkillEnabled}
          onOpen={controller.openSkillFile}
          onToggleEnabled={controller.toggleSkillEnabled}
        />
      </section>

      {controller.draft.settings.diagnostics.length > 0 ? (
        <section className="border-border/70 bg-background/40 min-w-0 overflow-hidden rounded-lg border">
          <div className="border-border/70 border-b px-4 py-3">
            <h2 className="text-base font-semibold">诊断</h2>
          </div>
          <DiagnosticList diagnostics={controller.draft.settings.diagnostics} />
        </section>
      ) : null}
    </div>
  );
}

function SkillEntryEditor({
  entries,
  disabled,
  onUpdate,
  onRemove,
}: {
  entries: string[];
  disabled: boolean;
  onUpdate: (index: number, value: string) => void;
  onRemove: (index: number) => void;
}) {
  if (entries.length === 0) {
    return (
      <div className="border-border/70 text-muted-foreground m-4 rounded-lg border border-dashed px-4 py-8 text-center text-sm">
        当前未添加额外路径。自动扫描目录仍会参与解析。
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-2 p-4">
      {entries.map((entry, index) => (
        <div key={index} className="flex max-w-full min-w-0 items-center gap-2">
          <Input
            value={entry}
            disabled={disabled}
            aria-label={`Skill path ${index + 1}`}
            className="min-w-0 flex-1 font-mono text-xs"
            onChange={(event) => onUpdate(index, event.target.value)}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onRemove(index)}
          >
            <Trash2 />
            <span className="sr-only">删除路径</span>
          </Button>
        </div>
      ))}
    </div>
  );
}

function SkillList({
  skills,
  activeScope,
  disabled,
  getSkillEnabled,
  onOpen,
  onToggleEnabled,
}: {
  skills: ScoutSkillListItem[];
  activeScope: ScoutSkillScope;
  disabled: boolean;
  getSkillEnabled: (skill: ScoutSkillListItem) => boolean;
  onOpen: (path: string) => void;
  onToggleEnabled: (skill: ScoutSkillListItem, enabled: boolean) => void;
}) {
  if (skills.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-24 items-center px-4 py-6 text-sm">
        暂无已解析 Skill。可放到自动扫描目录，或添加额外路径。
      </div>
    );
  }

  const groups = groupSkillsBySource(skills);

  return (
    <div className="min-w-0">
      {groups.map((group, index) => (
        <section
          key={`${group.sourceKind}:${group.root}`}
          className={cn('min-w-0', index > 0 && 'border-border/60 border-t')}
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-2.5 pb-1.5">
            <span className="flex min-w-0 items-center gap-2">
              <Folder className="text-muted-foreground size-3.5 shrink-0" />
              <span className="text-foreground/80 min-w-0 truncate font-mono text-xs">
                {formatDisplayPath(group.root)}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {SOURCE_KIND_LABELS[group.sourceKind]}
              </span>
            </span>
            <span className="text-muted-foreground shrink-0 text-xs">{group.skills.length}</span>
          </div>
          <div className="min-w-0 pb-1">
            {group.skills.map((skill) => (
              <SkillListRow
                key={skill.path}
                skill={skill}
                activeScope={activeScope}
                disabled={disabled}
                checked={getSkillEnabled(skill)}
                onOpen={onOpen}
                onToggleEnabled={onToggleEnabled}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SkillListRow({
  skill,
  activeScope,
  disabled,
  checked,
  onOpen,
  onToggleEnabled,
}: {
  skill: ScoutSkillListItem;
  activeScope: ScoutSkillScope;
  disabled: boolean;
  checked: boolean;
  onOpen: (path: string) => void;
  onToggleEnabled: (skill: ScoutSkillListItem, enabled: boolean) => void;
}) {
  const canOpen = !disabled && skill.exists;
  const canToggle = !disabled && skill.exists && skill.canToggle && skill.scope === activeScope;

  return (
    <div
      className={cn(
        'hover:bg-muted/25 mx-2 flex w-[calc(100%-1rem)] min-w-0 items-center gap-3 overflow-hidden rounded-md px-2 py-2 text-sm transition-colors',
        !canOpen && 'text-muted-foreground',
      )}
    >
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => onOpen(skill.path)}
        className="disabled:text-muted-foreground grid min-w-0 flex-1 gap-0.5 overflow-hidden text-left disabled:cursor-not-allowed"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-0 truncate leading-5 font-medium">{skill.name}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <SkillStatusBadge skill={skill} />
            {skill.disableModelInvocation ? (
              <Badge title="不会自动注入模型上下文，仅可通过 slash 命令调用">手动</Badge>
            ) : null}
          </span>
        </span>
        <span
          className="text-muted-foreground block max-w-full min-w-0 truncate text-xs leading-4"
          title={skill.description || undefined}
        >
          {skill.description || '无描述'}
        </span>
      </button>
      <Switch
        aria-label={`启用 ${skill.name}`}
        checked={checked}
        disabled={!canToggle}
        size="sm"
        onCheckedChange={(checked) => onToggleEnabled(skill, checked)}
      />
    </div>
  );
}

function SkillStatusBadge({ skill }: { skill: ScoutSkillListItem }) {
  const label = SKILL_STATUS_LABELS[skill.status];
  if (!label) return null;
  return <Badge>{label}</Badge>;
}

function DiagnosticList({ diagnostics }: { diagnostics: ScoutDiagnostic[] }) {
  return (
    <div className="divide-border/70 divide-y">
      {diagnostics.map((diagnostic, index) => (
        <div
          key={`${diagnostic.path ?? diagnostic.message}:${index}`}
          className="grid min-w-0 gap-1 overflow-hidden px-4 py-2.5 text-sm"
        >
          <span className="flex min-w-0 items-center gap-2">
            <AlertTriangle
              className={cn(
                'size-3.5 shrink-0',
                diagnostic.type === 'error' ? 'text-destructive' : 'text-muted-foreground',
              )}
            />
            <span className="min-w-0 truncate font-medium">
              {formatDiagnosticMessage(diagnostic)}
            </span>
            <Badge>{DIAGNOSTIC_TYPE_LABELS[diagnostic.type]}</Badge>
          </span>
          {formatDiagnosticDetail(diagnostic) ? (
            <span
              className="text-muted-foreground ml-5 block min-w-0 truncate font-mono text-xs"
              title={formatDiagnosticDetail(diagnostic)}
            >
              {formatDiagnosticDetail(diagnostic)}
            </span>
          ) : diagnostic.path ? (
            <span
              className="text-muted-foreground ml-5 block min-w-0 truncate font-mono text-xs"
              title={diagnostic.path}
            >
              {formatDisplayPath(diagnostic.path)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Badge({ children, title }: { children: string; title?: string }) {
  return (
    <span
      className="border-border text-muted-foreground inline-flex h-5 shrink-0 items-center justify-center rounded-full border px-1.5 text-xs leading-none"
      title={title}
    >
      {children}
    </span>
  );
}

function ScopeSelect({
  value,
  disabled,
  onChange,
}: {
  value: ScoutSkillScope;
  disabled: boolean;
  onChange: (scope: ScoutSkillScope) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-muted-foreground shrink-0 text-xs font-medium">保存位置</span>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(nextValue) => onChange(nextValue as ScoutSkillScope)}
      >
        <SelectTrigger aria-label="保存位置" className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectViewport>
            {(['project', 'global'] as const).map((scope) => (
              <SelectItem key={scope} value={scope}>
                {SCOPE_LABELS[scope]}
              </SelectItem>
            ))}
          </SelectViewport>
        </SelectContent>
      </Select>
    </div>
  );
}

function getScopeSettingsLabel(scope: ScoutSkillScope): string {
  return scope === 'project' ? '保存到当前项目 settings.skills' : '保存到全局 settings.skills';
}

function PathRow({ label, path }: { label: string; path: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <PathValue path={path} />
    </div>
  );
}

function PathValue({ path }: { path: string }) {
  return (
    <div className="border-border/70 bg-muted/30 text-muted-foreground flex min-h-9 max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-md border px-3 font-mono text-xs">
      <Folder className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{path || '-'}</span>
    </div>
  );
}

interface SkillSourceGroup {
  root: string;
  sourceKind: ScoutSkillSourceKind;
  skills: ScoutSkillListItem[];
}

function groupSkillsBySource(skills: ScoutSkillListItem[]): SkillSourceGroup[] {
  const groups = new Map<string, SkillSourceGroup>();

  for (const skill of skills) {
    const root = skill.sourceRoot;
    const key = `${skill.sourceKind}:${root}`;
    const group = groups.get(key) ?? {
      root,
      sourceKind: skill.sourceKind,
      skills: [],
    };
    group.skills.push(skill);
    groups.set(key, group);
  }

  return Array.from(groups.values()).sort(
    (left, right) =>
      SOURCE_KIND_ORDER[left.sourceKind] - SOURCE_KIND_ORDER[right.sourceKind] ||
      left.root.localeCompare(right.root),
  );
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/\/+$/, '');
}

function formatDisplayPath(filePath: string): string {
  return normalizePath(filePath)
    .replace(/^\/Users\/[^/]+(?=\/|$)/, '~')
    .replace(/^\/home\/[^/]+(?=\/|$)/, '~')
    .replace(/^[A-Za-z]:\/Users\/[^/]+(?=\/|$)/, '~');
}

function formatDiagnosticMessage(diagnostic: ScoutDiagnostic): string {
  if (diagnostic.type === 'collision') {
    const match = diagnostic.message.match(/^name "(.+)" collision$/);
    if (match) return `名称冲突：${match[1]}`;
  }

  return diagnostic.message;
}

function formatDiagnosticDetail(diagnostic: ScoutDiagnostic): string | undefined {
  const collision = diagnostic.collision;
  if (diagnostic.type === 'collision' && collision) {
    return `使用 ${formatDisplayPath(collision.winnerPath)}，忽略 ${formatDisplayPath(
      collision.loserPath,
    )}`;
  }

  return undefined;
}
