import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig(({ mode }) => ({
  root: 'src/renderer', base: './', plugins: [react(), tailwind(), {
    name: 'local-development-csp',
    transformIndexHtml(html, context) {
      // React HMR needs an inline preamble on the loopback-only dev server.
      return context.server ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") : html;
    },
  }],
  build: { outDir: mode === 'web' ? '../../dist/web' : '../../dist/renderer', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
}));
