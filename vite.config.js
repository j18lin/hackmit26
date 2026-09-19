import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        // Preserve the browser-facing host for the API's same-origin check.
        changeOrigin: false,
      },
    },
  },
});
