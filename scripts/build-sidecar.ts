// Compiles the Bun API server into a standalone binary that Tauri ships as a sidecar.
// Tauri resolves `binaries/rdblog-server` to `rdblog-server-<target-triple>` at build/run time.
import { $ } from "bun";

const rustInfo = await $`rustc -vV`.text();
const triple = rustInfo.match(/host:\s*(\S+)/)?.[1];
if (!triple) {
  console.error("Failed to determine the host target triple from `rustc -vV`. Is Rust installed?");
  process.exit(1);
}

const ext = triple.includes("windows") ? ".exe" : "";
const outfile = `src-tauri/binaries/rdblog-server-${triple}${ext}`;

await $`mkdir -p src-tauri/binaries`;
console.log(`Compiling backend → ${outfile}`);
await $`bun build server/index.ts --compile --minify --outfile ${outfile}`;
console.log("Sidecar ready.");
