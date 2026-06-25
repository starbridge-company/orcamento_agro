import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// O Vite roda embutido no Express (middleware mode), na mesma porta do backend.
// root = raiz do projeto (onde está o index.html). envDir = raiz por padrão,
// então o Vite lê o .env ÚNICO da raiz (só expõe variáveis VITE_*).
export default defineConfig({
  plugins: [react()],
  server: {
    // OneDrive/Windows quebram o watcher padrão; polling garante o hot-reload.
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
});
