.PHONY: install dev build typecheck start sidecar app-dev app

install:
	bun install

dev:
	bun run dev

build:
	bun run build

typecheck:
	bun run typecheck

start:
	bun run start

# Compile the Bun backend into the Tauri sidecar binary.
sidecar:
	bun run sidecar

# Run the desktop app in development (spawns the sidecar + Vite dev server).
app-dev: sidecar
	bunx --bun @tauri-apps/cli dev

# Build the distributable desktop app (bundle in src-tauri/target/release/bundle/).
app: sidecar
	bunx --bun @tauri-apps/cli build
