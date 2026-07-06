// ============================================================
// Conversation Extension Requests Panel — 会话内扩展交互请求
// ============================================================

import { useState } from 'react';
import { CircleHelp, ShieldAlert, X } from 'lucide-react';
import type { ScoutExtensionUIRequest } from '@scout-agent/shared';
import { protocolClient, type ExtensionUIResponsePayload } from '@/bridge/protocol-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getNestedScrollBoundaryProps } from '@/components/ui/nested-scroll-boundary';
import { cn } from '@/lib/utils';
import { useExtensionUIRequests, useUiActions } from '@/store/ui-store';

interface ConversationExtensionRequestsPanelProps {
  requests?: ScoutExtensionUIRequest[];
}

export function ConversationExtensionRequestsPanel({
  requests,
}: ConversationExtensionRequestsPanelProps) {
  const storedRequests = useExtensionUIRequests();
  const visibleRequests = requests ?? storedRequests;
  if (visibleRequests.length === 0) return null;
  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-2 px-1 py-1">
      {visibleRequests.map((request) => (
        <ConversationExtensionRequestCard key={request.id} request={request} />
      ))}
    </div>
  );
}

export function ConversationExtensionRequestCard({
  request,
}: {
  request: ScoutExtensionUIRequest;
}) {
  const [value, setValue] = useState('');
  const uiActions = useUiActions();
  const isDanger = request.variant === 'danger';

  const respond = (payload: ExtensionUIResponsePayload) => {
    uiActions.removeExtensionUIRequest(request.id);
    protocolClient.extensionUIResponse(payload);
  };

  const cancel = () => respond({ id: request.id, action: 'cancel' });
  const Icon = isDanger ? ShieldAlert : CircleHelp;

  return (
    <section
      className={cn(
        'border-border/70 bg-muted/30 text-foreground flex w-full min-w-0 flex-col gap-2 rounded-lg border px-3 py-2',
        isDanger && 'border-destructive/35 bg-destructive/5',
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          className={cn(
            'mt-0.5 size-4 shrink-0',
            isDanger ? 'text-destructive' : 'text-muted-foreground',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{request.title}</div>
          <RequestBody request={request} />
        </div>
        <Button aria-label="取消请求" size="icon-xs" type="button" variant="ghost" onClick={cancel}>
          <X />
        </Button>
      </div>

      {request.method === 'confirm' ? (
        <div className="flex justify-end gap-2">
          <Button size="sm" type="button" variant="ghost" onClick={cancel}>
            拒绝
          </Button>
          <Button
            size="sm"
            type="button"
            onClick={() => respond({ id: request.id, action: 'confirm' })}
          >
            批准
          </Button>
        </div>
      ) : null}

      {request.method === 'select' ? (
        <SelectRequestActions cancel={cancel} request={request} respond={respond} />
      ) : null}

      {request.method === 'input' ? (
        <form
          className="flex min-w-0 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            respond({ id: request.id, action: 'input', value });
          }}
        >
          <Input
            autoFocus
            placeholder={request.placeholder}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <Button size="sm" type="button" variant="ghost" onClick={cancel}>
            取消
          </Button>
          <Button size="sm" type="submit">
            发送
          </Button>
        </form>
      ) : null}
    </section>
  );
}

function RequestBody({ request }: { request: ScoutExtensionUIRequest }) {
  if (request.body) {
    return (
      <pre
        {...getNestedScrollBoundaryProps('vertical')}
        className={cn(
          'scout-native-scrollbar text-muted-foreground mt-1 max-h-28 overflow-auto text-xs break-words whitespace-pre-wrap',
          request.body.kind === 'code' && 'font-mono',
        )}
      >
        {request.body.text}
      </pre>
    );
  }

  if (request.method === 'confirm') {
    return <div className="text-muted-foreground mt-1 text-xs">{request.message}</div>;
  }
  if (request.method === 'input') {
    return <div className="text-muted-foreground mt-1 text-xs">请输入内容</div>;
  }
  return null;
}

function SelectRequestActions({
  cancel,
  request,
  respond,
}: {
  cancel: () => void;
  request: Extract<ScoutExtensionUIRequest, { method: 'select' }>;
  respond: (payload: ExtensionUIResponsePayload) => void;
}) {
  const yesNo = getYesNoOptions(request.options);
  if (yesNo) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => respond({ id: request.id, action: 'select', value: yesNo.no })}
        >
          拒绝
        </Button>
        <Button
          size="sm"
          type="button"
          onClick={() => respond({ id: request.id, action: 'select', value: yesNo.yes })}
        >
          允许
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button size="sm" type="button" variant="ghost" onClick={cancel}>
        取消
      </Button>
      {request.options.map((option) => (
        <Button
          key={option}
          size="sm"
          type="button"
          variant="outline"
          onClick={() => respond({ id: request.id, action: 'select', value: option })}
        >
          {option}
        </Button>
      ))}
    </div>
  );
}

function getYesNoOptions(options: string[]): { yes: string; no: string } | undefined {
  const yes = options.find((option) => option.toLowerCase() === 'yes');
  const no = options.find((option) => option.toLowerCase() === 'no');
  if (!yes || !no || options.length !== 2) return undefined;
  return { yes, no };
}
