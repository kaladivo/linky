# Linky Rewrite — Implementation Context

> Decisions and clarifications made before implementation. Read alongside `product-spec.md`.
> Last updated: 2026-02-11

---

## Monorepo Structure (Bun)

```
linky-next/
├── apps/
│   └── web/                  # Vite + React PWA (mobile-first)
├── packages/
│   ├── core/                 # Domain logic, services, Effect layers (zero React deps)
│   ├── ui/                   # Shared UI components (minimal primitives, keep lightweight)
│   └── config/               # Shared tsconfig, eslint, tailwind configs
├── services/
│   └── lnurl-proxy/          # Bun-based CORS proxy server for LNURL requests
├── package.json              # Workspace root
├── bunfig.toml
└── tsconfig.json             # Base TS config
```

### Package Responsibilities

- **packages/core**: All domain logic, protocol integrations (Nostr, Cashu, Credo), Effect services. **Zero React dependencies.** This is the package that gets reused when building Expo app later.
- **packages/ui**: Tailwind + shadcn/ui based component library. React components only. Minimal primitives — keep lightweight. Shared between web and future mobile.
- **packages/config**: Shared build/lint/style configuration (tsconfig, eslint, tailwind preset).
- **services/lnurl-proxy**: Simple Bun HTTP server that proxies LNURL requests to avoid CORS issues. Standalone deployable.
- **apps/web**: Vite + React SPA/PWA. Composes core services and UI components. Handles routing, app shell, PWA registration.

---

## Technology Choices

| Concern | Choice | Notes |
|---------|--------|-------|
| Runtime / Package Manager | Bun | Monorepo workspaces |
| Language | TypeScript (strict) | Across all packages |
| Core Logic | Effect-TS (full stack) | Domain, services, HTTP, schema, errors, config |
| Frontend Framework | React + Vite | SPA, no SSR needed for local-first PWA |
| Styling | Tailwind CSS + shadcn/ui | Utility-first with accessible primitives |
| Local Database | Evolu | CRDT-based, mnemonic ownership, as specified |
| Nostr | nostr-tools | Wrapped in Effect services |
| Cashu | @cashu/cashu-ts | Wrapped in Effect services |
| i18n | typesafe-i18n | Fully type-safe, ~430 keys, EN + CS |
| Image Hosting | Blossom (BUD-01) | Decentralized blob storage for profile pictures |
| Testing | Deferred | Add Vitest when flows stabilize |
| Deployment | Undecided | Build as static SPA for now |
| Push Notifications | Deferred to v2 | Skip entirely for v1 |

---

## Effect-TS Architecture

**Scope**: Full stack — Effect is used for business logic, services, HTTP, schema validation, config, and error handling.

**API Design Pattern**: Mixed based on complexity.

- **Service + Layer pattern** for complex stateful things:
  - `WalletService` (Cashu token management, balance, send/receive/melt)
  - `NostrService` (relay connections, subscriptions, event publishing)
  - `CredoService` (promise/settlement creation, validation, cap tracking)
  - `ClaimService` (npub.cash polling, token claiming)
  - `SyncService` (Evolu lifecycle, message ingestion)

- **Plain Effect functions** for pure domain logic:
  - Payment composition (Credo offset -> Cashu -> Promise overflow)
  - Token parsing/encoding (Cashu V3/V4, Credo)
  - Key derivation (nsec -> npub, mnemonic, seed)
  - Profile derivation (FNV-1a hash -> name, avatar)
  - Canonical JSON / Promise ID computation
  - LNURL address resolution

---

## Database

**Approach**: Fresh Evolu schema designed from scratch, based on the domain model in the spec (section 11). No legacy schema compatibility needed.

**Entities to model**:
- Contact
- Message
- CashuToken
- CredoToken
- PaymentEvent
- MintInfo
- AppState (singleton)

All use soft delete (isDeleted flag). All queries filter deleted records.

---

## v1 Scope Decisions

### Included in v1
- **Payment history** — first-class user-facing feature
- **Credo UX** — advanced/opt-in (disabled by default, as per spec)
- **JSON export/import** — for migration from old app (no direct legacy DB migration)
- **Diagnostics pages** — dev/internal only, not user-facing

### Deferred (v2+)
- **Push notifications** — skip entirely
- **Deployment target** — build as static SPA, decide hosting later
- **Testing** — add when flows stabilize
- **Historical data remapping on contact merge** — not needed for now
- **Key storage strategy changes** — keep current approach (localStorage)

---

## Implementation Notes

### CORS Proxy (services/lnurl-proxy)
Simple Bun HTTP server. Validates incoming URL, fetches LNURL endpoint, returns response with permissive CORS headers. Deployed separately from the web app.

### Nostr Integration
Use `nostr-tools` for all NIP implementations but wrap every operation in Effect services:
- Relay pool management via Effect Layers
- Event publishing with retry as Effect
- Subscription management with Effect streams or fibers
- NIP-98 HTTP auth as Effect middleware

### Cashu Integration
Use `@cashu/cashu-ts` wallet class but wrap in Effect:
- Token operations (send/receive/melt) as Effect functions with typed errors
- Deterministic wallet (BIP-39 seed) managed through Effect context
- Per-keyset counter and concurrency lock via Effect Refs/Semaphores

### Profile Images
Use Blossom (BUD-01) for decentralized image uploads. Nostr-native, aligns with the app's decentralized philosophy.

### Secret Storage
Keep current behavior from spec — no new hardening requirements in this phase. nsec + mnemonic in localStorage.

---

## Code Quality

All packages use shared ESLint, Prettier, and TypeScript strict mode configs from `packages/config`.

**Root-level scripts:**
- `bun run lint` — ESLint across all packages
- `bun run typecheck` — TypeScript `--noEmit` across all packages
- `bun run format:check` — Prettier check across all packages
- `bun run check-code` — runs all three above in sequence (single command for CI and pre-push)

---

## Key Architectural Principles

1. **packages/core has zero React dependencies** — pure Effect-TS, reusable for Expo
2. **Effect errors are typed** — every service operation declares its error channel
3. **Optimistic UI** — messages and payments appear immediately, update on confirmation
4. **Local-first** — Evolu is the source of truth, network operations are secondary
5. **Bearer token safety** — Cashu recovery tokens stored before any destructive operation
6. **Idempotent replay** — all queued operations safe to replay on reconnect
7. **Avoid over-splitting** — keep packages focused but don't fragment prematurely
