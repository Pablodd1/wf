import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'plugin-inspect-react-code'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { preparePublicAssets } = require('./tools/prepare-public-assets.cjs')

// https://vite.dev/config/
export default defineConfig({
  base: './',
  publicDir: preparePublicAssets(__dirname),
  define: {
    'import.meta.env.VITE_APP_BUILD_ID': JSON.stringify(
      process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || 'local',
    ),
  },
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-charts': ['recharts'],
          'vendor-motion': ['framer-motion'],
          'vendor-react': ['react', 'react-dom', 'react-router'],
          'vendor-xlsx': ['xlsx'],
        },
      },
    },
  },
});
