import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      injectRegister: false,
      registerType: 'autoUpdate',
      includeAssets: ['LOGON1.png'],
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        name: 'קמרה סאונד APP',
        short_name: 'קמרה סאונד APP',
        description: 'מערכת המחסן הדיגיטלי',
        theme_color: '#f5a623',
        background_color: '#0a0c10',
        display: 'standalone',
        icons: [
          {
            src: 'LOGON1.png',
            sizes: '192x192 512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
})
