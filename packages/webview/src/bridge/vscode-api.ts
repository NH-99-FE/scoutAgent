// ============================================================
// VS Code API — Webview postMessage 封装
// ============================================================

export interface VsCodeApi<TState = unknown> {
  getState: () => TState | undefined;
  setState: (state: TState) => void;
  postMessage: (message: unknown) => void;
}

declare global {
  function acquireVsCodeApi<TState = unknown>(): VsCodeApi<TState>;
}

let cachedApi: VsCodeApi<unknown> | undefined;

export function getVsCodeApi<TState = unknown>(): VsCodeApi<TState> {
  if (cachedApi) return cachedApi as VsCodeApi<TState>;
  if (typeof acquireVsCodeApi === 'function') {
    cachedApi = acquireVsCodeApi();
    return cachedApi as VsCodeApi<TState>;
  }

  cachedApi = {
    getState: () => undefined,
    setState: () => undefined,
    postMessage: (message) => {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
        return;
      }
      console.warn('[scout:webview] postMessage fallback', message);
    },
  };
  return cachedApi as VsCodeApi<TState>;
}
