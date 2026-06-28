/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import { loadEnv, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const DEFAULT_HTTP_TARGET = 'http://localhost:8000'
const DEFAULT_WS_TARGET = 'ws://localhost:8000'

function withLeadingSlash(pathname: string): string {
  if (!pathname.startsWith('/')) return `/${pathname}`
  return pathname
}

function withoutTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

function withTrailingSlash(pathname: string): string {
  return pathname.endsWith('/') ? pathname : `${pathname}/`
}

function toWsTarget(httpTarget: string): string {
  if (httpTarget.startsWith('https://')) return `wss://${httpTarget.slice(8)}`
  if (httpTarget.startsWith('http://')) return `ws://${httpTarget.slice(7)}`
  return httpTarget
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const httpTarget = env.VITE_DEV_PROXY_TARGET || env.VITE_API_BASE_URL || DEFAULT_HTTP_TARGET
  const wsTarget = env.VITE_DEV_PROXY_WS_TARGET || env.VITE_WS_BASE_URL || toWsTarget(httpTarget)

  const apiPrefix = withoutTrailingSlash(withLeadingSlash(env.VITE_API_PREFIX || '/api/v1'))
  const wsPath = withTrailingSlash(withLeadingSlash(env.VITE_WS_PATH || '/ws/subscribe/'))
  const healthPath = withLeadingSlash(env.VITE_HEALTH_PATH || '/health/v1')

  const proxy: Record<string, ProxyOptions> = {
    [apiPrefix]: {
      target: httpTarget,
      changeOrigin: true,
    },
    [healthPath]: {
      target: httpTarget,
      changeOrigin: true,
    },
    [wsPath]: {
      target: wsTarget,
      changeOrigin: true,
      ws: true,
    },
  }

  return {
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
      proxy,
    },
    preview: {
      proxy,
    },
    build: {
      manifest: true,
      sourcemap: mode !== 'production',
      target: ['es2022', 'chrome108', 'safari16'],
      chunkSizeWarningLimit: 1500,
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
    },
  }
})
