// ============================================================
// Prompts Tab — 全局 Prompt 资源页
// ============================================================

import { useState } from 'react';
import type { PromptSettingsController } from '../hooks/prompt-settings-state';
import { CreatePromptDialog } from './CreatePromptDialog';
import { PromptDiagnosticsSection } from './PromptDiagnosticsSection';
import { PromptListSection } from './PromptListSection';

export function PromptsTab({ controller }: { controller: PromptSettingsController }) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const disabled = controller.isLoading || controller.isSaving;

  const createPrompt = () => {
    const name = newName.trim();
    if (!name) return;
    controller.createPrompt(name);
    setCreateDialogOpen(false);
    setNewName('');
  };

  return (
    <div className="mx-auto box-border flex w-full max-w-5xl min-w-0 flex-col gap-4 px-8 py-5 pr-10 max-[720px]:px-5 max-[720px]:pr-7">
      {controller.error ? <ErrorBanner message={controller.error} /> : null}

      <PromptListSection
        controller={controller}
        disabled={disabled}
        onCreate={() => setCreateDialogOpen(true)}
      />
      <PromptDiagnosticsSection diagnostics={controller.settings.diagnostics} />
      <CreatePromptDialog
        open={createDialogOpen}
        name={newName}
        disabled={disabled}
        onOpenChange={setCreateDialogOpen}
        onNameChange={setNewName}
        onCreate={createPrompt}
      />
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
      {message}
    </div>
  );
}
