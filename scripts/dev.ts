const server = Bun.spawn(["bun", "run", "dev:server"], { stdout: "inherit", stderr: "inherit" });
const web = Bun.spawn(["bunx", "vite"], { stdout: "inherit", stderr: "inherit" });

process.on("SIGINT", () => {
  server.kill();
  web.kill();
  process.exit();
});

await Promise.race([server.exited, web.exited]);
server.kill();
web.kill();