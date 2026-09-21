import { defineConfig} from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
 

  return {
    plugins: [react()],

    define: {
      global: "window",
    },

    // Relative base so `dist/` works from any HTTP origin/subpath
    // (e.g. http://prd.quickverse.in/vendor/) with no HTTPS requirement.
    base: "./",

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