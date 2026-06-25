// Sobe TUDO (frontend + backend) num único servidor na porta 4000, com
// hot-reload em tempo real (Vite embutido no Express). Sem build, sem 2 portas.
import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

console.log("Subindo em modo desenvolvimento (hot-reload)...");
console.log("Abra  http://localhost:4000   ·   Ctrl+C encerra.\n");

const child = spawn(npmCmd, ["run", "dev:server"], {
  shell: isWindows, // .cmd precisa de shell no Windows
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "development" },
});

const stop = () => {
  try {
    child.kill();
  } catch {
    /* ignore */
  }
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
