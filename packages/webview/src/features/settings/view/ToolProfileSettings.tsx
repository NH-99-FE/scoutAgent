// ============================================================
// Tool Profile Settings — 工具模式默认值与自定义模式编辑
// ============================================================

import { Plus, Trash2 } from 'lucide-react';
import type {
  ScoutCustomToolProfile,
  ScoutRuntimeSettingsPath,
  ScoutSettingsScope,
  ScoutToolProfileDefinition,
  ScoutToolProfileInfo,
  ToolInfo,
} from '@scout-agent/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { EditableRuntimeSettings } from '../model/runtime-settings-draft';
import { reconcileToolProfileSettings } from '../model/tool-profile-settings';
import {
  SettingsCheckField,
  SettingsField,
  SettingsSelectField,
  type SettingsSelectOption,
} from './settings-fields';

interface ToolProfileSettingsProps {
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
}

export function ToolProfileSettings({
  scope,
  settings,
  inheritedDefaultToolProfile,
  inheritedToolProfiles,
  availableTools,
  configuredProfiles,
  disabled,
  onChange,
}: ToolProfileSettingsProps) {
  const selectableCustomProfiles = settings.toolProfiles ?? inheritedToolProfiles;
  const builtinProfiles = configuredProfiles.filter((profile) => profile.builtin);

  const updateProfiles = (profiles: ScoutCustomToolProfile[]) => {
    const result = reconcileToolProfileSettings({
      scope,
      settings,
      inheritedDefaultToolProfile,
      inheritedToolProfiles,
      profiles,
    });
    onChange(result.patch, result.dirtyPaths);
  };

  return (
    <div className="border-border/70 bg-muted/20 grid gap-3 rounded-lg border p-3">
      <h3 className="text-sm font-semibold">工具模式</h3>
      <SettingsField label="默认新会话工具模式">
        <SettingsSelectField
          value={settings.defaultToolProfile ?? ''}
          disabled={disabled}
          onChange={(value) =>
            onChange({ defaultToolProfile: optionalString(value) }, ['defaultToolProfile'])
          }
          options={buildProfileOptions(
            builtinProfiles,
            selectableCustomProfiles,
            getUnsetProfileLabel(
              scope,
              inheritedDefaultToolProfile,
              inheritedToolProfiles,
              configuredProfiles,
            ),
          )}
        />
      </SettingsField>
      <BuiltinProfilesSummary profiles={builtinProfiles} />
      <CustomProfilesEditor
        profiles={settings.toolProfiles ?? []}
        inheritedProfiles={inheritedToolProfiles}
        availableTools={availableTools}
        configuredProfiles={configuredProfiles}
        disabled={disabled}
        onChange={updateProfiles}
      />
    </div>
  );
}

function buildProfileOptions(
  builtinProfiles: readonly ScoutToolProfileDefinition[],
  customProfiles: readonly ScoutToolProfileDefinition[],
  unsetLabel: string,
): Array<SettingsSelectOption<string>> {
  return [
    { value: '', label: unsetLabel },
    ...builtinProfiles.map((profile) => ({
      value: profile.id,
      label: profile.name,
    })),
    ...customProfiles.map((profile) => ({
      value: profile.id,
      label: profile.name || profile.id,
    })),
  ];
}

function getUnsetProfileLabel(
  scope: ScoutSettingsScope,
  inheritedDefaultProfile: string | undefined,
  inheritedProfiles: readonly ScoutCustomToolProfile[],
  configuredProfiles: readonly ScoutToolProfileDefinition[],
): string {
  if (scope === 'global') return `未设置（${configuredProfiles[0]?.name ?? '默认模式'}）`;
  const inheritedProfileId = inheritedDefaultProfile ?? configuredProfiles[0]?.id ?? '';
  const inheritedProfile =
    configuredProfiles.find((profile) => profile.id === inheritedProfileId) ??
    inheritedProfiles.find((profile) => profile.id === inheritedProfileId);
  return `未设置（继承：${inheritedProfile?.name ?? inheritedProfileId}）`;
}

