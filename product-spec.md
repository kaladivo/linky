# Linky — Complete Product Specification for Rewrite

> A local-first private contact chat app where sending value (Cashu now, Credo later) is embedded directly into conversation threads and remains usable through offline and sync variability.

---

## Part I: Strategic Context

### 1. Purpose

This document defines what the Linky product must do after a full rewrite. It is intentionally product-first but implementation-complete:

- It describes user outcomes, business rules, external protocol compatibility, AND the technical detail needed to build each feature.
- It does not prescribe old code structure, old route structure, old UI layout, or specific libraries.
- It is redesign-friendly: visual design, interaction model, navigation, and architecture are open for improvement.

The rewrite should preserve product behavior and interoperability while modernizing implementation and UX.

### 2. Product Definition

Linky is a **contacts-first Bitcoin wallet and messenger**. Users manage a contact list of people they transact and communicate with. The app combines three protocols:

- **Nostr** for identity (keypair), messaging (NIP-17 encrypted DMs), and profile metadata
- **Cashu** for ecash token-based Bitcoin payments (custodied by mints, backed by Lightning Network)
- **Credo** for cryptographically signed IOUs ("promises") between contacts

All data is stored **local-first** via Evolu (CRDT-based local database), with optional sync to Evolu servers. There is no central backend — the app talks directly to Nostr relays, Cashu mints, and npub.cash.

The app is a **PWA** (Progressive Web App), designed for mobile-first use.

### 3. Goals and Non-Goals

**Goals:**

- Make "send money to a contact" feel as easy as sending a chat message.
- Keep payment context inside the chat thread.
- Work in unstable connectivity through local-first behavior and retry.
- Keep identity portable through a user-controlled Nostr private key (`nsec`).
- Support deterministic recovery of app ownership/state derived from identity.

**Non-goals:**

- Full banking or custodial wallet functionality.
- Complex accounting workflows.
- Broad Nostr-client feature coverage beyond what Linky needs.

### 4. User Mental Model

A user should understand the app as:

1. I have one identity (my Nostr key).
2. I keep people in contacts.
3. I chat privately with contacts.
4. I can send value in that same chat — Cashu now, Credo promise when immediate funds are not enough.
5. My data works locally and syncs when available.

Protocol complexity should stay mostly hidden, surfaced only where advanced users need it.

### 5. Rewrite Freedom and Guardrails

**Free to redesign:**

- Frontend framework, state management, persistence engines, and networking stack.
- Screen layouts, information architecture, interactions, and visual design.
- Internal schemas, module boundaries, and deployment model.

**Must preserve:**

- Core user mental model (contacts + private chat + value transfer in-thread).
- Protocol compatibility where it affects real users and existing network interactions.
- Critical business rules and payment semantics (see section 10).
- Recovery and resilience expectations.

### 6. Priority Scope

**Must-have for v1 parity:**

- Identity create/import with deterministic ownership derivation.
- Contacts CRUD/search/grouping and scan-based add.
- Private chat with pending/offline resend behavior.
- Wallet balance and token import/manage flows.
- Contact pay semantics with Credo/Cashu composition order.
- LN address/invoice pay.
- Top-up and claim ingestion.
- Relay/mint management basics.
- npub.cash and Credo interoperability.

**High-value recommended:**

- Robust auto-ingestion of incoming value payloads.
- Deterministic restore/repair workflows.
- Import/export and strong dedupe behavior.
- Onboarding guidance that teaches core jobs-to-be-done.

**Can phase later if needed:**

- Deep diagnostics and raw data inspection tooling.
- Non-core experimental notification integrations.

### 7. Acceptance Checklist

A rewrite is functionally acceptable when:

1. New and existing users can onboard with deterministic identity continuity.
2. Contacts can be managed and discovered quickly, including QR add and dedupe.
3. Private chat works with pending/offline/retry behavior.
4. Cashu import/send/receive/melt flows work end-to-end with reliable balance effects.
5. Contact pay follows the exact composition order and Credo constraints.
6. LN address and BOLT11 payments work via supported mints.
7. Top-up and claim ingestion update balance correctly.
8. Relay and sync/mint settings are user-manageable.
9. Token/obligation replay, dedupe, and restore behaviors are safe and predictable.
10. EN/CS localization and core PWA usability are present.

### 8. Open Product Decisions for Rewrite Team

These decisions should be made explicitly:

1. Whether and how to remap historical data when contacts merge.
2. Whether payment history becomes a first-class user-facing feature.
3. Whether key storage strategy should materially change.
4. How prominent Credo should be in mainstream payment UX.
5. How far to take notifications in v1 vs later phases.

---

## Part II: Domain Specifications

### 9. Identity & Key Management

#### Master Key: Nostr Secret Key (nsec)

The nsec is the root of **all** identity in Linky. Everything else is deterministically derived from it.

**Key derivation chain:**
```
Random 32-byte Nostr private key (or imported nsec)
  |
  +-> getPublicKey() -> Nostr public key (npub)
  |     Used for: Nostr identity, messaging, profile, Lightning address ({npub}@npub.cash)
  |
  +-> SHA-256("linky-evolu-v1:" + privKeyBytes) -> first 16 bytes (128-bit entropy) -> 12-word BIP-39 mnemonic
        |
        +-> Evolu mnemonic -> Evolu database owner (sync identity + encryption key)
        |
        +-> BIP-39 seed (64 bytes) -> Cashu deterministic blinding factors
```

#### Account Creation Flow

