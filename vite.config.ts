import { defineConfig } from 'vite';

export default defineConfig({
  // Capacitor는 file:// 기반이라 상대 경로 필수
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
  },
});
