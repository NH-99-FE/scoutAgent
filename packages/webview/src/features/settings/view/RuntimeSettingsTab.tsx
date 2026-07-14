// ============================================================
// Runtime Settings Tab — global/project settings.json 管理
// ============================================================

import type { ReactNode } from 'react';
import {
  SCOUT_MODEL_PROVIDERS,
  SCOUT_QUEUE_MODES,
  SCOUT_SETTINGS_SCOPES,
  SCOUT_TRANSPORTS,
  THINKING_LEVELS,
} from '@scout-agent/shared';
import type {
  ScoutModelProvider,
  ScoutQueueMode,
  ScoutCustomToolProfile,
  ScoutRuntimeSettingsPath,
  ScoutSettingsScope,
  ScoutToolProfileInfo,
  ScoutTransport,
  ToolInfo,
  ThinkingLevel,
} from '@scout-agent/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  readOptionalNumber,
  toQueueMode,
  toThinkingLevel,
  toTransport,
  updateNested,
  type EditableRuntimeSettings,
} from '../model/runtime-settings-draft';
import type { RuntimeSettingsController } from '../hooks/runtime-settings-state';
import {
  SettingsAdvancedOptions,
  SettingsField,
  SettingsSelectField,
  type SettingsSelectOption,
} from './settings-fields';
import { ToolProfileSettings } from './ToolProfileSettings';
import { useTools } from '@/store/session-store';
import { useToolProfiles } from '@/store/config-store';

const SCOPE_LABELS: Record<ScoutSettingsScope, string> = {
  global: '全局',
  project: '当前项目',
};
const SCOPES: Array<{ value: ScoutSettingsScope; label: string }> = SCOUT_SETTINGS_SCOPES.map(
  (value) => ({ value, label: SCOPE_LABELS[value] }),
);

const PROVIDERS: Array<SettingsSelectOption<ScoutModelProvider | ''>> = [
  { value: '', label: '未设置' },
  ...SCOUT_MODEL_PROVIDERS.map((value) => ({ value, label: value })),
];
const THINKING_LEVEL_OPTIONS: Array<SettingsSelectOption<ThinkingLevel | ''>> = [
  { value: '', label: '未设置' },
  ...THINKING_LEVELS.map((value) => ({ value, label: value })),
];
const TRANSPORTS: Array<SettingsSelectOption<ScoutTransport | ''>> = [
  { value: '', label: '未设置' },
  ...SCOUT_TRANSPORTS.map((value) => ({ value, label: value })),
];
const QUEUE_MODES: Array<SettingsSelectOption<ScoutQueueMode | ''>> = [
  { value: '', label: '未设置' },
  ...SCOUT_QUEUE_MODES.map((value) => ({ value, label: value })),
];
type OptionalBooleanValue = '' | 'true' | 'false';

const OPTIONAL_BOOLEAN_TRUE_DEFAULT: Array<SettingsSelectOption<OptionalBooleanValue>> = [
  { value: '', label: '未设置（继承开启）' },
  { value: 'true', label: '开启' },
  { value: 'false', label: '关闭' },
];
const OPTIONAL_BOOLEAN_FALSE_DEFAULT: Array<SettingsSelectOption<OptionalBooleanValue>> = [
  { value: '', label: '未设置（继承关闭）' },
  { value: 'true', label: '开启' },
  { value: 'false', label: '关闭' },
];

