# Linky

Mobile-first PWA for contacts, Nostr messaging, and Lightning/Cashu payments. Local-first architecture using Evolu for offline storage and cross-device sync.

See @README.md for project overview and @docs/credo.md for the Credo protocol spec.

## Commands

```bash
bun install                # Install dependencies
bun run dev                # Start Vite dev server
bun run build              # Production build (tsc -b && vite build)
bun run check-code         # Run ALL checks: typecheck → eslint --fix → prettier --write
bun run typecheck          # TypeScript type checking only
bun run eslint             # Lint + autofix all workspaces
bun run prettier           # Format + autofix all workspaces
```

IMPORTANT: Always run `bun run check-code` after making changes. It runs typecheck first, then eslint and prettier which autofix what they can. If typecheck or non-autofixable eslint errors remain, fix them manually and re-run until all checks pass.

## Monorepo Structure

- `apps/web-app/` - Main React app (Vite + SWC)
- `packages/config/` - Shared ESLint, Prettier, and TypeScript configs
- Package manager is **Bun** (not npm/yarn/pnpm)
- Workspace filter: `bun run --filter @linky/web-app <script>`

## Architecture

- **No framework router** - hash-based routing via `useRouting` hook and `parseRouteFromHash()` in `src/types/route.ts`
- Navigation uses `navigateTo()` from `src/hooks/useRouting.ts` - do NOT use `window.location` directly
- **Evolu** for all persistent data - local-first SQLite with sync. Schema in `src/evolu.ts`
- **No backend** - pure client-side PWA with service worker caching

## Code Conventions

- TypeScript strict mode with `exactOptionalPropertyTypes`
- **NEVER use `as` or `any` to cast types** - validate with a runtime type guard instead of casting
- Branded ID types from Evolu (`ContactId`, `CashuTokenId`, `CredoTokenId`, `MintId`, etc.) - don't use plain strings
- Components use `interface` for props, not `type`
- LocalStorage keys use `linky.` prefix (e.g., `linky.nostr_nsec`, `linky.lang`)
- Use types from libraries (e.g., Evolu, Cashu, Nostr) instead of redefining them - look up the library's exported types first
- Plain CSS in `App.css` - no CSS-in-JS or utility framework

## Testing

- **Playwright** E2E tests in `apps/web-app/tests/`
- **Vitest** unit tests (jsdom environment, Worker polyfill in `vitest.setup.ts`)
- Dev server for E2E: `http://127.0.0.1:5174`

## Gotchas

- Evolu requires a Worker polyfill in test environments
- SQLite WASM files served from `public/sqlite-wasm/` with `cache-control: no-store` in dev
- The `nsec` private key is in localStorage (`linky.nostr_nsec`) - never log or expose it
- Vite proxies: `/__mint-quote` for Cashu mint quotes, `/api/lnurlp` for LNURL-pay (CORS workarounds)
- PWA service worker auto-updates - changes to `sw.ts` affect caching behavior

## Maintaining This File

IMPORTANT: Keep this file up to date. When you make changes that affect architecture, commands, conventions, or key files, update the relevant section here in the same commit. This file should reflect the current state of the project. Keep it brief.
