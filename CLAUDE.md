# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Linky is a mobile-first PWA for contact management and Lightning network payments using Cashu tokens. It operates fully offline-first with local data storage via Evolu, syncing through Nostr protocol for decentralized messaging.

## Development Commands

```bash
npm run dev          # Start Vite development server
npm run build        # TypeScript check + production build
npm run lint         # Run ESLint
npm run preview      # Preview production build
npm run lint -- --fix # Run ESLint with auto-fix
```

## After Code Changes

**Always run lint and typecheck after making any code changes:**

1. First, attempt to auto-fix lint issues: `npm run lint -- --fix`
2. Then run the build to check for TypeScript errors: `npm run build`
3. If errors remain, fix them manually before considering the task complete

Prefer ESLint's auto-fix capability (`--fix` flag) to resolve formatting and simple code issues automatically.

## Documentation

**Before working with Evolu or Nostr**, always use Context7 MCP tools to fetch up-to-date documentation:

1. Use `resolve-library-id` to find the correct library ID (e.g., for "evolu" or "nostr-tools")
2. Use `query-docs` with the resolved library ID to get relevant documentation for your task

This ensures you're using current APIs and best practices for these libraries.

## Tech Stack

- **React 19** with TypeScript (strict mode)
- **Vite** for build tooling with PWA plugin
- **Evolu** - Local-first SQLite database with sync (schema in `src/evolu.ts`)
- **Cashu** (`@cashu/cashu-ts`) - Ecash token handling for payments
- **Nostr** (`nostr-tools`) - Decentralized messaging protocol
- **BIP39** (`@scure/bip39`) - Mnemonic phrase generation

## Architecture

### Data Layer
- Evolu manages all persistent data with four tables: `contact`, `nostrIdentity`, `nostrMessage`, `cashuToken`
- Schema defined in `src/evolu.ts` with branded ID types (`ContactId`, `CashuTokenId`, etc.)
- Data syncs via default Evolu sync server; works fully offline

### Identity System
- Primary identity is a Nostr `nsec` (secret key) stored in localStorage
- 12-word mnemonic is deterministically derived from `nsec` for Evolu database identity
- See `src/mnemonic.ts` and identity setup in `src/App.tsx`

### Routing
- Hash-based client-side routing (`window.location.hash`)
- Route types defined in `src/types/route.ts`
- Navigation helpers in `src/hooks/useRouting.ts`

### Code Organization
- `src/App.tsx` - Main component containing most UI logic (~6,700 lines)
- `src/hooks/` - Custom hooks (useInit, useRouting, useToasts)
- `src/utils/` - Pure utilities (validation, formatting, storage wrappers)
- `src/i18n/` - Internationalization (Czech/English)
- Cashu operations split across: `cashu.ts` (parsing), `cashuAccept.ts` (accepting), `cashuMelt.ts` (spending), `lnurlPay.ts` (LNURL protocol)

### Polyfills
`src/main.tsx` contains critical polyfills for browser compatibility:
- Buffer with base64url encoding (for Cashu/Evolu)
- BroadcastChannel (for Evolu sync in private browsing)
- navigator.locks (for restricted environments like iOS WebKit)

## Key Patterns

### Validation
Use type guards and safe conversion functions from `src/utils/validation.ts`:
```typescript
const asNonEmptyString = (value: unknown): string | null => { ... }
const isHttpUrl = (value: unknown): value is string => { ... }
```

### localStorage Access
Always use safe wrappers from `src/utils/storage.ts` - direct localStorage calls can throw in private browsing.

### Evolu Queries
Use `useEvolu()` hook for reactive database queries. All database mutations go through Evolu's `create()` and `update()` methods.

### Error Handling
- `ErrorBoundary.tsx` catches React rendering errors
- Boot errors handled in `main.tsx` with diagnostic display
- All async operations should handle failures gracefully for offline support

## Testing

Vitest is configured (`vitest.config.ts`) with jsdom environment and testing-library matchers. Test setup includes MockWorker polyfill required by Evolu.

## PWA Configuration

- Service worker auto-registers in production only
- Cache-first strategy for images (30-day expiration)
- Dev mode includes PWA cleanup to prevent stale cache issues
- Manifest and icons configured in `vite.config.ts`
