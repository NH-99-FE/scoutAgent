// ============================================================
// Tree Actions Menu — 会话树工具栏菜单
// ============================================================

import { Leaf, MoreHorizontal, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function TreeActionsMenu({
  onRefresh,
  onRevealCurrentLeaf,
}: {
  onRefresh: () => void;
  onRevealCurrentLeaf: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="更多会话树操作"
          className="size-6 rounded-full"
          size="icon"
          type="button"
          variant="ghost"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="bg-background text-foreground w-44 rounded-lg p-2 shadow-sm"
      >
        <DropdownMenuItem className="text-[12px]" onSelect={onRefresh}>
          <RefreshCw />
          <span>刷新</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="text-[12px]" onSelect={onRevealCurrentLeaf}>
          <Leaf />
          <span>定位当前叶子</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
