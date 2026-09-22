import { defineConfig} from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
 

  return {
    plugins: [react()],

    define: {
      global: "window",
    },

    // Absolute, never "./": with a relative base, a deep link or refresh on
    // /vendor/dashboard asks for /vendor/assets/*.js, the SPA rewrite answers
    // with index.html, and the dashboard renders blank. The router has no
    // basename, so the app only runs at a domain root anyway.
    base: "/",

    build: {
      outDir: "dist",
      sourcemap: false,
      rollupOptions: {
        output: {
          // Real vendor boundaries only, so the main chunk isn't one 776 kB blocker.
          manualChunks(id: string) {
            if (!id.includes("node_modules")) return;
            if (/[\\/]react(-dom)?[\\/]/.test(id)) return "vendor-react";
            if (/[\\/]@reduxjs[\\/]toolkit[\\/]/.test(id) || /[\\/]react-redux[\\/]/.test(id)) return "vendor-redux";
            if (/[\\/]@stomp[\\/]stompjs[\\/]/.test(id) || /[\\/]sockjs-client[\\/]/.test(id)) return "vendor-socket";
          },
        },
      },
    },

    server: {
      host: true,
      port: 5173,
    },

    preview: {
      port: 5173,
    },
  };
});