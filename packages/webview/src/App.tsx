// ============================================================
// Scout Webview — Surface 入口分发
// ============================================================

import { useWebviewBootstrap } from '@/bridge/use-webview-bootstrap';
import { ChatApp } from '@/chat/ChatApp';
import { SettingsApp } from '@/settings/SettingsApp';
import { TreeApp } from '@/tree/TreeApp';

function App() {
  const surface = useWebviewBootstrap();

  if (surface === 'settings') return <SettingsApp />;
  if (surface === 'tree') return <TreeApp />;
  return <ChatApp />;
}

export default App;
