.PHONY: dev test container-test desktop-test desktop-mac desktop-mac-smoke fix-perms

dev:
	./scripts/dev.sh

test: container-test

container-test:
	mkdir -p web/node_modules desktop/node_modules target web/dist desktop/dist desktop/release web/coverage web/test-results desktop/test-results web/playwright-report desktop/playwright-report web/artifacts desktop/artifacts web/e2e/.auth desktop/e2e/.auth
	docker compose run --rm -e HOST_UID=$$(id -u) -e HOST_GID=$$(id -g) test

fix-perms:
	docker compose run --rm --no-deps -v $$(pwd):/fix --entrypoint chown test -R --from=0:0 $$(id -u):$$(id -g) /fix

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
