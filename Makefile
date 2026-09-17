.PHONY: install dev build typecheck app-dev app

install:
	bun install

dev:
	exec bun run dev

build:
	bun run build

typecheck:
	bun run typecheck

# Run the desktop app in development.
app-dev:
	exec bunx --bun @tauri-apps/cli dev

# Build the distributable desktop app (bundle in src-tauri/target/release/bundle/).
app:
	bunx --bun @tauri-apps/cli build
