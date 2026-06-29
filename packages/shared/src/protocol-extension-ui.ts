// ============================================================
// Shared Extension UI 协议契约：跨 host/webview 的结构化请求
// ============================================================

// ---------- Extension UI 请求 ----------

export interface ScoutExtensionUIRequestBase {
  type: 'extension_ui_request';
  id: string;
  title: string;
  timeout?: number;
  variant?: 'default' | 'danger';
  body?: { kind: 'text' | 'code'; text: string };
}

export type ScoutExtensionUIRequest =
  | (ScoutExtensionUIRequestBase & {
      method: 'confirm';
      message: string;
    })
  | (ScoutExtensionUIRequestBase & {
      method: 'select';
      options: string[];
    })
  | (ScoutExtensionUIRequestBase & {
      method: 'input';
      placeholder?: string;
    });

export type ScoutExtensionUIRequestClosedReason =
  | 'responded'
  | 'cancelled'
  | 'timeout'
  | 'aborted'
  | 'session_replacement'
  | 'disposed';

export interface ScoutExtensionUIRequestClosedEvent {
  type: 'extension_ui_request_closed';
  id: string;
  reason: ScoutExtensionUIRequestClosedReason;
}
