// ============================================================
// Approval Mode Menu — 审批模式入口
// ============================================================

import { useState } from 'react';
import { ChevronDown, Hand } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ApprovalModeMenu() {
  const [approvalLabel, setApprovalLabel] = useState('请求批准');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="text-muted-foreground min-w-0" size="sm" type="button" variant="ghost">
          <Hand />
          <span className="truncate">{approvalLabel}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuItem onSelect={() => setApprovalLabel('请求批准')}>请求批准</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setApprovalLabel('自动批准')}>自动批准</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setApprovalLabel('仅查看')}>仅查看</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