export function RuntimeSettingsTab({ controller }: { controller: RuntimeSettingsController }) {
  const { draft, currentSettings, isLoading, isSaving, setScope, updateCurrentSettings } =
    controller;
  const tools = useTools();
  const toolProfiles = useToolProfiles();
  const disabled = isLoading || isSaving;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-8 py-5 max-[720px]:px-5">
      {controller.error ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
          {controller.error}
        </div>
      ) : null}

      <div className="border-border bg-muted/30 inline-flex w-fit rounded-lg border p-1">
        {SCOPES.map((scope) => (
          <Button
            key={scope.value}
            type="button"
            size="sm"
            variant={draft.scope === scope.value ? 'secondary' : 'ghost'}
            disabled={disabled}
            aria-pressed={draft.scope === scope.value}
            className="min-w-24"
            onClick={() => setScope(scope.value)}
          >
            {scope.label}
          </Button>
        ))}
      </div>

      <section className="border-border/70 bg-background/40 rounded-lg border">
        <div className="border-border/70 border-b px-4 py-3">
          <h2 className="text-base font-semibold">
            {draft.scope === 'global' ? '全局设置' : '项目设置'}
          </h2>
        </div>
        <RuntimeSettingsForm
          scope={draft.scope}
          settings={currentSettings}
          inheritedDefaultToolProfile={
            draft.scope === 'project' ? draft.global.defaultToolProfile : undefined
          }
          inheritedToolProfiles={draft.scope === 'project' ? (draft.global.toolProfiles ?? []) : []}
          availableTools={tools}
          configuredProfiles={toolProfiles}
          disabled={disabled}
          onChange={updateCurrentSettings}
        />
      </section>

      <section className="border-border/70 bg-background/40 rounded-lg border p-4">
        <h2 className="text-base font-semibold">当前生效</h2>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-sm max-[840px]:grid-cols-1">
          <EffectiveValue label="Default Provider" value={draft.effective.defaultProvider} />
          <EffectiveValue label="Default Model" value={draft.effective.defaultModel} />
          <EffectiveValue label="Tool Profile" value={draft.effective.defaultToolProfile} />
          <EffectiveValue label="Thinking" value={draft.effective.defaultThinkingLevel} />
          <EffectiveValue label="Transport" value={draft.effective.transport} />
          <EffectiveValue label="Steering Mode" value={draft.effective.steeringMode} />
          <EffectiveValue label="Follow-up Mode" value={draft.effective.followUpMode} />
        </dl>
      </section>
    </div>
  );
}

