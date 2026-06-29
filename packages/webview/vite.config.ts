import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

function manualChunks(id: string): string | undefined {
  if (!id.includes('/node_modules/')) return undefined;
  if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
    return 'vendor-react';
  }
  if (id.includes('/react-markdown/') || id.includes('/remark-gfm/')) {
    return 'vendor-markdown';
  }
  if (id.includes('/radix-ui/') || id.includes('/lucide-react/') || id.includes('/sonner/')) {
    return 'vendor-ui';
  }
  return 'vendor';
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // extension package 脚本会复制该目录到 extension/dist/webview
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        manualChunks,
      },
    },
  },
  // VS Code webview 安全限制：不允许 inline script/style
  // Vite 开发模式默认用 inline，生产模式没问题
  server: {
    // 开发时 webview 可能通过特定端口访问
    port: 5173,
    strictPort: true,
    cors: true,
  },
});