1. **Generate keypair**: Random 32-byte secret key. Validated against secp256k1 curve (retry until valid). Encoded as nsec (bech32).
2. **Derive profile**: Deterministic name from FNV-1a hash of npub indexing into a name list. Deterministic avatar seeded by npub. Lightning address: `{npub}@npub.cash`.
3. **Publish to Nostr**: Create kind 0 metadata event with `{name, display_name, picture, image, lud16}`. Publish to default relays. **If publish fails, show error and abort — don't store identity.**
4. **Store identity**: Persist nsec and derived Evolu mnemonic locally.

The creation flow should show progress to the user across the three steps (name generation, avatar generation, Lightning address creation). Each step can fail independently and should offer retry.

#### Account Restoration (Paste nsec)

1. Validate nsec format (must be valid bech32 nsec)
2. Derive npub from private key bytes
3. Derive Evolu mnemonic using same derivation as creation
4. Store nsec + mnemonic locally
5. Reconnect to existing Evolu database using mnemonic
6. Reload app

#### Logout Flow

Two-step confirmation (prevent accidental logout):
1. First action: arms logout, shows confirmation prompt
2. Second action: removes nsec and mnemonic from local storage, reloads app

**What gets cleared**: nsec, mnemonic. Evolu database persists locally (reconnectable if user re-enters same nsec).

### 10. Critical Business Rules

> These rules are non-negotiable and must be preserved exactly.

#### 10.1 Payment Composition Order

When paying a contact through in-chat value transfer:

1. Consume incoming Credo obligations from that contact first.
2. Use available Cashu balance next.
3. Issue outgoing Credo promise only for remaining amount, only if allowed.

This order is a core product behavior.

#### 10.2 Credo Constraints

- Outgoing promises are limited by a total outstanding cap of **100,000 sat**.
- Promise target expiry is **30 days** (2,592,000 seconds).
- Promise issuance is conditional on user setting/allowance (disabled by default).

#### 10.3 Offline and Retry Semantics

- Outgoing messages should appear locally immediately (optimistic UI).
- Offline operations should queue instead of failing hard where possible.
- Queued message/payment work should flush on reconnect or resume.
- Replay should be idempotent and dedupe-safe.

#### 10.4 Deterministic Identity Ownership

- Creating or importing `nsec` must deterministically derive identity-linked ownership state used by local/sync data.

#### 10.5 Mint Preference Behavior

- User-selected default mint should persist and sync to npub.cash when relevant.
- If user has not explicitly overridden, remote/default preference may be adopted.

### 11. Domain Model

#### Entities

**Contact**
| Field | Required | Description |
|-------|----------|-------------|
| name | no | Display name |
| npub | no | Nostr public key (bech32) |
| lnAddress | no | Lightning address (user@domain) |
| groupName | no | Contact group for organizing |

At least one field should be filled for a contact to be meaningful.

**Message**
| Field | Required | Description |
|-------|----------|-------------|
| contactId | yes | Which contact this message belongs to |
| direction | yes | "in" or "out" |
| content | yes | Decrypted plaintext message content |
| wrapId | yes | Kind 1059 gift-wrap event ID (for deduplication) |
| rumorId | no | Kind 14 inner event ID |
| pubkey | yes | Sender's pubkey hex |
| createdAtSec | yes | Inner event timestamp (Unix seconds) |

**Cashu Token**
| Field | Required | Description |
|-------|----------|-------------|
| token | yes | Re-encoded token (after accept/swap) |
| rawToken | no | Original token string as received |
| mint | no | Mint URL |
| unit | no | Token unit (typically "sat") |
| amount | no | Total token amount |
| state | no | "accepted", "pending", or "error" |
| error | no | Error message if state="error" |

**Credo Token (Promise)**
| Field | Required | Description |
|-------|----------|-------------|
| promiseId | yes | SHA-256 hex of canonical promise JSON |
| issuer | yes | Issuer npub |
| recipient | yes | Recipient npub |
| amount | yes | Promised amount (sats) |
| unit | yes | "sat" |
| createdAtSec | yes | Promise creation timestamp |
| expiresAtSec | yes | Expiry timestamp |
| settledAmount | no | Cumulative amount settled so far |
| settledAtSec | no | Last settlement timestamp |
| direction | yes | "in" (promised to me) or "out" (I owe) |
| contactId | no | Associated contact |
| rawToken | no | Full wire-format token |

**Payment Event**
| Field | Required | Description |
|-------|----------|-------------|
| createdAtSec | yes | Event timestamp |
| direction | yes | "in" or "out" |
| amount | no | Amount in unit |
| fee | no | Fee paid/reserved |
| mint | no | Mint URL, or "multi" for multi-mint |
| unit | no | "sat" |
| status | yes | "ok" or "error" |
| error | no | Error message if status="error" |
| contactId | no | Associated contact |

**Mint Info**
| Field | Required | Description |
|-------|----------|-------------|
| url | yes | Mint URL |
| firstSeenAtSec | yes | When first discovered |
| lastSeenAtSec | yes | Last successful contact |
| supportsMpp | no | Whether NUT-15 MPP is supported |
| fees | no | Fee schedule |
| info | no | General mint info |
| lastCheckedAtSec | no | Last info refresh |

**App State (singleton)**
Tracks onboarding progress: whether checklist is dismissed, whether user has paid, current guide task/step.

#### Relationships

```
contact (1) --< (N) message        (every message belongs to a contact)
contact (1) --< (N) credoToken     (promises optionally linked to contacts)
contact (1) --< (N) paymentEvent   (payments optionally linked to contacts)
cashuToken.mint <-> mintInfo.url    (linked by URL string)
```

#### Soft Delete

All data uses soft delete (isDeleted flag). All queries must filter out deleted records.

### 12. Contacts System

#### Adding Contacts

