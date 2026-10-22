import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve('electron/main/index.ts'),
      },
    },
    resolve: {
      alias: {
        '@shared': resolve('shared'),
        '@core': resolve('core'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve('electron/preload/index.ts'),
      },
    },
    resolve: {
      alias: {
        '@shared': resolve('shared'),
      },
    },
  },
  renderer: {
    root: resolve('.'),
    build: {
      rollupOptions: {
        input: resolve('index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve('src'),
        '@shared': resolve('shared'),
      },
    },
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 43123,
      strictPort: true,
      proxy: {
        '/rpc': {
          target: 'http://127.0.0.1:43921',
          changeOrigin: true,
        },
      },
    },
  },
})
