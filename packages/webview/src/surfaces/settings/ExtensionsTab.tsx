// ============================================================
// Extensions Tab — 扩展入口与示例管理
// ============================================================

import { FileCode2, Folder, Plus, RefreshCw } from 'lucide-react';
import type {
  ScoutExtensionListItem,
  ScoutExtensionScope,
  ScoutExtensionTemplateInfo,
} from '@scout-agent/shared';
import { Button } from '@/components/ui/button';
import type { ExtensionSettingsController } from './extension-settings-state';

const SCOPE_LABELS: Record<ScoutExtensionScope, string> = {
  project: '项目',
  global: '全局',
  configured: '配置',
};

export function ExtensionsTab({ controller }: { controller: ExtensionSettingsController }) {
  const { settings } = controller;
  const disabled = controller.isLoading || controller.isSaving;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-8 py-5 max-[720px]:px-5">
      {controller.error ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
          {controller.error}
        </div>
      ) : null}

      <section className="border-border/70 bg-background/40 rounded-lg border">
        <div className="border-border/70 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <h2 className="text-base font-semibold">扩展模板</h2>
        </div>
        <div className="grid gap-3 p-4 text-sm">
          <PathRow label="项目路径" path={settings.projectDir} />
          <PathRow label="全局路径" path={settings.globalDir} />
          <TemplateList
            templates={settings.templates}
            disabled={disabled}
            onCreate={controller.createExtensionFromTemplate}
            onOpen={controller.openExtensionFile}
          />
        </div>
      </section>

      <section className="border-border/70 bg-background/40 rounded-lg border">
        <div className="border-border/70 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <h2 className="text-base font-semibold">扩展文件</h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={controller.isLoading}
            onClick={controller.load}
          >
            <RefreshCw />
            刷新
          </Button>
        </div>
        <ExtensionList
          extensions={settings.extensions}
          disabled={disabled}
          onOpen={controller.openExtensionFile}
        />
      </section>

      {settings.configuredPaths.length > 0 ? (
        <section className="border-border/70 bg-background/40 rounded-lg border p-4">
          <h2 className="text-base font-semibold">额外路径</h2>
          <div className="mt-3 grid gap-2">
            {settings.configuredPaths.map((item) => (
              <PathValue key={item} path={item} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TemplateList({
  templates,
  disabled,
  onCreate,
  onOpen,
}: {
  templates: ScoutExtensionTemplateInfo[];
  disabled: boolean;
  onCreate: (
    templateId: ScoutExtensionTemplateInfo['id'],
    scope: Exclude<ScoutExtensionScope, 'configured'>,
  ) => void;
  onOpen: (path: string) => void;
}) {
  if (templates.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-16 items-center text-sm">暂无扩展模板</div>
    );
  }

  return (
    <div className="border-border/70 divide-border/70 rounded-lg border">
      {templates.map((template) => (
        <div
          key={template.id}
          className="flex flex-wrap items-center gap-3 border-b px-3 py-3 last:border-b-0"
        >
          <FileCode2 className="text-muted-foreground size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{template.label}</span>
            <span className="text-muted-foreground block truncate font-mono text-xs">
              {template.path}
            </span>
          </span>
          <div className="flex items-center gap-2">
            {template.exists ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => onOpen(template.path)}
              >
                <FileCode2 />
                打开项目扩展
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={disabled}
                onClick={() => onCreate(template.id, 'project')}
              >
                <Plus />
                创建项目扩展
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => onCreate(template.id, 'global')}
            >
              <Plus />
              创建全局扩展
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExtensionList({
  extensions,
  disabled,
  onOpen,
}: {
  extensions: ScoutExtensionListItem[];
  disabled: boolean;
  onOpen: (path: string) => void;
}) {
  if (extensions.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-24 items-center px-4 py-6 text-sm">
        暂无扩展文件
      </div>
    );
  }

  return (
    <div className="divide-border/70 divide-y">
      {extensions.map((extension) => (
        <button
          key={extension.path}
          type="button"
          disabled={disabled || !extension.exists}
          onClick={() => onOpen(extension.path)}
          className="hover:bg-muted/60 disabled:text-muted-foreground flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <FileCode2 className="text-muted-foreground size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{extension.name}</span>
            <span className="text-muted-foreground block truncate text-xs">{extension.path}</span>
          </span>
          <span className="border-border text-muted-foreground shrink-0 rounded-full border px-2 py-0.5 text-xs">
            {SCOPE_LABELS[extension.scope]}
          </span>
        </button>
      ))}
    </div>
  );
}

function PathRow({ label, path }: { label: string; path: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <PathValue path={path} />
    </div>
  );
}

function PathValue({ path }: { path: string }) {
  return (
    <div className="border-border/70 bg-muted/30 text-muted-foreground flex min-h-9 items-center gap-2 rounded-md border px-3 font-mono text-xs">
      <Folder className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{path || '-'}</span>
    </div>
  );
}
