import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const base = loadEnv(mode, '.', '').VITE_BASE_PATH || '/';

  return {
    base,
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 4175,
    },
    preview: {
      host: '127.0.0.1',
      port: 4175,
    },
  };
});
