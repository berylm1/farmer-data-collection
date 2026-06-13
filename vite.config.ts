import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Helper to create RegExp strings for workbox (avoids TS parsing issues)
const regex = (pattern: string, flags = 'i') => new RegExp(pattern, flags);

const pwaPlugin = VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
  manifest: {
    name: 'AgriFinance Platform',
    short_name: 'AgriFinance',
    description: 'Comprehensive agricultural data collection and financial management platform',
    theme_color: '#16a34a',
    background_color: '#ffffff',
    display: 'standalone',
    orientation: 'portrait-primary',
    scope: '/',
    start_url: '/',
    categories: ['finance', 'business', 'productivity'],
    icons: [
      { src: '/icons/icon-72x72.png', sizes: '72x72', type: 'image/png', purpose: 'maskable any' },
      { src: '/icons/icon-96x96.png', sizes: '96x96', type: 'image/png', purpose: 'maskable any' },
      { src: '/icons/icon-128x128.png', sizes: '128x128', type: 'image/png', purpose: 'maskable any' },
      { src: '/icons/icon-144x144.png', sizes: '144x144', type: 'image/png', purpose: 'maskable any' },
      { src: '/icons/icon-152x152.png', sizes: '152x152', type: 'image/png', purpose: 'maskable any' },
      { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable any' },
      { src: '/icons/icon-384x384.png', sizes: '384x384', type: 'image/png', purpose: 'maskable any' },
      { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable any' }
    ],
    shortcuts: [
      { name: 'Dashboard', short_name: 'Dashboard', description: 'View your dashboard', url: '/', icons: [{ src: '/icons/icon-96x96.png', sizes: '96x96' }] },
      { name: 'Add Farmer', short_name: 'Add Farmer', description: 'Register a new farmer', url: '/quick-farmer-registration', icons: [{ src: '/icons/icon-96x96.png', sizes: '96x96' }] },
      { name: 'Farm Geotagging', short_name: 'Geotagging', description: 'Capture farm boundaries', url: '/farm-geotagging', icons: [{ src: '/icons/icon-96x96.png', sizes: '96x96' }] }
    ]
  },
  workbox: {
    maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
    runtimeCaching: [
      {
        urlPattern: regex('^https?://.*/api/.*'),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'api-cache',
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
          networkTimeoutSeconds: 10,
          cacheableResponse: { statuses: [0, 200] }
        }
      },
      {
        urlPattern: regex('^https://fonts\\.googleapis\\.com/.*'),
        handler: 'NetworkOnly',
        options: {
          cacheName: 'google-fonts-css',
          networkTimeoutSeconds: 10,
          cacheableResponse: { statuses: [0, 200] }
        }
      },
      {
        urlPattern: regex('^https://fonts\\.gstatic\\.com/.*'),
        handler: 'CacheFirst',
        options: {
          cacheName: 'google-fonts-files',
          expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
          cacheableResponse: { statuses: [0, 200] }
        }
      },
      {
        urlPattern: regex('\\.(?:png|jpg|jpeg|svg|gif|webp)$'),
        handler: 'CacheFirst',
        options: {
          cacheName: 'image-cache',
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }
        }
      },
      {
        urlPattern: regex('\\.(?:woff|woff2|ttf|otf|eot)$'),
        handler: 'CacheFirst',
        options: {
          cacheName: 'font-cache',
          expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }
        }
      },
      {
        urlPattern: regex('\\.(?:js|css)$'),
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'static-cache',
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 }
        }
      },
      {
        urlPattern: regex('^https?://.*/(tiles|mapbox|maptiler)/.*'),
        handler: 'CacheFirst',
        options: {
          cacheName: 'map-tile-cache',
          expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 }
        }
      }
    ],
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    skipWaiting: true,
    clientsClaim: true,
    cleanupOutdatedCaches: true
  },
  devOptions: {
    enabled: true,
    type: 'module'
  }
});

const copySqlWasmPlugin = {
  name: 'copy-sql-wasm',
  writeBundle() {
    const src = path.resolve(__dirname, 'node_modules/sql.js/dist/sql-wasm.wasm');
    const dest = path.resolve(__dirname, 'dist/public/sql-wasm.wasm');
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log('[Vite] Copied sql-wasm.wasm to dist/public/');
    }
  }
};

export default defineConfig({
  plugins: [react(), tailwindcss(), pwaPlugin, copySqlWasmPlugin],
  optimizeDeps: {},
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-radix': [
            '@radix-ui/react-accordion', '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu', '@radix-ui/react-select',
            '@radix-ui/react-tabs', '@radix-ui/react-tooltip',
            '@radix-ui/react-popover', '@radix-ui/react-checkbox',
          ],
          'vendor-charts': ['recharts'],
          'vendor-map': ['maplibre-gl'],
          'vendor-query': ['@tanstack/react-query', '@trpc/client', '@trpc/react-query'],
          'vendor-i18n': ['i18next', 'react-i18next'],
          'vendor-forms': ['react-hook-form', 'zod'],
        },
      },
    },
  },
  server: {
    port: 3000,
    strictPort: false,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});