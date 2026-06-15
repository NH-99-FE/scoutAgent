// ============================================================
// Tree App — 会话树面板骨架
// ============================================================

import { GitBranch, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { protocolClient } from '@/bridge/protocol-client';
import { useTree, useTreeEditorText, useTreeLeafId, useTreeNodeCount } from '@/store/tree-store';

export function TreeApp() {
  const tree = useTree();
  const nodeCount = useTreeNodeCount();
  const leafId = useTreeLeafId();
  const editorText = useTreeEditorText();

  return (
    <main className="bg-background text-foreground min-h-screen">
      <header className="border-border flex items-center justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Scout Tree</h1>
          <p className="text-muted-foreground truncate text-xs">{leafId || 'No active leaf'}</p>
        </div>
        <Button size="sm" variant="outline" onClick={protocolClient.requestTree}>
          <RefreshCw />
          Refresh
        </Button>
      </header>

      <section className="border-border bg-border grid grid-cols-2 gap-px border-b text-xs">
        <Metric label="Nodes" value={String(nodeCount)} />
        <Metric label="Draft" value={editorText ? 'ready' : 'empty'} />
      </section>

      <section className="px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <GitBranch className="size-4" />
          Branches
        </div>
        <Separator className="my-3" />
        <div className="grid gap-2">
          {tree.length === 0 ? (
            <p className="text-muted-foreground text-sm">No tree data</p>
          ) : (
            tree.map((node) => (
              <TreeNodePreview key={node.id} label={node.label ?? node.preview ?? node.id} />
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background px-4 py-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-medium">{value}</p>
    </div>
  );
}

function TreeNodePreview({ label }: { label: string }) {
  return (
    <div className="border-border min-w-0 rounded-md border px-3 py-2 text-sm">
      <p className="truncate">{label}</p>
    </div>
  );
}
