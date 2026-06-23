// ============================================================
// Settings Actions Menu — 设置与会话导入入口
// ============================================================

import { Settings, Upload } from 'lucide-react';
import { protocolClient } from '@/bridge/protocol-client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function SettingsActionsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="设置"
          className="text-current"
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <Settings />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="bg-background text-foreground w-36 rounded-lg p-2 shadow-sm"
      >
        <DropdownMenuItem className="text-[12px]" onSelect={protocolClient.openSettingsPanel}>
          <Settings />
          <span>Scout 设置</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="text-[12px]" onSelect={protocolClient.pickImportSession}>
          <Upload />
          <span>导入会话</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
