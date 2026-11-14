import { defineConfig } from 'vite';
import { offlineGame } from './scripts/pwa-build.ts';

export default defineConfig({
  base: './',
  plugins: [offlineGame()],
});
