import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Single-file IIFE bundle for the Gmail content script (Chrome MV3). */
export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  build: {
    emptyOutDir: false,
    outDir: 'dist',
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/extension/contentApp.tsx'),
      output: {
        format: 'iife',
        entryFileNames: 'content-app.js',
        assetFileNames: 'extension-assets/[name][extname]',
      },
    },
  },
})
