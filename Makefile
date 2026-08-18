.PHONY: install dev build typecheck start sidecar app-dev app

install:
	bun install

dev:
	exec bun run dev

build:
	bun run build

typecheck:
	bun run typecheck

start:
	bun run start

# Compile the Bun backend into the Tauri sidecar binary.
sidecar:
	bun run sidecar

# Run the desktop app in development.
#
# `tauri dev` is the single parent that starts everything in parallel:
#   * Vite dev server (:5173)       - Tauri's beforeDevCommand (bun run dev:web)
#   * The Tauri app (cargo run)     - hosts the webview
#   * rdblog-server sidecar (:3000) - spawned by the Rust app (src-tauri/src/lib.rs)
#
# On Ctrl-C the Rust app catches SIGINT/SIGTERM, kills the sidecar and exits
# cleanly, which lets `tauri dev` tear down Vite.
app-dev: sidecar
	exec bunx --bun @tauri-apps/cli dev

# Build the distributable desktop app (bundle in src-tauri/target/release/bundle/).
app: sidecar
	bunx --bun @tauri-apps/cli build
