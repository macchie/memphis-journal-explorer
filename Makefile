.PHONY: install dev build typecheck

install:
	bun install

dev:
	exec bun run dev

build:
	bun run build

typecheck:
	bun run typecheck
