// Each service owns a process group so Ctrl+C can terminate its complete process tree, including
// watcher children that Bun or bunx may start internally.
const server = Bun.spawn(["setsid", "bun", "--watch", "server/index.ts"], { stdout: "inherit", stderr: "inherit" });
const web = Bun.spawn(["setsid", "bunx", "vite"], { stdout: "inherit", stderr: "inherit" });

let stopping = false;
async function stop(signal: "SIGINT" | "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of [server, web]) {
    try { process.kill(-child.pid, signal); }
    catch { child.kill(signal); }
  }
  await Promise.allSettled([server.exited, web.exited]);
  process.exit(0);
}

process.once("SIGINT", () => { void stop("SIGINT"); });
process.once("SIGTERM", () => { void stop("SIGTERM"); });

await Promise.race([server.exited, web.exited]);
await stop("SIGTERM");