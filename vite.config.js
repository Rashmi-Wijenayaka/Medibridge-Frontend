import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const envDir = globalThis.process?.cwd?.() || ''
  const env = loadEnv(mode, envDir, '')

  return {
    plugins: [react()],
    base: env.VITE_BASE_PATH || '/Medical-ChatBot',
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '/api')
        }
      }
    }
  }
})
