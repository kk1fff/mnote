.PHONY: dev desktop-test desktop-mac desktop-mac-smoke

dev:
	./scripts/dev.sh

desktop-test:
	cargo build
	npm --prefix web run build
	npm --prefix desktop install
	npm --prefix desktop run build
	npm --prefix desktop test

desktop-mac:
	cargo build --release
	npm --prefix web run build
	npm --prefix desktop install
	npm --prefix desktop run build
	npm --prefix desktop run dist:mac

desktop-mac-smoke: desktop-mac
	MNOTE_PACKAGED=1 npm --prefix desktop test -- e2e/packaged.spec.ts
