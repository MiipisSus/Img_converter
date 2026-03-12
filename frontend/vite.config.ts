import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

function getAppVersion(): string {
  // 1. Docker / CI：透過 VITE_APP_VERSION env 傳入（最可靠）
  if (process.env.VITE_APP_VERSION) return process.env.VITE_APP_VERSION
  // 2. 本地開發：從 git tag 取得
  try {
    return execSync('git describe --tags --abbrev=0 2>/dev/null').toString().trim()
  } catch {
    // 3. Fallback
    return 'dev-build'
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
