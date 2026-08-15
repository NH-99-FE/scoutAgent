import { FilePlus2, FolderOpen } from 'lucide-react';
import type {
  ScoutPromptListItem,
  ScoutPromptSourceKind,
  ScoutPromptStatus,
} from '@scout-agent/shared';
import { Button } from '@/components/ui/button';
import type { PromptSettingsController } from '../hooks/prompt-settings-state';

const SOURCE_LABELS: Record<ScoutPromptSourceKind, string> = {
  global: '全局',
  extension: 'Extension',
};

const STATUS_LABELS: Partial<Record<ScoutPromptStatus, string>> = {
  invalid: '无效',
  shadowed: '被覆盖',
};

export function PromptListSection({
  controller,
  disabled,
  onCreate,
}: {
  controller: PromptSettingsController;
  disabled: boolean;
  onCreate: () => void;
}) {
  return (
    <section className="border-border/70 bg-background/40 min-w-0 overflow-hidden rounded-lg border">
      <div className="border-border/70 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">Prompt 模板</h2>
          <p className="text-muted-foreground text-xs">
            全局 Markdown 文件会注册为斜杠命令；Extension Prompt 仅在运行期间生效
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={controller.openPromptsDirectory}
          >
            <FolderOpen />
            目录
          </Button>
          <Button type="button" size="sm" disabled={disabled} onClick={onCreate}>
            <FilePlus2 />
            新建 Prompt
          </Button>
        </div>
      </div>

      {controller.settings.prompts.length === 0 ? (
        <div className="grid justify-items-center gap-2 px-4 py-10 text-center">
          <p className="text-sm font-medium">暂无 Prompt 模板</p>
          <p className="text-muted-foreground text-xs">
            创建模板后即可在 Composer 中通过 /命令名 调用
          </p>
          <Button type="button" size="sm" variant="outline" onClick={onCreate}>
            创建第一个 Prompt
          </Button>
        </div>
      ) : (
        <div className="divide-border/60 divide-y">
          {controller.settings.prompts.map((prompt) => (
            <PromptRow
              key={prompt.path}
              prompt={prompt}
              controller={controller}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PromptRow({
  prompt,
  controller,
  disabled,
}: {
  prompt: ScoutPromptListItem;
  controller: PromptSettingsController;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      className="hover:bg-control-hover flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors disabled:cursor-default"
      disabled={disabled}
      onClick={() => controller.openPromptFile(prompt.path)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium">{prompt.command}</span>
          {prompt.argumentHint ? (
            <span className="text-muted-foreground max-w-[35%] min-w-0 shrink truncate font-mono text-xs">
              {prompt.argumentHint}
            </span>
          ) : null}
          <span className="border-border text-muted-foreground rounded border px-1.5 py-0.5 text-[10px]">
            {SOURCE_LABELS[prompt.sourceKind]}
          </span>
          {STATUS_LABELS[prompt.status] ? (
            <span className="text-warning text-[10px]">{STATUS_LABELS[prompt.status]}</span>
          ) : null}
        </div>
        <p
          className="text-muted-foreground mt-1 truncate text-xs"
          title={prompt.description || prompt.path}
        >
          {prompt.description || prompt.path}
        </p>
      </div>
    </button>
  );
}
