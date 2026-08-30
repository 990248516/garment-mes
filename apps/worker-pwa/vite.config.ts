import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const base = loadEnv(mode, '.', '').VITE_BASE_PATH || '/';

  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: '云裁报工',
          short_name: '云裁报工',
          description: '服装制造一扎一码扫码报工',
          theme_color: '#173f37',
          background_color: '#f4f5ef',
          display: 'standalone',
          start_url: base,
          scope: base,
          icons: [
            {
              src: 'icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          navigateFallback: 'index.html',
          globPatterns: ['**/*.{js,css,html,svg}'],
        },
      }),
    ],
    server: {
      host: '127.0.0.1',
      port: 4174,
      proxy: {
        '/api': 'http://127.0.0.1:3000',
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 4174,
    },
  };
});
