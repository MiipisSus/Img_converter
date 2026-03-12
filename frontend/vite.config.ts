import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

function getAppVersion(): string {
  // Docker build 時透過 VITE_APP_VERSION env 傳入
  if (process.env.VITE_APP_VERSION) return process.env.VITE_APP_VERSION
  // 本地開發：從 git tag 取得
  try {
    return execSync('git describe --tags --abbrev=0 2>/dev/null').toString().trim()
  } catch {
    return 'dev'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(getAppVersion()),
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
