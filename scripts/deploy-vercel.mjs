import { spawn } from "node:child_process";

const child = spawn("npx", ["vercel", "deploy", "--yes"], {
  cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  shell: true,
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 1));