1. **QR scan**: Camera scans npub QR code. If contact with that npub already exists, navigate to existing contact and refresh profile from Nostr. If new, create contact with npub only.
2. **Manual entry**: Form with name, npub, lnAddress, group fields.
3. **Post-payment prompt**: After paying a lightning address that isn't a saved contact, offer to save as contact with lnAddress prefilled. If address is `*@npub.cash`, extract the npub part for the contact.
4. **Clipboard paste**: Can paste npub from clipboard.

#### Contact List Display

**Two sections:**
1. **"Conversations"**: Contacts with at least one message. Sorted by: unread status (descending) -> last message timestamp (newest first) -> alphabetical by name.
2. **"Other contacts"**: Contacts with no messages. Sorted by: unread status (descending) -> alphabetical by name (locale-aware).

**Search**: Input split by whitespace into parts. ALL parts must appear somewhere in the combined text of (name + npub + lnAddress + groupName), case-insensitive.

**Group filter**: Options: "All" (no filter), "No Group" (only contacts without groupName), or specific group names. Only one active at a time.

**Contact card shows:**
- Avatar (Nostr profile picture -> initials fallback -> "?" fallback)
- Unread indicator (if unread messages exist)
- Name
- Last message preview (truncated, with direction indicator)
- Timestamp of last message
- Credo promise net balance (positive or negative indicator)

#### Contact Detail

Shows: avatar, name, group, lightning address.

**Pay button** visible when: `lnAddress exists OR ((payWithCashuEnabled OR allowPromisesEnabled) AND npub exists)`.

**Pay button** enabled when: `(lnAddress AND cashuBalance > 0) OR (npub AND (cashuBalance > 0 OR availableCredo > 0 OR allowPromisesEnabled))`.

**Messages button** visible when: `npub exists`.

Special labels for feedback contact (hardcoded npub): "Donate" instead of "Pay", "Feedback" instead of "Messages".

#### Contact Editing

- Fields: name, npub, lnAddress, group (with autocomplete from existing groups)
- "Restore from Nostr" option for name and lnAddress: fetches contact's kind 0 profile metadata from relays and re-populates
- Delete: two-step confirmation
- Deduplication: merge contacts sharing same npub, reassigning messages to the surviving contact

### 13. Wallet & Cashu Tokens

#### What is a Cashu Token?

A bearer ecash token — cryptographic proof of ownership of satoshis held by a Cashu mint. Encoded as a string starting with `cashuA` (V3, base64url JSON) or `cashuB` (V4, base64url CBOR). Contains: mint URL, array of proofs (each with amount, secret, blinded signature, keyset ID), optional unit and memo.

#### Token Parsing

V3 tokens: strip `cashuA` prefix -> base64url decode -> JSON parse.
V4 tokens: strip `cashuB` prefix -> base64url decode -> CBOR decode.
Also handles raw JSON strings and `cashu:` URI prefix (stripped before parsing).

#### Wallet Balance Calculation

**Cashu balance** = sum of `amount` for all cashuTokens where not deleted AND `state = "accepted"` (or state is null).

**Extended balance with promises** = `cashuBalance + totalCredoOutstandingIn - totalCredoOutstandingOut`

Where:
- `totalCredoOutstandingIn` = sum of remaining amounts for all active Credo tokens with `direction="in"` (not expired, remaining > 0)
- `totalCredoOutstandingOut` = same for `direction="out"`
- `remainingAmount = max(0, amount - (settledAmount ?? 0))`
- "Active" = not expired (`now < expiresAtSec`) AND `remainingAmount > 0`

#### Token States

- **"accepted"**: Token is valid and spendable
- **"pending"**: Token was created but not yet confirmed (e.g., swapped but Nostr DM not yet published)
- **"error"**: Token failed validation at mint (signature invalid, already spent, etc.)

#### Core Operations

