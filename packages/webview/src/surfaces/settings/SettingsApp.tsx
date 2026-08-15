// ============================================================
// Settings App — 设置面板入口
// ============================================================

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Box,
  Check,
  FileText,
  PackagePlus,
  PanelLeft,
  Plug,
  RefreshCw,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  ExtensionsTab,
  ModelManagementTab,
  RuntimeSettingsTab,
  SkillsTab,
  PromptsTab,
  useCustomModelsController,
  useExtensionSettingsController,
  useRuntimeSettingsController,
  useSkillSettingsController,
  usePromptSettingsController,
} from '@/features/settings';

type SettingsTab = 'models' | 'runtime' | 'skills' | 'prompts' | 'extensions';

export function SettingsApp() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('models');
  const [pendingTab, setPendingTab] = useState<SettingsTab | null>(null);
  const customModels = useCustomModelsController(activeTab === 'models');
  const runtimeSettings = useRuntimeSettingsController(activeTab === 'runtime');
  const skills = useSkillSettingsController(activeTab === 'skills');
  const prompts = usePromptSettingsController(activeTab === 'prompts');
  const extensions = useExtensionSettingsController(activeTab === 'extensions');
  const activeController =
    activeTab === 'models'
      ? customModels
      : activeTab === 'runtime'
        ? runtimeSettings
        : activeTab === 'skills'
          ? skills
          : activeTab === 'prompts'
            ? prompts
            : extensions;
  const saveController =
    activeTab === 'models'
      ? customModels
      : activeTab === 'runtime'
        ? runtimeSettings
        : activeTab === 'skills'
          ? skills
          : activeTab === 'extensions'
            ? extensions
            : null;
  const title = SETTINGS_TAB_LABELS[activeTab];

  const selectTab = (tab: SettingsTab) => {
    if (tab === activeTab || activeController.isSaving) return;
    if (activeController.hasUnsavedChanges) {
      setPendingTab(tab);
      return;
    }
    setActiveTab(tab);
  };

  const discardAndSwitch = () => {
    if (!pendingTab) return;
    activeController.discard();
    setActiveTab(pendingTab);
    setPendingTab(null);
  };

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
        disabled={activeController.isSaving}
        onSelectTab={selectTab}
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
            {saveController ? (
              <Button
                size="sm"
                onClick={saveController.save}
                disabled={
                  saveController.isLoading || saveController.isSaving || !saveController.isDirty
                }
              >
                {saveController.saved ? <Check /> : <Save />}
                {saveController.isSaving ? '保存中' : saveController.saved ? '已保存' : '保存'}
              </Button>
            ) : null}
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          {activeTab === 'models' ? (
            <ModelManagementTab controller={customModels} />
          ) : activeTab === 'runtime' ? (
            <RuntimeSettingsTab controller={runtimeSettings} />
          ) : activeTab === 'skills' ? (
            <SkillsTab controller={skills} />
          ) : activeTab === 'prompts' ? (
            <PromptsTab controller={prompts} />
          ) : (
            <ExtensionsTab controller={extensions} />
          )}
        </ScrollArea>
      </main>

      <Dialog open={pendingTab !== null} onOpenChange={(open) => !open && setPendingTab(null)}>
        <DialogContent role="alertdialog">
          <DialogHeader>
            <DialogTitle>放弃未保存的修改？</DialogTitle>
            <DialogDescription>
              “{title}”中还有未保存的修改。切换分类后，这些修改将被放弃。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingTab(null)}>
              继续编辑
            </Button>
            <Button variant="destructive" onClick={discardAndSwitch}>
              放弃并切换
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  models: '模型管理',
  runtime: '运行设置',
  skills: 'Skills',
  prompts: 'Prompts',
  extensions: '扩展',
};

function SettingsSidebar({
  activeTab,
  collapsed,
  disabled,
  onSelectTab,
  onToggle,
}: {
  activeTab: SettingsTab;
  collapsed: boolean;
  disabled: boolean;
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
        className="text-muted-foreground hover:bg-control-hover hover:text-foreground ml-1 flex size-8 items-center justify-center rounded-full transition-colors"
      >
        <PanelLeft className="size-4" />
      </button>

      <nav className="mt-5 grid gap-1" aria-label="设置分类">
        <SidebarButton
          active={activeTab === 'models'}
          collapsed={collapsed}
          disabled={disabled}
          icon={<PackagePlus className="size-4 shrink-0" />}
          label="模型管理"
          onClick={() => onSelectTab('models')}
        />
        <SidebarButton
          active={activeTab === 'skills'}
          collapsed={collapsed}
          disabled={disabled}
          icon={<Box className="size-4 shrink-0" />}
          label="Skills"
          onClick={() => onSelectTab('skills')}
        />
        <SidebarButton
          active={activeTab === 'prompts'}
          collapsed={collapsed}
          disabled={disabled}
          icon={<FileText className="size-4 shrink-0" />}
          label="Prompts"
          onClick={() => onSelectTab('prompts')}
        />
        <SidebarButton
          active={activeTab === 'runtime'}
          collapsed={collapsed}
          disabled={disabled}
          icon={<SlidersHorizontal className="size-4 shrink-0" />}
          label="运行设置"
          onClick={() => onSelectTab('runtime')}
        />
        <SidebarButton
          active={activeTab === 'extensions'}
          collapsed={collapsed}
          disabled={disabled}
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
  disabled,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  collapsed: boolean;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      title={label}
      onClick={onClick}
      className={cn(
        'text-muted-foreground hover:bg-control-hover hover:text-foreground flex h-9 w-full items-center gap-2 overflow-hidden rounded-full px-3 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        active && 'bg-control-selected text-foreground',
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
