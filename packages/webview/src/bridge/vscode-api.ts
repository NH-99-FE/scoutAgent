// ============================================================
// VS Code API — Webview postMessage 封装
// ============================================================

interface VsCodeApi<TState = unknown> {
  getState: () => TState | undefined;
  setState: (state: TState) => void;
  postMessage: (message: unknown) => void;
}

declare global {
  function acquireVsCodeApi<TState = unknown>(): VsCodeApi<TState>;
}

let cachedApi: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  if (cachedApi) return cachedApi;
  if (typeof acquireVsCodeApi === 'function') {
    cachedApi = acquireVsCodeApi();
    return cachedApi;
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
  return cachedApi;
}
