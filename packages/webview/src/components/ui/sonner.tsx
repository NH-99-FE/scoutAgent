// ============================================================
// Toaster — 基于 sonner 的全局 toast；主题对齐 VSCode 注入的 body class
// ============================================================

import { useEffect, useState, type CSSProperties } from 'react';
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

type VscodeTheme = 'light' | 'dark';

function readVscodeTheme(): VscodeTheme {
  if (typeof document === 'undefined') return 'light';
  const { classList } = document.body;
  return classList.contains('vscode-dark') || classList.contains('vscode-high-contrast')
    ? 'dark'
    : 'light';
}

function useVscodeTheme(): VscodeTheme {
  const [theme, setTheme] = useState<VscodeTheme>(readVscodeTheme);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const update = () => setTheme(readVscodeTheme());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useVscodeTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
