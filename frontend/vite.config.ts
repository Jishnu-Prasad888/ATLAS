/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    watch: {
      ignored: [
        '**/bak_outputs/**',
        '**/coverage/**',
        '**/dist/**',
        '**/.vite/**',
      ],
      usePolling: process.env.VITE_USE_POLLING === '1',
      interval: 1000,
    },
    proxy: {
      '/api/v1/': {
        target:'http://localhost:8000',
        changeOrigin: true,
      },
      '/health/v1': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws/v1/': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
