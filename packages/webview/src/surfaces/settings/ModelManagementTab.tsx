// ============================================================
// Model Management Tab — 全局 models.json 自定义模型管理
// ============================================================

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScoutModelApi, ScoutModelProvider } from '@scout-agent/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  getModelApiOptions,
  getModelProviders,
  readNumberInput,
  type EditableModel,
  type EditableProvider,
} from './custom-models-draft';
import type { CustomModelsController } from './custom-models-state';
import {
  SettingsAdvancedOptions,
  SettingsCheckField,
  SettingsField,
  SettingsJsonField,
  SettingsSelectField,
  type SettingsSelectOption,
} from './settings-fields';

const PROVIDER_LABELS: Record<ScoutModelProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

export function ModelManagementTab({ controller }: { controller: CustomModelsController }) {
  const [activeProvider, setActiveProvider] = useState<ScoutModelProvider>('openai');
  const [selectedModelClientId, setSelectedModelClientId] = useState<string | null>(null);
  const pendingFocusModelClientIdRef = useRef<string | null>(null);
  const disabled = controller.isLoading || controller.isSaving;
  const providers = getModelProviders(controller.draft);
  const activeSettings = controller.draft.providers[activeProvider];

  const selectedModelIndex = useMemo(() => {
    if (activeSettings.models.length === 0) return -1;
    const index = activeSettings.models.findIndex(
      (model) => model.clientId === selectedModelClientId,
    );
    return index >= 0 ? index : 0;
  }, [activeSettings.models, selectedModelClientId]);

  const selectedModel = selectedModelIndex >= 0 ? activeSettings.models[selectedModelIndex] : null;

  useEffect(() => {
    const clientId = pendingFocusModelClientIdRef.current;
    if (!clientId || selectedModel?.clientId !== clientId) return;
    pendingFocusModelClientIdRef.current = null;
    const row = document.querySelector<HTMLElement>(`[data-model-client-id="${clientId}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
    document.querySelector<HTMLInputElement>('[data-model-id-input="true"]')?.focus();
  }, [selectedModel?.clientId]);

  const addModel = () => {
    const clientId = controller.addModel(activeProvider);
    pendingFocusModelClientIdRef.current = clientId;
    setSelectedModelClientId(clientId);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-8 py-5 max-[720px]:px-5">
      {controller.error ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
          {controller.error}
        </div>
      ) : null}

      <ProviderTabs
        activeProvider={activeProvider}
        providers={providers}
        onChange={setActiveProvider}
      />

      <ProviderSettings
        provider={activeProvider}
        settings={activeSettings}
        disabled={disabled}
        onChange={(patch) => controller.updateProvider(activeProvider, patch)}
      />

      <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <ModelList
          provider={activeProvider}
          models={activeSettings.models}
          selectedModelClientId={selectedModel?.clientId ?? null}
          disabled={disabled}
          onAddModel={addModel}
          onSelectModel={setSelectedModelClientId}
        />
        <ModelDetail
          model={selectedModel}
          index={selectedModelIndex}
          providerSettings={activeSettings}
          disabled={disabled}
          onChange={(patch) => {
            if (selectedModelIndex < 0) return;
            controller.updateModel(activeProvider, selectedModelIndex, patch);
          }}
          onRemove={() => {
            if (selectedModelIndex < 0) return;
            controller.removeModel(activeProvider, selectedModelIndex);
          }}
        />
      </div>
    </div>
  );
}

function ProviderTabs({
  activeProvider,
  providers,
  onChange,
}: {
  activeProvider: ScoutModelProvider;
  providers: ScoutModelProvider[];
  onChange: (provider: ScoutModelProvider) => void;
}) {
  return (
    <div className="border-border bg-muted/30 inline-flex w-fit rounded-lg border p-1">
      {providers.map((provider) => (
        <Button
          key={provider}
          type="button"
          size="sm"
          variant={activeProvider === provider ? 'secondary' : 'ghost'}
          aria-pressed={activeProvider === provider}
          className="min-w-24"
          onClick={() => onChange(provider)}
        >
          {PROVIDER_LABELS[provider]}
        </Button>
      ))}
    </div>
  );
}

interface ProviderSettingsProps {
  provider: ScoutModelProvider;
  settings: EditableProvider;
  disabled: boolean;
  onChange: (patch: Partial<EditableProvider>) => void;
}

function ProviderSettings({ provider, settings, disabled, onChange }: ProviderSettingsProps) {
  const apiOptions = getApiOptions(settings);

  return (
    <section className="border-border/70 bg-background/40 rounded-lg border p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{PROVIDER_LABELS[provider]} 设置</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            API key、请求地址和 provider 级高级配置会写入全局 models.json。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 max-[980px]:grid-cols-1">
        <SettingsField label="API Key">
          <Input
            type="password"
            value={settings.apiKey}
            placeholder={`${provider.toUpperCase()}_API_KEY 或 literal key`}
            disabled={disabled}
            onChange={(event) => onChange({ apiKey: event.target.value })}
          />
        </SettingsField>
        <SettingsField label="Base URL">
          <Input
            value={settings.baseUrl}
            disabled={disabled}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
          />
        </SettingsField>
        <SettingsField label="API">
          <SettingsSelectField
            value={settings.api}
            disabled={disabled || apiOptions.length === 1}
            onChange={(value) => onChange({ api: value })}
            options={apiOptions}
          />
        </SettingsField>
      </div>

      <SettingsAdvancedOptions
        className="mt-4"
        description="包含请求头、兼容性开关、内置模型覆盖等配置。大多数场景下保持默认即可。"
      >
        <div className="grid grid-cols-3 gap-4 max-[980px]:grid-cols-1">
          <SettingsJsonField
            label="Headers"
            value={settings.headersJson}
            disabled={disabled}
            placeholder={'{\n  "x-custom": "value"\n}'}
            onChange={(value) => onChange({ headersJson: value })}
          />
          <SettingsJsonField
            label="Compat"
            value={settings.compatJson}
            disabled={disabled}
            placeholder={'{\n  "supportsDeveloperRole": false\n}'}
            onChange={(value) => onChange({ compatJson: value })}
          />
          <SettingsJsonField
            label="Model Overrides"
            value={settings.modelOverridesJson}
            disabled={disabled}
            placeholder={'{\n  "gpt-4.1": { "contextWindow": 128000 }\n}'}
            onChange={(value) => onChange({ modelOverridesJson: value })}
          />
        </div>
      </SettingsAdvancedOptions>
    </section>
  );
}

interface ModelListProps {
  provider: ScoutModelProvider;
  models: EditableModel[];
  selectedModelClientId: string | null;
  disabled: boolean;
  onAddModel: () => void;
  onSelectModel: (clientId: string) => void;
}

function ModelList({
  provider,
  models,
  selectedModelClientId,
  disabled,
  onAddModel,
  onSelectModel,
}: ModelListProps) {
  return (
    <section className="border-border/70 bg-background/40 rounded-lg border">
      <div className="border-border/70 flex items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">自定义模型</h2>
          <p className="text-muted-foreground mt-1 text-xs">{PROVIDER_LABELS[provider]}</p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onAddModel}>
          <Plus />
          添加模型
        </Button>
      </div>

      <div className="grid gap-2 p-3">
        {models.length === 0 ? (
          <div className="border-border/70 text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
            当前 provider 没有自定义模型。
          </div>
        ) : (
          models.map((model, index) => (
            <Button
              key={model.clientId}
              type="button"
              variant="ghost"
              className={cn(
                'border-border/50 hover:bg-control-hover h-auto w-full justify-start border px-3 py-2.5 text-left',
                model.clientId === selectedModelClientId &&
                  'bg-control-selected-subtle text-foreground',
              )}
              data-model-client-id={model.clientId}
              onClick={() => onSelectModel(model.clientId)}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {model.name || model.id || `自定义模型 ${index + 1}`}
              </span>
            </Button>
          ))
        )}
      </div>
    </section>
  );
}

interface ModelDetailProps {
  model: EditableModel | null;
  index: number;
  providerSettings: EditableProvider;
  disabled: boolean;
  onChange: (patch: Partial<EditableModel>) => void;
  onRemove: () => void;
}

function ModelDetail({
  model,
  index,
  providerSettings,
  disabled,
  onChange,
  onRemove,
}: ModelDetailProps) {
  const apiOptions = getApiOptions(providerSettings, true);

  if (!model) {
    return (
      <section className="border-border/70 bg-background/40 rounded-lg border p-6">
        <div className="text-muted-foreground grid min-h-60 place-items-center rounded-lg border border-dashed px-4 text-center text-sm">
          添加一个模型后在这里编辑详情。
        </div>
      </section>
    );
  }

  return (
    <section className="border-border/70 bg-background/40 rounded-lg border p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">
            {model.name || model.id || `自定义模型 ${index + 1}`}
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">模型详情</p>
        </div>
        <Button type="button" size="icon-sm" variant="ghost" disabled={disabled} onClick={onRemove}>
          <Trash2 />
          <span className="sr-only">删除模型</span>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 max-[840px]:grid-cols-1">
        <SettingsField label="Model ID">
          <Input
            data-model-id-input="true"
            value={model.id}
            disabled={disabled}
            onChange={(event) => onChange({ id: event.target.value })}
          />
        </SettingsField>
        <SettingsField label="Name">
          <Input
            value={model.name}
            disabled={disabled}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </SettingsField>
        <SettingsField label="Base URL">
          <Input
            value={model.baseUrl}
            placeholder={providerSettings.baseUrl}
            disabled={disabled}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
          />
        </SettingsField>
        <SettingsField label="API">
          <SettingsSelectField
            value={model.api}
            disabled={disabled || apiOptions.length === 1}
            onChange={(value) => onChange({ api: value })}
            options={apiOptions}
          />
        </SettingsField>
        <SettingsField label="Context Window">
          <Input
            inputMode="numeric"
            pattern="[0-9]*"
            value={String(model.contextWindow)}
            disabled={disabled}
            onChange={(event) => onChange({ contextWindow: readNumberInput(event.target.value) })}
          />
        </SettingsField>
        <SettingsField label="Max Tokens">
          <Input
            inputMode="numeric"
            pattern="[0-9]*"
            value={String(model.maxTokens)}
            disabled={disabled}
            onChange={(event) => onChange({ maxTokens: readNumberInput(event.target.value) })}
          />
        </SettingsField>
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        <SettingsCheckField
          label="Reasoning"
          checked={model.reasoning}
          disabled={disabled}
          onChange={(checked) => onChange({ reasoning: checked })}
        />
        <SettingsCheckField
          label="Text Input"
          checked={model.input.includes('text')}
          disabled={disabled}
          onChange={(checked) =>
            onChange({
              input: nextInputTypes(model.input, 'text', checked),
            })
          }
        />
        <SettingsCheckField
          label="Image Input"
          checked={model.input.includes('image')}
          disabled={disabled}
          onChange={(checked) =>
            onChange({
              input: nextInputTypes(model.input, 'image', checked),
            })
          }
        />
      </div>

      <SettingsAdvancedOptions
        className="mt-4"
        description="包含费用、模型级请求头、兼容性开关、推理等级映射等配置。大多数场景下保持默认即可。"
      >
        <div className="grid grid-cols-4 gap-4 max-[980px]:grid-cols-2 max-[560px]:grid-cols-1">
          <NumberField
            label="Cost Input"
            value={model.cost.input}
            disabled={disabled}
            onChange={(value) => onChange({ cost: { ...model.cost, input: value } })}
          />
          <NumberField
            label="Cost Output"
            value={model.cost.output}
            disabled={disabled}
            onChange={(value) => onChange({ cost: { ...model.cost, output: value } })}
          />
          <NumberField
            label="Cache Read"
            value={model.cost.cacheRead}
            disabled={disabled}
            onChange={(value) => onChange({ cost: { ...model.cost, cacheRead: value } })}
          />
          <NumberField
            label="Cache Write"
            value={model.cost.cacheWrite}
            disabled={disabled}
            onChange={(value) => onChange({ cost: { ...model.cost, cacheWrite: value } })}
          />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-4 max-[980px]:grid-cols-1">
          <SettingsJsonField
            label="Headers"
            value={model.headersJson}
            disabled={disabled}
            onChange={(value) => onChange({ headersJson: value })}
          />
          <SettingsJsonField
            label="Compat"
            value={model.compatJson}
            disabled={disabled}
            onChange={(value) => onChange({ compatJson: value })}
          />
          <SettingsJsonField
            label="Thinking Level Map"
            value={model.thinkingLevelMapJson}
            disabled={disabled}
            onChange={(value) => onChange({ thinkingLevelMapJson: value })}
          />
        </div>
      </SettingsAdvancedOptions>
    </section>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <SettingsField label={label}>
      <Input
        inputMode="decimal"
        value={String(value)}
        disabled={disabled}
        onChange={(event) => onChange(readNumberInput(event.target.value))}
      />
    </SettingsField>
  );
}

function getApiOptions(provider: EditableProvider): Array<SettingsSelectOption<ScoutModelApi>>;
function getApiOptions(
  provider: EditableProvider,
  includeInherited: true,
): Array<SettingsSelectOption<ScoutModelApi | ''>>;
function getApiOptions(
  provider: EditableProvider,
  includeInherited = false,
): Array<SettingsSelectOption<ScoutModelApi | ''>> {
  const options: Array<SettingsSelectOption<ScoutModelApi | ''>> = includeInherited
    ? [{ value: '', label: `继承 (${provider.api})` }]
    : [];
  return [...options, ...getModelApiOptions(provider).map((api) => ({ value: api, label: api }))];
}

function nextInputTypes(
  current: EditableModel['input'],
  type: EditableModel['input'][number],
  checked: boolean,
): EditableModel['input'] {
  const next = checked
    ? Array.from(new Set([...current, type]))
    : current.filter((item) => item !== type);
  return next.length > 0 ? next : ['text'];
}
