// ============================================================
// Scout Webview — Surface 入口分发
// ============================================================

import { useWebviewBootstrap } from '@/bridge/use-webview-bootstrap';
import { ChatApp } from '@/surfaces/chat/ChatApp';
import { SettingsApp } from '@/surfaces/settings/SettingsApp';
import { TreeApp } from '@/surfaces/tree/TreeApp';

function App() {
  const surface = useWebviewBootstrap();

  if (surface === 'settings') return <SettingsApp />;
  if (surface === 'tree') return <TreeApp />;
  return <ChatApp />;
}

export default App;
