import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `vite build --mode standalone` genera la demo en navegador (API emulada con el motor real); no se despliega.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  root: 'web',
  define: mode === 'standalone' ? { 'import.meta.env.VITE_STANDALONE': JSON.stringify('1') } : {},
  build: { outDir: mode === 'standalone' ? '../dist/standalone' : '../dist/web', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } }
}));
