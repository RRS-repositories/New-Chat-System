import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: the chat-server runs on 5020; proxy API + socket so the browser sees one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3020, host: '0.0.0.0',
    proxy: {
      '/api': { target: process.env.CHAT_DEV_API || 'http://127.0.0.1:5020', changeOrigin: true },
      '/socket.io': { target: process.env.CHAT_DEV_API || 'http://127.0.0.1:5020', ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, emptyOutDir: true },
});
