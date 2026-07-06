import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScoutExtensionUIRequest } from '@scout-agent/shared';

const { extensionUIResponse } = vi.hoisted(() => ({
  extensionUIResponse: vi.fn(),
}));

vi.mock('@/bridge/protocol-client', () => ({
  protocolClient: {
    extensionUIResponse,
  },
}));

import { ConversationExtensionRequestCard } from '@/features/conversation/ConversationExtensionRequestsPanel';
import { useUiStore } from '@/store/ui-store';

describe('ConversationExtensionRequestCard', () => {
  afterEach(() => {
    cleanup();
    extensionUIResponse.mockClear();
    useUiStore.getState().actions.reset();
  });

  it('renders danger code body without parsing the title', () => {
    render(
      <ConversationExtensionRequestCard
        request={{
          type: 'extension_ui_request',
          id: 'approval-1',
          method: 'select',
          title: '危险命令',
          options: ['Yes', 'No'],
          variant: 'danger',
          body: { kind: 'code', text: 'sudo rm -rf tmp' },
        }}
      />,
    );

    expect(screen.getByText('危险命令')).toBeInTheDocument();
    expect(screen.getByText('sudo rm -rf tmp')).toHaveAttribute(
      'data-scout-nested-scroll',
      'vertical',
    );
  });

  it('sends confirm, select, input, and cancel actions', () => {
    const { rerender } = render(
      <ConversationExtensionRequestCard
        request={makeRequest({ method: 'confirm', message: 'Proceed?' })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '批准' }));
    expect(extensionUIResponse).toHaveBeenLastCalledWith({
      id: 'approval-1',
      action: 'confirm',
    });

    rerender(
      <ConversationExtensionRequestCard
        request={makeRequest({ method: 'select', options: ['Option A', 'Option B'] })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Option B' }));
    expect(extensionUIResponse).toHaveBeenLastCalledWith({
      id: 'approval-1',
      action: 'select',
      value: 'Option B',
    });

    rerender(
      <ConversationExtensionRequestCard
        request={makeRequest({ method: 'input', placeholder: 'Name' })}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Scout' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(extensionUIResponse).toHaveBeenLastCalledWith({
      id: 'approval-1',
      action: 'input',
      value: 'Scout',
    });

    fireEvent.click(screen.getByRole('button', { name: '取消请求' }));
    expect(extensionUIResponse).toHaveBeenLastCalledWith({
      id: 'approval-1',
      action: 'cancel',
    });
  });
});

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function makeRequest(request: DistributiveOmit<ScoutExtensionUIRequest, 'id' | 'title' | 'type'>) {
  return {
    id: 'approval-1',
    title: 'Request',
    type: 'extension_ui_request',
    ...request,
  } as ScoutExtensionUIRequest;
}