**Send:**
1. Decode all user tokens at the target mint, collect all proofs
2. Validate: `totalProofSum >= requestedAmount`
3. Swap at the mint: returns keep proofs (change) and send proofs (payment)
4. Encode send proofs as new token (the payment to deliver)
5. Encode keep proofs as remaining token (user's change)
6. Return both tokens
7. If deterministic mode: use counter, retry up to 5 times on "outputs already signed" (bump counter by 64 each retry)

**Accept/Receive:**
1. Decode incoming token
2. Extract mint URL from decoded token
3. Swap at that mint: invalidates old proofs, issues fresh ones
4. Encode fresh proofs as new token
5. Return amount, token, mint, unit
6. Same deterministic counter/retry logic as send

**Melt (ecash -> Lightning):**
1. Decode all user tokens at target mint, collect proofs
2. Get melt quote from mint (returns amount + fee_reserve)
3. Validate: `totalProofs >= amount + fee_reserve`
4. Swap to get exact proofs for amount + fee_reserve
5. Execute melt: mint pays the Lightning invoice
6. Combine remaining proofs: keep proofs + melt change proofs
7. `feePaid` may be less than `feeReserve` — the difference is returned as change

**Recovery Tokens:**
All three operations create a "recovery token" combining all proofs before the operation. If the process fails after the swap but before completion (network error, app crash), the recovery token preserves all funds. Must be stored persistently.

#### Token Check

- **Check single token**: Re-validate at mint. If valid, update state to "accepted". If definitive error (signature/format): mark as "error". If transient error (network/timeout): show error but don't change state.
- **Check all tokens**: Iterate all active tokens grouped by mint+unit. Delete tokens confirmed as invalid.

#### Token Inventory

The wallet should display:
1. Total balance (extended balance including promises)
2. Individual Cashu tokens (showing mint + amount)
3. "Check All Tokens" action
4. Outstanding Credo promises ("I Owe" and "Promised to Me" sections)
5. Manual token import (paste a Cashu token string to receive it)

### 14. Payment Flows

#### Pay a Contact

**Step 1: Method Selection**

- **Cashu available if**: `(payWithCashuEnabled OR allowPromisesEnabled) AND contact.npub exists`
- **Lightning available if**: `contact.lnAddress exists`
- **Default preference**: Cashu over Lightning (if both available)
- User can toggle between methods if both available

**Step 2: Amount Entry**

Numeric input for amount in sats (or BTC depending on unit preference).

**Step 3: Credo Offset Calculation**

Before actual payment, outstanding promises from the contact are automatically offset:
```
availableCredo = sum of remaining amounts from non-expired credoTokens
                 where direction="in" AND issuer=contact_npub
useCredo = min(availableCredo, requestedAmount)
remainingAfterCredo = max(0, requestedAmount - useCredo)
```

**Step 4: Promise Overflow (Cashu path only)**

If `allowPromisesEnabled` AND `remainingAfterCredo > cashuBalance`:
```
cashuToSend = min(cashuBalance, remainingAfterCredo)
promiseAmount = max(0, remainingAfterCredo - cashuToSend)
```

**Promise cap**: `totalCredoOutstandingOut + promiseAmount <= 100,000 sat`. If exceeded, payment is invalid.

**Step 5A: Cashu Payment Execution**

1. **Token selection**: Group all accepted tokens by mint URL. Build prioritized candidate list (preferred mint first, then by available balance).
2. **For each mint candidate**: Swap/split tokens. Collect send token + remaining token. Store remaining (change) back. Track original tokens for deletion.
3. **Credo settlements**: For outstanding promises being offset, sorted by earliest expiry first. Create settlement token for each.
4. **New promise** (if promiseAmount > 0): Create promise token with 30-day expiry.
5. **Nostr delivery**: For each token/settlement/promise:
   - Wrap as NIP-17 DM (kind 14 inside kind 1059 gift wrap)
   - Create TWO copies: one for recipient, one for self
   - Publish both to relays with retry (max 2 attempts)
   - Optimistic UI: message appears as "pending", updated on successful publish
6. **On success**: Apply settlements, insert promises.
7. **Cleanup**: Delete original Cashu token records. If send token publish failed, store as "pending" token to preserve funds.

**Step 5B: Lightning Payment Execution**

1. **Credo settlements** (same as above if useCredo > 0)
2. **Invoice fetch**: Resolve lightning address via LNURL-pay protocol (see section 24)
3. **Melt**: Group tokens by mint, build candidate list. Try each mint. First successful mint wins.
4. **Change**: Store remaining token from melt. Delete original tokens.
5. **Payment logging**: Record paymentEvent with direction, amount, fee, mint, status.

**Step 5C: Credo-Only Payment (no Cashu needed)**

When `remainingAfterCredo <= 0` (entire amount covered by Credo offset + new promise):
- Only create settlement/promise tokens
- Deliver via NIP-17 DMs
- No Cashu send, no Lightning invoice

**Post-Payment:**
- Show success confirmation
- Log payment event
- For Lightning address payments to unknown contacts: offer to save as contact

#### Top Up (Lightning -> Cashu)

1. User chooses to receive bitcoin
2. Enter desired amount
3. App requests mint quote: POST `{mintUrl}/v1/mint/quote/bolt11` with `{ amount, unit: "sat" }`
4. Response contains a BOLT11 Lightning invoice
5. Display invoice as QR code for user to pay externally
6. While waiting: accelerate npub.cash claim polling to 5-second interval (normally 30s)
7. Payment detection: track starting balance. When balance increases by expected amount, payment is confirmed.
8. The actual token delivery happens via npub.cash claim (see section 17)

#### Pay Lightning Address Directly

Used when scanning a lightning address QR code or entering one manually:
1. Display target address and available balance
2. Enter amount
3. Validate: amount must be > 0 and <= cashuBalance
4. Resolve LNURL-pay invoice, then melt Cashu tokens to pay it
5. Post-payment: offer to save as contact if address not already saved

### 15. Credo Promise System

#### Wire Format

Prefix: `credoA` (version 1). Encoding: `credoA` + base64url(UTF-8(JSON message)).

#### Promise Message Structure

```json
{
  "promise": {
    "type": "promise",
    "version": 1,
    "issuer": "<issuer_npub>",
    "recipient": "<recipient_npub>",
    "amount": 1000,
    "unit": "sat",
    "nonce": "<32-byte random hex>",
    "expires_at": 1234567890,
    "created_at": 1234567890
  },
  "promise_id": "<64-char hex SHA-256 of canonical JSON>",
  "issuer_sig": "<128-char hex Schnorr signature>"
}
```

#### Promise ID Computation

Canonical JSON rules for hashing:
- Object keys sorted alphabetically
- No whitespace around `:` or `,`
- Numbers, booleans: standard JSON serialization
- Strings: JSON serialized (with quotes)
- Arrays: `[elem1,elem2,...]`
- Null/undefined: string `"null"`

`promise_id = SHA-256(canonicalize(promise_payload))` -> 64-char lowercase hex

#### Signature

Schnorr signature (secp256k1) of the promise_id bytes. Signer: issuer's nsec. Output: 64-byte signature -> 128-char hex.

#### Settlement Message Structure

```json
{
  "settlement": {
    "type": "settlement",
    "version": 1,
    "promise_id": "<references the promise>",
    "recipient": "<recipient_npub>",
    "issuer": "<issuer_npub>",
    "settled_at": 1234567890,
    "amount": 500,
    "unit": "sat",
    "nonce": "<32-byte random hex>"
  },
  "settlement_id": "<64-char hex SHA-256>",
  "recipient_sig": "<128-char hex Schnorr signature>"
}
```

Signed by **recipient** (not issuer). `amount` field is optional:
- If present: partial settlement for that amount
- If absent: full settlement

#### Partial Settlement Logic

Multiple settlements can reference the same promise_id. Each adds to `settledAmount`:
```
nextSettled = min(promise.amount, existingSettled + settlementAmount)
```
Promise is fully settled when `settledAmount >= amount`.

#### Validation Rules

- **Promise valid if**: signature verifies AND `now < expires_at` AND no full settlement exists.
- **Settlement valid if**: recipient signature verifies.
- **ID integrity**: computed `SHA-256(canonical_payload)` must match stated ID.

#### Token Extraction from Text

Regex: `/credoA[0-9A-Za-z_-]+/` — extracts first match from any text (e.g., message content).

#### Integration with Payments

During payment to a contact:
1. **Offset**: Outstanding incoming promises from the contact are automatically settled to reduce the payment amount. Promises sorted by earliest expiry first.
2. **Overflow**: If payment exceeds Cashu balance and promises are enabled, excess becomes a new Credo promise (up to cap).

#### Display

- **In messages**: Credo tokens render as inline indicators showing amount and counterparty
- **Detail view**: Full view with direction ("I owe" / "Promised to me"), counterparty, remaining amount, expiry countdown, raw token

### 16. Messaging

#### Protocol: NIP-17 Private Direct Messages

Messages use NIP-17 (kind 14 sealed messages) + NIP-59 (kind 1059 gift wrapping). NOT the older NIP-04.

#### Sending a Message

1. Create unsigned kind 14 event:
   - `content`: plaintext message text
   - `tags`: `[["p", contactPubHex], ["p", myPubHex], ["client", clientId]]`
   - `created_at`: current Unix timestamp (seconds)
   - `pubkey`: sender's pubkey hex
2. Gift-wrap (NIP-59) into kind 1059 — creates TWO wrapped events:
   - One encrypted for recipient
   - One encrypted for sender's own inbox
3. Publish both to all configured relays with retry (max 2 attempts)
4. Optimistic UI: message appears immediately as "pending"
5. Status update: "pending" -> "sent" when relay confirms
6. Store message locally

#### Receiving Messages

**Two subscription modes:**

1. **Active chat sync** (when chat with a contact is open):
   - Query relays for kind 1059 events addressed to user
   - Persistent real-time subscription for new events
   - Unwrap each event, validate inner kind 14 event
   - **Outgoing match**: If pubkey is mine, match against pending local messages -> update status to "sent"
   - **Incoming**: Create new message record if not duplicate

2. **Background inbox sync** (when NOT in a specific chat):
   - Same subscription pattern but runs independently
   - Processes incoming Cashu tokens: extracts and accepts them
   - Processes incoming Credo tokens: parses promise/settlement, applies accordingly
   - One token processed per cycle to avoid overwhelming the system

**Deduplication**: Track seen wrap IDs in memory. Limit to last 500 IDs.

#### Chat Features

- **Day separators**: When messages cross calendar day boundaries
- **Time labels**: Shown when consecutive messages are in different minutes
- **Cashu token detection**: Messages containing Cashu tokens (`cashuA...` or `cashuB...`) render as visual indicators with mint icon + amount
- **Credo token detection**: Messages containing Credo tokens (`credoA...`) render as indicators with counterparty + amount
- **Compose area**: Text input + Send + Pay actions
- **Pending indicator**: Messages not yet confirmed show pending state
- **Auto-scroll**: Scrolls to newest message on load and new message arrival

#### Payment Tokens in Messages

Both Cashu tokens and Credo tokens are sent as message content over the same NIP-17 channel. The UI detects them via regex and renders them as interactive elements instead of plain text.

### 17. npub.cash Integration

#### What is npub.cash?

An external service that provides Lightning address functionality for Nostr users. Maps `{npub}@npub.cash` to a Lightning endpoint. When someone pays that Lightning address, npub.cash receives the payment and holds Cashu tokens on behalf of the user until claimed.

#### Lightning Address

Every user automatically gets: `{npub}@npub.cash`. This is their default Lightning address unless they set a custom one in their Nostr profile.

#### API Endpoints (base URL: `https://npub.cash`)

All authenticated with **NIP-98** (HTTP Auth for Nostr — signs requests with user's Nostr private key).

**GET /api/v1/info**
- **Purpose**: Fetch user's preferred mint URL from npub.cash
- **When called**: App boot + every 10 minutes
- **Caching**: Skip if loaded in last 10 minutes for same npub
- **Response**: `{ data: { mintUrl: "..." } }`
- **Behavior**: If user hasn't manually overridden mint, updates default mint to match npub.cash response. If user has overridden, skip.
- **Errors**: Silently ignored

**GET /api/v1/claim**
- **Purpose**: Claim pending Cashu tokens received via Lightning
- **When called**: Every 30 seconds in background. Every 5 seconds while waiting for a top-up.
- **Guard**: Skipped if another Cashu operation is in progress, or already in-flight
- **Response**: `{ data: { token: "...", tokens: ["..."] } }` — one or more Cashu token strings
- **Processing**: Each claimed token -> accept/swap at mint -> store locally with state "accepted"
- **Errors**: Silently ignored

**PUT /api/v1/info/mint**
- **Purpose**: Update user's preferred Cashu mint on npub.cash
- **When called**: When user changes default mint in settings
- **Payload**: `{ mintUrl: "cleaned_url" }`
- **Errors**: Show error notification, reset sync tracking

#### Token Claiming Flow

1. Claim returns one or more token strings
2. For each token: check if already known (compare against stored tokens)
3. If not known: accept/swap at mint for fresh proofs
4. Store locally with state "accepted"
5. Also store last accepted token for crash recovery
6. Show notification that funds were received

**Crash recovery**: On app boot, check if a last-accepted token exists that isn't in the database. If so, re-persist it (handles case where storage saved but DB insert didn't complete).

### 18. Profile System

#### Profile Data Sources (Priority Order)

1. **Manual edits** by user (persisted as Nostr kind 0)
2. **Nostr metadata** fetched from relays
3. **Derived defaults** from npub

#### Derived Profile Defaults

- **Name**: FNV-1a 32-bit hash of npub string -> modulo name list length -> pick from name list. Fallback: "Linky".
- **Avatar**: Deterministic avatar seeded by npub (e.g., DiceBear Avataaars or similar)
- **Lightning address**: `{npub}@npub.cash`

#### FNV-1a Hash Algorithm

```
offset basis: 0x811c9dc5
for each char: hash ^= charCode; hash *= 16777619 (32-bit)
return hash >>> 0 (unsigned 32-bit)
```

#### Name List

172 total names: 73 Czech female, 43 Czech male, 26 English female, 30 English male. Examples: Alzbeta, Katerina, Tomas, Alice, Oliver, etc.

#### Profile Editing

- Edit name, lightning address, profile picture
- Upload local image file or use URL
- "Restore to default" option for each field
- Changes published as Nostr kind 0 metadata event to relays
- Merge with existing metadata: fetch current kind 0, overlay changes, publish updated version

#### Nostr Profile Fetching (for contacts)

- Query relays for kind 0 events by pubkey
- Take newest event by `created_at`
- Extract: `name` / `display_name` (prefer display_name), `lud16` / `lud06`, `picture` / `image`

#### Profile Caching

Two-tier caching:
1. **Persistent cache**: Profile metadata and picture URLs per npub. Negative cache TTL: 2 minutes.
2. **Avatar blob cache**: Cached avatar images for offline access (same-origin and allowlisted external sources).

#### Profile QR

- Displays QR code containing user's npub
- Shows avatar, name, lightning address
- Tap QR to copy npub to clipboard
- Edit mode to modify profile

### 19. Nostr Relay Management

#### Default Relays

```
wss://relay.damus.io
wss://nos.lol
wss://relay.0xchat.com
```

#### Relay Connection Tracking

- Status per relay: "connected" / "checking" / "disconnected"
- Probed via WebSocket connection test
- Status shown visually (e.g., colored indicators)

#### Relay List Sync (NIP-65, kind 10002)

- **On first launch**: Publish default relay list as kind 10002 event
- **On subsequent launches**: Fetch user's kind 10002 from network, merge with defaults
- **On relay change**: Re-publish relay list to both current relays AND default relays (for redundancy)
- **Event format**: Kind 10002 with tags: `["r", relayUrl]` for each relay

#### Relay Management

- List all relays with connection status
- Add new relay by wss:// URL
- Delete relay (with confirmation)
- Cannot remove last relay

### 20. Local-First Data Layer (Evolu)

#### What is Evolu?

A local-first database using CRDT-based sync. Data lives locally with optional encrypted sync to Evolu servers via WebSocket.

#### Key Characteristics

- **Database per user**: Each mnemonic produces its own database
- **CRDT-based**: No conflicts, automatic merge across devices
- **End-to-end encrypted**: Using owner identity derived from mnemonic
- **Soft delete**: Records marked as deleted, never physically removed
- **Offline-first**: Full functionality without network

#### Required Behavioral Outcomes

Regardless of implementation technology:
- App remains usable with no active sync server.
- Local state is authoritative for immediate UX.
- Sync is optional and eventually consistent when enabled.
- Ownership is deterministic from identity-derived material.

#### Sync Server Configuration

- **Default server**: `wss://free.evoluhq.com`
- Users can add/remove/disable sync servers
- Removing all servers creates a local-only instance (no sync)
- Server changes require app reload
- Individual servers can be toggled offline without removing

#### Database Ownership

The database is owned by the mnemonic derived from the nsec. This means:
- Same nsec = same database (enables multi-device sync)
- Different nsec = different database (privacy between accounts)

### 21. Mint Management

#### Default Mint

- Main mint URL: `https://mint.minibits.cash/Bitcoin`
- Can be overridden by user in settings
- Override synced to npub.cash
- If no override, mint is fetched from npub.cash /api/v1/info

#### Mint Selection for Payments

When paying, mints are tried in priority order:
1. User's preferred/default mint first
2. Then other mints sorted by available token balance
3. First mint to succeed is used

#### Mint Detail Information

Each mint shows: URL, MPP support (NUT-15), fee schedule, latency, last checked timestamp. Users can refresh info or delete a mint.

#### Preset Mints

App includes a list of known mints. Users can also enter custom mint URLs.

**Nuance**: Mint URL normalization/canonicalization should prevent duplicate or mismatched mint identities.

### 22. QR Code Scanning

#### Recognized Formats (in priority order)

1. **Cashu token** (`cashuA...` or `cashuB...`): Strips `cashu:` prefix if present. Accepts the token. Navigates to wallet.
2. **Nostr npub** (NIP-19 format): Strips `nostr:` prefix if present. If contact exists: navigate to contact, refresh from Nostr. If new: create contact with npub only.
3. **Lightning address** (matches `user@domain.tld`): If contact with that address exists: navigate to pay contact. If new: navigate to direct lightning address payment.
4. **Lightning invoice** (starts with `lnbc`, `lntb`, or `lnbcrt`): Pay the invoice directly using Cashu tokens.
5. **Unrecognized**: Show error.

Scanner UX should clearly handle unsupported payloads and permission/camera failures.

### 23. Onboarding

#### Getting Started Checklist

Shown on the contacts page for new users. Contains 5 tasks:

| Task | Completion Condition |
|------|---------------------|
| Add contact | At least one contact exists |
| Back up keys | User has copied their keys |
| Receive bitcoin | Cashu balance > 0 |
| Pay someone | User has made a payment |
| Send a message | Any outgoing message exists |

Shows progress. Each incomplete task should have a way to guide the user through it. Celebration when all 5 complete. Dismissible.

#### Interactive Guide

Step-by-step tutorials that highlight relevant UI elements and walk users through each onboarding task. Each guide auto-navigates to the correct screen and highlights the relevant action at each step. Users can skip, go back, or complete each guide.

### 24. Pages & Features

#### Page Inventory

**Main tabs:**
- Contacts list (home)
- Wallet overview

**Wallet flow:**
- Top-up amount entry
- Top-up invoice display (QR)
- Token inventory / manual import
- Individual Cashu token detail
- Individual Credo token detail

**Contact flow:**
- New contact form
- Contact detail
- Edit contact
- Pay a contact

**Chat:**
- Chat with contact

**Direct payment:**
- Pay lightning address directly

**Profile:**
- Profile view/edit with QR

**Settings:**
- Advanced settings
- Mints management
- Individual mint detail
- Nostr relays list / add / detail
- Evolu servers list / add / detail
- Data debug views (DB size, table browser, history browser)

#### App Structure

- **Authenticated state**: Main navigation with content area and tab bar
- **Unauthenticated state**: Landing page with account creation / nsec import options
- **Tab bar**: Two main tabs — Contacts and Wallet
- **Modals**: Profile QR, QR scanner, settings menu, save contact prompt, payment success

### 25. PWA & Push Notifications

#### Progressive Web App

- Offline support via local-first data + cached UI assets
- Installable as standalone app
- Runtime image caching

#### Push Notifications

**Notification server**: `https://linky-notifications.onrender.com` (configurable)

**Registration flow**:
1. Request browser notification permission
2. Subscribe via Service Worker PushManager with VAPID key
3. Send subscription data + npub + relay URLs to notification server
4. Server monitors Nostr relays for kind 1059 events addressed to registered npubs
5. Sends Web Push notification when DM detected

**Push event handling**:
- Show system notification
- Set app badge
- Coalesce notifications by contact
- Click handler: navigate to chat with that contact, clear badge

**Opt-in**: User-initiated in settings. Not automatic.

### 26. Internationalization

#### Languages

- **English** (en) — default for non-Czech browsers
- **Czech** (cs) — default if browser language starts with "cs"

#### Requirements

- ~430 translation keys per language
- Template variable support (e.g., `{variable}` substitution)
- Language persisted locally
- Switchable via settings
- Locale normalization: "cs" -> "cs-CZ", "en" -> "en-US"

#### Formatting Rules

- **Integers**: Locale-aware thousands separators
- **Message timestamps**: Same day -> time only, other day -> date
- **Chat day labels**: "Today" / "Yesterday" / weekday + date (localized)
- **Durations**: Short format like "1d 2h", "3h 45m", "52m"
- **Initials**: First letter of first 2 words, uppercase. Fallback "?"
- **Npub display**: Truncated with ellipsis for long values
- **General truncation**: "start...end" format

### 27. Export & Import

#### Export Format

```json
{
  "app": "linky",
  "version": 1,
  "exportedAt": "2024-01-15T10:30:00.000Z",
  "contacts": [
    { "name": "...", "npub": "...", "lnAddress": "...", "groupName": "..." }
  ],
  "cashuTokens": [
    { "token": "...", "rawToken": "...", "mint": "...", "unit": "...", "amount": 100, "state": "accepted", "error": null }
  ]
}
```

Only non-deleted records included.

#### Import Logic

**Contact merge**:
- For each imported contact: search for existing by npub OR lnAddress (case-insensitive)
- If exists: merge (imported fills missing fields, existing takes precedence)
- If new: insert

**Token merge**:
- For each imported token: check if token or rawToken already exists (exact match)
- If exists: skip
- If new: insert

Show result summary with counts of added/updated/imported.

### 28. LNURL-pay Protocol Details

#### Lightning Address Resolution

Convert `user@domain` -> `https://domain/.well-known/lnurlp/user` (split by last `@`, URL-encode user part).

#### Protocol Flow

1. **GET LNURL endpoint** -> extract `callback`, `minSendable`, `maxSendable`, `commentAllowed`
2. **Build callback URL**: append `?amount={amountMsat}` where `amountMsat = amountSat * 1000`
3. **Comment support**: If `commentAllowed > 0`, include comment up to that byte limit. Fallback: try with comment (up to 140 bytes), retry without if provider rejects.
4. **GET callback URL** -> extract BOLT11 invoice from `pr` or `paymentRequest` field
5. Validate `status !== "ERROR"` at each step

#### CORS Proxy

For cross-origin LNURL requests that fail due to CORS, a server-side proxy is needed. The proxy validates the URL and passes through the response with permissive CORS headers.

### 29. Deterministic Wallet Recovery

#### Purpose

Instead of random blinding factors for Cashu operations, uses a BIP-39 seed to derive them deterministically. Enables full wallet recovery from seed alone.

#### Seed Source

Uses the BIP-39 mnemonic derived from the nsec (see section 9). Converts to 64-byte seed.

#### Counter System

Each mint + unit + keyset ID combination has a monotonically increasing counter:
- Persisted locally
- Bumped after each operation by the number of outputs used
- **Collision handling**: If mint returns "outputs already signed", bump counter by 64 and retry (up to 5 times)

#### Concurrency Lock

Per-keyset serialization of async operations to prevent two operations from using the same counter range. Does NOT sync across browser tabs.

#### Wallet Restore

1. Collect all known proof secrets from existing tokens
2. Build mint candidates: from owned tokens + known mints + default mint
3. For each mint + unit + keyset:
   - Get saved restore cursor and deterministic counter
   - Scan from `max(0, highWater - 4000)` (4000-block lookback window)
   - Batch restore: scan for proofs in batches
   - Filter out already-known secrets, check spendability at mint (UNSPENT only)
   - If window finds nothing but counter > 0: deep scan from 0
   - Found proofs: group into token chunks, store locally
4. Report results (found count or "No missing tokens found")

---

## Part III: Cross-Cutting Concerns

### 30. State & Lifecycle Expectations

#### Message Lifecycle

- Outgoing message: `pending -> sent` (or retried/failed with user visibility).

#### Cashu Lifecycle

- Token/proof entries progress through `accepted -> spent/invalid-like` states as needed.
- Transient network errors must not be treated as definitive invalidity.

#### Credo Lifecycle

- `active -> partially settled -> fully settled` or `expired`.
- Active balance logic excludes expired or fully settled obligations.

#### Queue Lifecycle

- Queued local operations replay automatically on reconnect/resume.
- Replay should be idempotent and dedupe-safe.

### 31. Reliability and Error Handling

The rewrite should preserve resilient behavior:

- Prefer graceful degradation and queued retries over hard failure.
- Never silently lose value in partial/failed wallet operations.
- Give user-visible status for relay, mint, claim, and top-up failures.
- Keep scanner and parsing errors explicit and understandable.

### 32. Security and Trust Model

Current trust posture to preserve unless intentionally changed:

- App is early-stage and positioned for small-value personal use.
- User holds key material and must be able to back it up.
- Credo is trust-based and not collateralized.
- External relays/mints/services are part of normal operation and should be transparent to users.

If key storage or security posture changes, treat it as an explicit product decision, not an accidental rewrite side effect.

### 33. Nuances to Preserve

These behaviors are subtle but important:

- Message dedupe must handle multi-source replay (network + local queue).
- Offline contact payments should produce visible pending state and eventual replay.
- Claim ingestion should avoid conflicting with active wallet operations.
- Mint URL normalization/canonicalization should prevent duplicate or mismatched mint identities.
- Contact dedupe should not destroy historical context.

### 34. Persistent State Reference

The app needs to persist the following state across sessions:

| State | Description |
|-------|-------------|
| Nostr nsec | Master identity key |
| BIP-39 mnemonic | Evolu owner + Cashu deterministic seed |
| Language preference | "cs" or "en" |
| Bitcoin unit preference | BTC symbol vs "sat" |
| Pay with Cashu toggle | Enable Cashu payments (default: true) |
| Allow Promises toggle | Enable Credo promises (default: false) |
| Onboarding dismissed flag | Whether checklist was dismissed |
| Onboarding payment flag | Whether user has made a payment |
| Onboarding backup flag | Whether user has backed up keys |
| Cashu recovery vault | Recovery tokens for failed operations |
| Deterministic counter per keyset | `{mint}:{unit}:{keysetId}` -> counter number |
| Wallet restore cursor per keyset | Progress tracking for wallet restore |
| Evolu server list | Extra/disabled server URLs |
| Push notification npub | Registered push identity |
| Profile metadata cache per npub | Cached profile data (2-min negative TTL) |
| Avatar URL cache per npub | Cached avatar URLs (2-min negative TTL) |
| Mint override | User's preferred mint URL |
| Last accepted Cashu token | Crash recovery for most recent accepted token |

### 35. Protocol Reference

#### Nostr NIPs Implemented

| NIP | Kind | Description | Usage |
|-----|------|-------------|-------|
| NIP-01 | 0 | Basic protocol, profile metadata | Profile publishing/fetching |
| NIP-17 | 14 | Private Direct Messages (rumor) | Chat message content (unsigned, wrapped) |
| NIP-19 | - | bech32 encoding (npub, nsec) | Key encoding/decoding |
| NIP-59 | 1059 | Gift Wrapping | Encrypts kind 14 messages for transport |
| NIP-65 | 10002 | Relay List Metadata | Relay list publishing/fetching |
| NIP-98 | 27235 | HTTP Auth | npub.cash API authentication |

#### Cashu

- **Token formats**: V3 (`cashuA` + base64url JSON) and V4 (`cashuB` + base64url CBOR)
- **Operations**: mint (Lightning->ecash), swap, send, receive, melt (ecash->Lightning)
- **Deterministic outputs**: BIP-39 seed -> per-keyset counter -> reproducible blinding factors
- **Multi-mint**: Tokens organized by mint URL, payments try mints in priority order

#### Credo

- **Wire format**: `credoA` + base64url(UTF-8(JSON))
- **Promise**: Signed by issuer (Schnorr/secp256k1), contains amount, expiry, nonce
- **Settlement**: Signed by recipient, references promise_id, supports partial amounts
- **Promise ID**: SHA-256 of canonical JSON (sorted keys, no whitespace)
- **Default expiry**: 30 days
- **Total cap**: 100,000 sat max outstanding outgoing promises
- **Regex extraction**: `/credoA[0-9A-Za-z_-]+/`

#### npub.cash

- **Lightning address**: `{npub}@npub.cash` (automatic for every user)
- **API**: REST with NIP-98 auth
- **Purpose**: Lightning->Cashu bridge (receive Lightning payments as claimable Cashu tokens)

#### External Service Contracts Summary

| Service | Auth | Endpoints |
|---------|------|-----------|
| npub.cash (`https://npub.cash`) | NIP-98 | GET /api/v1/info, GET /api/v1/claim, PUT /api/v1/info/mint |
| Cashu Mints | None | POST /v1/mint/quote/bolt11, standard Cashu protocol |
| Push Server (`https://linky-notifications.onrender.com`) | None | POST /subscribe, POST /unsubscribe |
| Nostr Relays | None | Default: relay.damus.io, nos.lol, relay.0xchat.com |
