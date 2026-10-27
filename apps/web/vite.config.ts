import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_TARGET = process.env.PROTOCOL_API_URL ?? "http://127.0.0.1:3001";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
      "/uploads": { target: API_TARGET, changeOrigin: true },
      "/socket.io": { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
  preview: {
    host: true,
    port: 4173,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
      "/uploads": { target: API_TARGET, changeOrigin: true },
      "/socket.io": { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
});
