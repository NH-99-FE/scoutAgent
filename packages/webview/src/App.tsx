// ============================================================
// Scout Webview — Surface 入口分发
// ============================================================

import { lazy, Suspense } from 'react';
import type { WebviewSurface } from '@/bridge/surface';
import { useWebviewBootstrap } from '@/bridge/use-webview-bootstrap';
import { AppNotificationToaster } from '@/components/common/AppNotificationToaster';
import { BootstrapErrorState } from '@/components/common/BootstrapErrorState';
import { BootstrapPendingState } from '@/components/common/BootstrapPendingState';
import { SettingsSurfaceSkeleton } from '@/surfaces/settings/SettingsSurfaceSkeleton';
import { TreeSurfaceSkeleton } from '@/surfaces/tree/TreeSurfaceSkeleton';
import { ChatApp } from '@/surfaces/chat/ChatApp';
import { type BootstrapStatus, useBootstrapError, useBootstrapStatus } from '@/store/ui-store';

const SettingsApp = lazy(() =>
  import('@/surfaces/settings/SettingsApp').then((module) => ({ default: module.SettingsApp })),
);
const TreeApp = lazy(() =>
  import('@/surfaces/tree/TreeApp').then((module) => ({ default: module.TreeApp })),
);

function App() {
  const surface = useWebviewBootstrap();
  const bootstrapError = useBootstrapError();
  const bootstrapStatus = useBootstrapStatus();

  return (
    <>
      <AppContent
        bootstrapError={bootstrapError}
        bootstrapStatus={bootstrapStatus}
        surface={surface}
      />
      <AppNotificationToaster />
    </>
  );
}

function AppContent({
  bootstrapError,
  bootstrapStatus,
  surface,
}: {
  bootstrapError?: string;
  bootstrapStatus: BootstrapStatus;
  surface: WebviewSurface;
}) {
  if (bootstrapStatus === 'failed') {
    return <BootstrapErrorState message={bootstrapError} />;
  }

  if (surface === 'chat') {
    return <ChatSurfaceContent bootstrapStatus={bootstrapStatus} />;
  }

  if (bootstrapStatus === 'pending') {
    return <SurfaceSkeleton surface={surface} />;
  }

  return <LazySurfaceContent surface={surface} />;
}

function ChatSurfaceContent({ bootstrapStatus }: { bootstrapStatus: BootstrapStatus }) {
  if (bootstrapStatus === 'ready') return <ChatApp />;
  return <BootstrapPendingState />;
}

function LazySurfaceContent({ surface }: { surface: Exclude<WebviewSurface, 'chat'> }) {
  const SurfaceApp = surface === 'settings' ? SettingsApp : TreeApp;

  return (
    <Suspense fallback={<SurfaceSkeleton surface={surface} />}>
      <SurfaceApp />
    </Suspense>
  );
}

function SurfaceSkeleton({ surface }: { surface: Exclude<WebviewSurface, 'chat'> }) {
  return surface === 'settings' ? <SettingsSurfaceSkeleton /> : <TreeSurfaceSkeleton />;
}

export default App;
