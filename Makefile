.PHONY: install build dev clean lint lint-fix format format-check typecheck check test pack ci

## Install dependencies
install:
	npm ci

## Compile TypeScript
build:
	npm run build

## Run in dev mode (watch + tsx)
dev:
	npm run dev

## Remove build artifacts
clean:
	npm run clean

## Run ESLint
lint:
	npm run lint

## Run ESLint with auto-fix
lint-fix:
	npm run lint:fix

## Check formatting
format-check:
	npm run format:check

## Auto-format all files
format:
	npm run format

## Type-check without emitting
typecheck:
	npm run typecheck

## Run tests
test:
	npm test

## All static checks (lint + format + types)
check: lint format-check typecheck

## Package as installable tarball
pack: clean build
	npm pack

## Full CI pipeline
ci: install check build test
