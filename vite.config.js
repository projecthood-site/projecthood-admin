import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config. The /api folder holds Vercel serverless functions and is
// intentionally NOT bundled by Vite — Vercel picks those up automatically.
export default defineConfig({
  plugins: [react()],
});
