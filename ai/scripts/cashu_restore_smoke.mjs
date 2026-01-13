import { CashuMint, CashuWallet } from "@cashu/cashu-ts";
import { mnemonicToSeedSync } from "@scure/bip39";

const mintUrl = process.env.MINT_URL || "https://testnut.cashu.space";
const unit = process.env.UNIT || "sat";

// BIP39 test vector mnemonic.
const mnemonic =
  process.env.MNEMONIC ||
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const amount = Number(process.env.AMOUNT || 123);
const passphrase =
  process.env.PASS || `linky-${Date.now()}-${Math.random().toString(16)}`;

const run = async () => {
  const bip39seed = mnemonicToSeedSync(mnemonic, passphrase);

  console.log("[restore-smoke] mint", { mintUrl, unit, amount });
  console.log("[restore-smoke] seed", {
    mnemonicPrefix: mnemonic.split(" ").slice(0, 3).join(" "),
    passphrasePrefix: String(passphrase).slice(0, 12),
  });

  const wallet = new CashuWallet(new CashuMint(mintUrl), { unit, bip39seed });
  await wallet.loadMint();

  console.log("[restore-smoke] wallet loaded", {
    unit: wallet.unit,
    keysetId: wallet.keysetId,
  });

  const quote = await wallet.createMintQuote(amount, "linky restore smoke");
  console.log("[restore-smoke] mint quote", {
    quote: quote.quote,
    state: quote.state,
  });

  // testnut mint uses FakeWallet: invoices are effectively always paid.
  const proofs = await wallet.mintProofs(amount, quote.quote, { counter: 0 });
  console.log("[restore-smoke] minted proofs", {
    count: proofs.length,
    sum: proofs.reduce((s, p) => s + (Number(p.amount ?? 0) || 0), 0),
    firstSecret: String(proofs[0]?.secret ?? "").slice(0, 16),
  });

  const wallet2 = new CashuWallet(new CashuMint(mintUrl), { unit, bip39seed });
  await wallet2.loadMint();

  const restored = await wallet2.batchRestore(300, 100, 0, wallet.keysetId);
  console.log("[restore-smoke] restored", {
    proofs: restored.proofs.length,
    lastCounterWithSignature: restored.lastCounterWithSignature,
    sum: restored.proofs.reduce((s, p) => s + (Number(p.amount ?? 0) || 0), 0),
  });

  const mintedSecrets = new Set(proofs.map((p) => String(p.secret ?? "")));
  const restoredSecrets = new Set(
    restored.proofs.map((p) => String(p.secret ?? ""))
  );

  let overlap = 0;
  for (const s of mintedSecrets) if (restoredSecrets.has(s)) overlap += 1;

  console.log("[restore-smoke] secret overlap", {
    minted: mintedSecrets.size,
    restored: restoredSecrets.size,
    overlap,
  });

  if (overlap === 0) {
    throw new Error(
      "No overlap between minted and restored secrets (restore not working as expected)."
    );
  }
};

run().catch((e) => {
  console.error("[restore-smoke] failed", e);
  process.exitCode = 1;
});
