import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60000,
  use: {
    channel: 'chrome', // 系统 Chrome,免浏览器下载(治理 1.11 环境受限记录)
    headless: true,
    baseURL: 'http://localhost:4173/',
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
