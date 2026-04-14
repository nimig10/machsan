import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Use a custom service worker so we can handle push notifications.
      // The build plugin injects the precache manifest into src/sw.js via
      // self.__WB_MANIFEST (handled with workbox-precaching).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectRegister: false,
      registerType: 'autoUpdate',
      includeAssets: ['LOGON1.png'],
      injectManifest: {
        // Main bundle is ~2.1 MB; default precache limit is 2 MiB, which
        // breaks the Vercel build. Raise to 5 MiB so the SW precaches the
        // full app shell.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'קמרה סאונד APP',
        short_name: 'קמרה סאונד APP',
        description: 'מערכת המחסן הדיגיטלי',
        id: '/',
        start_url: '/',
        scope: '/',
        theme_color: '#f5a623',
        background_color: '#0a0c10',
        display: 'standalone',
        lang: 'he',
        dir: 'rtl',
        icons: [
          {
            src: 'LOGON1.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'LOGON1.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'LOGON1.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ],
})
