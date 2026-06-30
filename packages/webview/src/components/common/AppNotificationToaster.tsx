// ============================================================
// App Notification Toaster — 应用级通知投影
// ============================================================

import { useEffect } from 'react';
import { toast } from 'sonner';
import type { ScoutNotificationMessage } from '@scout-agent/shared';
import { Toaster } from '@/components/ui/sonner';
import { useNotification, useUiActions } from '@/store/ui-store';

export function AppNotificationToaster() {
  const notification = useNotification();
  const uiActions = useUiActions();

  useEffect(() => {
    if (!notification) return;
    showNotificationToast(notification);
    uiActions.setNotification(undefined);
  }, [notification, uiActions]);

  return <Toaster position="top-center" />;
}

function showNotificationToast(notification: ScoutNotificationMessage): void {
  const options = {
    id: `${notification.level}:${notification.message}`,
  };
  if (notification.level === 'error') {
    toast.error(notification.message, options);
    return;
  }
  if (notification.level === 'warning') {
    toast.warning(notification.message, options);
    return;
  }
  if (notification.level === 'success') {
    toast.success(notification.message, options);
    return;
  }
  toast.info(notification.message, options);
}