function BuiltinProfilesSummary({ profiles }: { profiles: readonly ScoutToolProfileDefinition[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
      {profiles.map((profile) => (
        <div key={profile.id} className="border-border/70 rounded-md border p-3">
          <div className="text-sm font-medium">{profile.name}</div>
          <div className="text-muted-foreground mt-1 font-mono text-xs">
            {profile.tools.join(' / ')}
          </div>
        </div>
      ))}
    </div>
  );
}

function CustomProfilesEditor({
  profiles,
  inheritedProfiles,
  availableTools,
  configuredProfiles,
  disabled,
  onChange,
}: {
  profiles: ScoutCustomToolProfile[];
  inheritedProfiles: ScoutCustomToolProfile[];
  availableTools: ToolInfo[];
  configuredProfiles: ScoutToolProfileInfo[];
  disabled: boolean;
  onChange: (profiles: ScoutCustomToolProfile[]) => void;
}) {
  const toolOptions = getToolOptions(availableTools, profiles, configuredProfiles);
  const addProfile = () => {
    // 项目 profile 会整体覆盖全局数组，但 ID 仍需避开继承项，防止继承默认值悄然改绑。
    const id = createNextProfileId([...profiles, ...inheritedProfiles]);
    onChange([...profiles, { id, name: '自定义模式', tools: ['read'] }]);
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold">自定义模式</h4>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={addProfile}>
          <Plus />
          新增
        </Button>
      </div>
      {profiles.length === 0 ? (
        <div className="border-border/70 text-muted-foreground rounded-md border border-dashed px-3 py-4 text-sm">
          暂无自定义模式
        </div>
      ) : (
        profiles.map((profile, index) => (
          <div
            key={`${profile.id}:${index}`}
            className="border-border/70 grid gap-3 rounded-md border p-3"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 max-[820px]:grid-cols-1">
              <SettingsField label="名称">
                <Input
                  value={profile.name}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(updateProfile(profiles, index, { name: event.target.value }))
                  }
                />
              </SettingsField>
              <SettingsField label="ID">
                <Input
                  value={profile.id}
                  disabled={disabled}
                  readOnly
                  title="工具模式 ID 创建后不可修改"
                  className="font-mono text-xs"
                />
              </SettingsField>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title="删除"
                disabled={disabled}
                className="self-end"
                onClick={() => onChange(profiles.filter((_, itemIndex) => itemIndex !== index))}
              >
                <Trash2 />
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-2 max-[980px]:grid-cols-2 max-[560px]:grid-cols-1">
              {toolOptions.map((tool) => (
                <SettingsCheckField
                  key={tool.name}
                  label={tool.label}
                  checked={profile.tools.includes(tool.name)}
                  disabled={disabled}
                  onChange={(checked) =>
                    onChange(
                      updateProfile(profiles, index, {
                        tools: toggleTool(profile.tools, tool.name, checked),
                      }),
                    )
                  }
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function updateProfile(
  profiles: readonly ScoutCustomToolProfile[],
  index: number,
  patch: Partial<ScoutCustomToolProfile>,
): ScoutCustomToolProfile[] {
  return profiles.map((profile, itemIndex) =>
    itemIndex === index ? { ...profile, ...patch } : profile,
  );
}

function toggleTool(tools: readonly string[], toolName: string, checked: boolean): string[] {
  if (checked) return [...new Set([...tools, toolName])];
  return tools.filter((name) => name !== toolName);
}

function getToolOptions(
  availableTools: readonly ToolInfo[],
  profiles: readonly ScoutCustomToolProfile[],
  configuredProfiles: readonly ScoutToolProfileDefinition[],
) {
  const visibleTools =
    availableTools.length > 0
      ? availableTools.map((tool) => ({ name: tool.name, label: tool.label ?? tool.name }))
      : [...new Set(configuredProfiles.flatMap((profile) => profile.tools))].map((name) => ({
          name,
          label: name,
        }));
  const known = new Set(visibleTools.map((tool) => tool.name));
  for (const name of profiles.flatMap((profile) => profile.tools)) {
    if (known.has(name)) continue;
    visibleTools.push({ name, label: name });
    known.add(name);
  }
  return visibleTools;
}

function createNextProfileId(profiles: readonly ScoutCustomToolProfile[]): string {
  const used = new Set(profiles.map((profile) => profile.id));
  for (let index = 1; index < 1000; index++) {
    const id = `custom-${index}`;
    if (!used.has(id)) return id;
  }
  return `custom-${Date.now()}`;
}

function optionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
