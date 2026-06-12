import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // 输出到 extension 包，作为静态资源被加载
    outDir: path.resolve(__dirname, '../extension/dist/webview'),
    emptyOutDir: true,
  },
  // VS Code webview 安全限制：不允许 inline script/style
  // Vite 开发模式默认用 inline，生产模式没问题
  server: {
    // 开发时 webview 可能通过特定端口访问
    port: 5173,
    strictPort: true,
  },
});
