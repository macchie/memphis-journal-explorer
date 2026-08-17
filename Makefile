.PHONY: install dev build typecheck start

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