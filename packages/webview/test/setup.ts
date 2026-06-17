import '@testing-library/jest-dom/vitest';

class MockResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}

  observe() {}

  unobserve() {}

  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: MockResizeObserver,
});
