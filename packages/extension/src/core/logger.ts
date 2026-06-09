// ============================================================
// Core logger/disposable contracts
// 负责：隔离 VS Code 宿主类型，让 core 模块只依赖最小接口。
// ============================================================

export interface CoreLogger {
  appendLine(message: string): void;
}

export interface CoreDisposable {
  dispose(): void;
}