function RuntimeSettingsForm({
  scope,
  settings,
  inheritedDefaultToolProfile,
  inheritedToolProfiles,
  availableTools,
  configuredProfiles,
  disabled,
  onChange,
}: {
  scope: ScoutSettingsScope;
  settings: EditableRuntimeSettings;
  inheritedDefaultToolProfile?: string;
  inheritedToolProfiles: ScoutCustomToolProfile[];
  availableTools: ToolInfo[];
  configuredProfiles: ScoutToolProfileInfo[];
  disabled: boolean;
  onChange: (
    patch: Partial<EditableRuntimeSettings>,
    dirtyPaths: ScoutRuntimeSettingsPath[],
  ) => void;
}) {
  return (
    <div className="grid gap-6 p-4">
      <SettingGroup title="常用配置">
        <div className="grid grid-cols-3 gap-4 max-[980px]:grid-cols-1">
          <SettingsField label="Default Provider">
            <SettingsSelectField
              value={settings.defaultProvider ?? ''}
              disabled={disabled}
              onChange={(value) =>
                onChange({ defaultProvider: value ? (value as ScoutModelProvider) : undefined }, [
                  'defaultProvider',
                ])
              }
              options={PROVIDERS}
            />
          </SettingsField>
          <SettingsField label="Default Model">
            <Input
              value={settings.defaultModel ?? ''}
              disabled={disabled}
              onChange={(event) =>
                onChange({ defaultModel: optionalString(event.target.value) }, ['defaultModel'])
              }
            />
          </SettingsField>
          <SettingsField label="Default Thinking">
            <SettingsSelectField
              value={settings.defaultThinkingLevel ?? ''}
              disabled={disabled}
              onChange={(value) =>
                onChange({ defaultThinkingLevel: toThinkingLevel(value) }, ['defaultThinkingLevel'])
              }
              options={THINKING_LEVEL_OPTIONS}
            />
          </SettingsField>
          <SettingsField label="Steering Mode">
            <SettingsSelectField
              value={settings.steeringMode ?? ''}
              disabled={disabled}
              onChange={(value) => onChange({ steeringMode: toQueueMode(value) }, ['steeringMode'])}
              options={QUEUE_MODES}
            />
          </SettingsField>
          <SettingsField label="Follow-up Mode">
            <SettingsSelectField
              value={settings.followUpMode ?? ''}
              disabled={disabled}
              onChange={(value) => onChange({ followUpMode: toQueueMode(value) }, ['followUpMode'])}
              options={QUEUE_MODES}
            />
          </SettingsField>
        </div>
      </SettingGroup>

      <ToolProfileSettings
        scope={scope}
        settings={settings}
        inheritedDefaultToolProfile={inheritedDefaultToolProfile}
        inheritedToolProfiles={inheritedToolProfiles}
        availableTools={availableTools}
        configuredProfiles={configuredProfiles}
        disabled={disabled}
        onChange={onChange}
      />

      <div className="grid grid-cols-2 gap-4 max-[980px]:grid-cols-1">
        <SettingGroup title="上下文与历史">
          <OptionalBooleanField
            label="Compaction Enabled"
            value={settings.compaction?.enabled}
            disabled={disabled}
            onChange={(enabled) =>
              onChange(
                {
                  compaction: updateNested(settings.compaction, 'enabled', enabled),
                },
                ['compaction.enabled'],
              )
            }
            options={OPTIONAL_BOOLEAN_TRUE_DEFAULT}
          />
          <OptionalNumberField
            label="Compaction Reserve Tokens"
            value={settings.compaction?.reserveTokens}
            disabled={disabled}
            onChange={(value) =>
              onChange(
                {
                  compaction: updateNested(settings.compaction, 'reserveTokens', value),
                },
                ['compaction.reserveTokens'],
              )
            }
          />
          <OptionalNumberField
            label="Keep Recent Tokens"
            value={settings.compaction?.keepRecentTokens}
            disabled={disabled}
            onChange={(value) =>
              onChange(
                {
                  compaction: updateNested(settings.compaction, 'keepRecentTokens', value),
                },
                ['compaction.keepRecentTokens'],
              )
            }
          />
          <OptionalNumberField
            label="Branch Summary Reserve Tokens"
            value={settings.branchSummary?.reserveTokens}
            disabled={disabled}
            onChange={(value) =>
              onChange(
                {
                  branchSummary: updateNested(settings.branchSummary, 'reserveTokens', value),
                },
                ['branchSummary.reserveTokens'],
              )
            }
          />
          <OptionalBooleanField
            label="Branch Summary Skip Prompt"
            value={settings.branchSummary?.skipPrompt}
            disabled={disabled}
            onChange={(skipPrompt) =>
              onChange(
                {
                  branchSummary: updateNested(settings.branchSummary, 'skipPrompt', skipPrompt),
                },
                ['branchSummary.skipPrompt'],
              )
            }
            options={OPTIONAL_BOOLEAN_FALSE_DEFAULT}
          />
        </SettingGroup>

        <SettingGroup title="稳定性与执行">
          <SettingsField label="Transport">
            <SettingsSelectField
              value={settings.transport ?? ''}
              disabled={disabled}
              onChange={(value) => onChange({ transport: toTransport(value) }, ['transport'])}
              options={TRANSPORTS}
            />
          </SettingsField>
          <SettingsField label="WebSocket Timeout">
            <Input
              inputMode="numeric"
              pattern="[0-9]*"
              value={settings.websocketConnectTimeoutMs?.toString() ?? ''}
              disabled={disabled}
              onChange={(event) =>
                onChange({ websocketConnectTimeoutMs: readOptionalNumber(event.target.value) }, [
                  'websocketConnectTimeoutMs',
                ])
              }
            />
          </SettingsField>
          <SettingsField label="Shell Path">
            <Input
              value={settings.shellPath ?? ''}
              disabled={disabled}
              onChange={(event) =>
                onChange({ shellPath: optionalString(event.target.value) }, ['shellPath'])
              }
            />
          </SettingsField>
          <OptionalBooleanField
            label="Retry Enabled"
            value={settings.retry?.enabled}
            disabled={disabled}
            onChange={(enabled) =>
              onChange(
                {
                  retry: updateNested(settings.retry, 'enabled', enabled),
                },
                ['retry.enabled'],
              )
            }
            options={OPTIONAL_BOOLEAN_TRUE_DEFAULT}
          />
          <OptionalNumberField
            label="Retry Max Retries"
            value={settings.retry?.maxRetries}
            disabled={disabled}
            onChange={(value) =>
              onChange(
                {
                  retry: updateNested(settings.retry, 'maxRetries', value),
                },
                ['retry.maxRetries'],
              )
            }
          />
          <OptionalNumberField
            label="Retry Base Delay Ms"
            value={settings.retry?.baseDelayMs}
            disabled={disabled}
            onChange={(value) =>
              onChange(
                {
                  retry: updateNested(settings.retry, 'baseDelayMs', value),
                },
                ['retry.baseDelayMs'],
              )
            }
          />
          <OptionalNumberField
            label="Provider Timeout Ms"
            value={settings.retry?.provider?.timeoutMs}
            disabled={disabled}
            onChange={(value) =>
              onChange(
                {
                  retry: updateNested(
                    settings.retry,
                    'provider',
                    updateNested(settings.retry?.provider, 'timeoutMs', value),
                  ),
                },
                ['retry.provider.timeoutMs'],
              )
            }
          />
          <OptionalNumberField
            label="Provider Max Retries"
            value={settings.retry?.provider?.maxRetries}
            disabled={disabled}
            onChange={(value) =>
              onChange(
                {
                  retry: updateNested(
                    settings.retry,
                    'provider',
                    updateNested(settings.retry?.provider, 'maxRetries', value),
                  ),
                },
                ['retry.provider.maxRetries'],
              )
            }
          />
          <OptionalNumberField
            label="Provider Max Retry Delay"
            value={settings.retry?.provider?.maxRetryDelayMs}
            disabled={disabled}
            onChange={(value) =>
              onChange(
                {
                  retry: updateNested(
                    settings.retry,
                    'provider',
                    updateNested(settings.retry?.provider, 'maxRetryDelayMs', value),
                  ),
                },
                ['retry.provider.maxRetryDelayMs'],
              )
            }
          />
        </SettingGroup>
      </div>

      <SettingsAdvancedOptions description="这些设置通常只在调试模型预算、资源加载路径或扩展入口时需要调整。">
        <div className="grid grid-cols-2 gap-4 max-[980px]:grid-cols-1">
          <SettingsField label="Thinking Budgets">
            <Textarea
              value={settings.thinkingBudgetsJson}
              disabled={disabled}
              placeholder={'{\n  "medium": 4096\n}'}
              className="min-h-28 resize-y font-mono text-xs"
              onChange={(event) =>
                onChange({ thinkingBudgetsJson: event.target.value }, ['thinkingBudgets'])
              }
            />
          </SettingsField>
          <SettingsField label="Extensions">
            <Textarea
              value={settings.extensionsText}
              disabled={disabled}
              placeholder={'C:\\path\\to\\extension\n./relative-extension'}
              className="min-h-28 resize-y font-mono text-xs"
              onChange={(event) => onChange({ extensionsText: event.target.value }, ['extensions'])}
            />
          </SettingsField>
        </div>
      </SettingsAdvancedOptions>
    </div>
  );
}

