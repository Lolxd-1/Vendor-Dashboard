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