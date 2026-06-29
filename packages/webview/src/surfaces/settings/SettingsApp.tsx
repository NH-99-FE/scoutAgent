// ============================================================
// Settings App — 设置面板入口
// ============================================================

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Check,
  PackagePlus,
  PanelLeft,
  Plug,
  RefreshCw,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { ExtensionsTab } from './ExtensionsTab';
import { ModelManagementTab } from './ModelManagementTab';
import { RuntimeSettingsTab } from './RuntimeSettingsTab';
import { useCustomModelsController } from './custom-models-state';
import { useExtensionSettingsController } from './extension-settings-state';
import { useRuntimeSettingsController } from './runtime-settings-state';

type SettingsTab = 'models' | 'runtime' | 'extensions';

export function SettingsApp() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('models');
  const customModels = useCustomModelsController();
  const runtimeSettings = useRuntimeSettingsController();
  const extensions = useExtensionSettingsController();
  const activeController =
    activeTab === 'models' ? customModels : activeTab === 'runtime' ? runtimeSettings : extensions;
  const title = activeTab === 'models' ? '模型管理' : activeTab === 'runtime' ? '运行设置' : '扩展';

  return (
    <div
      className="bg-tree-background text-foreground grid h-screen min-h-0 overflow-hidden transition-[grid-template-columns] duration-200 ease-out"
      style={
        {
          gridTemplateColumns: sidebarCollapsed ? '56px minmax(0,1fr)' : '192px minmax(0,1fr)',
        } satisfies CSSProperties
      }
    >
      <SettingsSidebar
        activeTab={activeTab}
        collapsed={sidebarCollapsed}
        onSelectTab={setActiveTab}
        onToggle={() => setSidebarCollapsed((current) => !current)}
      />

      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-8 pt-5 pb-3 max-[720px]:px-5">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={activeController.load}
              disabled={activeController.isLoading}
            >
              <RefreshCw />
              刷新
            </Button>
            <Button
              size="sm"
              onClick={activeController.save}
              disabled={
                activeController.isLoading || activeController.isSaving || !activeController.isDirty
              }
            >
              {activeController.saved ? <Check /> : <Save />}
              {activeController.isSaving ? '保存中' : activeController.saved ? '已保存' : '保存'}
            </Button>
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          {activeTab === 'models' ? (
            <ModelManagementTab controller={customModels} />
          ) : activeTab === 'runtime' ? (
            <RuntimeSettingsTab controller={runtimeSettings} />
          ) : (
            <ExtensionsTab controller={extensions} />
          )}
        </ScrollArea>
      </main>
    </div>
  );
}

function SettingsSidebar({
  activeTab,
  collapsed,
  onSelectTab,
  onToggle,
}: {
  activeTab: SettingsTab;
  collapsed: boolean;
  onSelectTab: (tab: SettingsTab) => void;
  onToggle: () => void;
}) {
  return (
    <aside className="bg-tree-background flex h-screen min-w-0 flex-col overflow-hidden px-2 py-5">
      <button
        type="button"
        aria-label={collapsed ? '展开设置侧边栏' : '折叠设置侧边栏'}
        title={collapsed ? '展开' : '折叠'}
        onClick={onToggle}
        className="text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 ml-1 flex size-8 items-center justify-center rounded-full transition-colors"
      >
        <PanelLeft className="size-4" />
      </button>

      <nav className="mt-5 grid gap-1" aria-label="设置分类">
        <SidebarButton
          active={activeTab === 'models'}
          collapsed={collapsed}
          icon={<PackagePlus className="size-4 shrink-0" />}
          label="模型管理"
          onClick={() => onSelectTab('models')}
        />
        <SidebarButton
          active={activeTab === 'runtime'}
          collapsed={collapsed}
          icon={<SlidersHorizontal className="size-4 shrink-0" />}
          label="运行设置"
          onClick={() => onSelectTab('runtime')}
        />
        <SidebarButton
          active={activeTab === 'extensions'}
          collapsed={collapsed}
          icon={<Plug className="size-4 shrink-0" />}
          label="扩展"
          onClick={() => onSelectTab('extensions')}
        />
      </nav>
    </aside>
  );
}

function SidebarButton({
  active,
  collapsed,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  collapsed: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      title={label}
      onClick={onClick}
      className={cn(
        'text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 flex h-9 w-full items-center gap-2 overflow-hidden rounded-full px-3 text-sm font-medium transition-colors',
        active && 'bg-muted text-foreground dark:bg-muted/50',
      )}
    >
      {icon}
      <span
        className={cn(
          'min-w-0 truncate transition-opacity duration-150',
          collapsed ? 'opacity-0' : 'opacity-100',
        )}
      >
        {label}
      </span>
    </button>
  );
}