function OptionalBooleanField({
  label,
  value,
  disabled,
  options,
  onChange,
}: {
  label: string;
  value: boolean | undefined;
  disabled: boolean;
  options: Array<SettingsSelectOption<OptionalBooleanValue>>;
  onChange: (value: boolean | undefined) => void;
}) {
  return (
    <SettingsField label={label}>
      <SettingsSelectField
        value={formatOptionalBoolean(value)}
        disabled={disabled}
        onChange={(nextValue) => onChange(readOptionalBoolean(nextValue))}
        options={options}
      />
    </SettingsField>
  );
}

function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-border/70 bg-muted/20 grid gap-3 rounded-lg border p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function OptionalNumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | undefined;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <SettingsField label={label}>
      <Input
        inputMode="numeric"
        pattern="[0-9]*"
        value={value?.toString() ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(readOptionalNumber(event.target.value))}
      />
    </SettingsField>
  );
}

function EffectiveValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 truncate font-mono text-xs">
        {value === undefined ? '未设置' : String(value)}
      </dd>
    </div>
  );
}

function optionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function formatOptionalBoolean(value: boolean | undefined): OptionalBooleanValue {
  if (value === undefined) return '';
  return value ? 'true' : 'false';
}

function readOptionalBoolean(value: OptionalBooleanValue): boolean | undefined {
  if (value === '') return undefined;
  return value === 'true';
}
