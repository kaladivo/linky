import {
  bumpCashuDeterministicCounter,
  getCashuDeterministicCounter,
  getCashuDeterministicSeedFromStorage,
} from "./utils/cashuDeterministic";
import { getCashuLib } from "./utils/cashuLib";

type CashuPayResult = {
  ok: true;
  mint: string;
  unit: string | null;
  paidAmount: number;
  feeReserve: number;
  // Actual fee charged by the mint (may be 0 even if feeReserve > 0).
  feePaid: number;
  remainingAmount: number;
  remainingToken: string | null;
};

type CashuPayErrorResult = {
  ok: false;
  mint: string;
  unit: string | null;
  paidAmount: number;
  feeReserve: number;
  feePaid: number;
  // If we already swapped, this token should represent the user's funds.
  remainingAmount: number;
  remainingToken: string | null;
  error: string;
};

type Proof = {
  amount: number;
  secret: string;
  C: string;
  id: string;
};

const getProofAmountSum = (proofs: Array<{ amount: number }>) =>
  proofs.reduce((sum, proof) => sum + proof.amount, 0);

export const meltInvoiceWithTokensAtMint = async (args: {
  invoice: string;
  mint: string;
  tokens: string[];
  unit?: string | null;
}): Promise<CashuPayResult | CashuPayErrorResult> => {
  const { invoice, mint, tokens, unit } = args;
  const { CashuMint, CashuWallet, getDecodedToken, getEncodedToken } =
    await getCashuLib();

  const det = getCashuDeterministicSeedFromStorage();

  const allProofs: Proof[] = [];

  try {
    for (const tokenText of tokens) {
      const decoded = getDecodedToken(tokenText);
      if (!decoded?.mint) throw new Error("Token mint missing");
      if (decoded.mint !== mint) throw new Error("Mixed mints not supported");
      for (const proof of decoded.proofs ?? []) {
        allProofs.push({
          amount: Number(proof.amount ?? 0),
          secret: proof.secret,
          C: proof.C,
          id: proof.id,
        });
      }
    }
  } catch (e) {
    return {
      ok: false,
      mint,
      unit: unit ?? null,
      paidAmount: 0,
      feeReserve: 0,
      feePaid: 0,
      remainingAmount: 0,
      remainingToken: null,
      error: String(e ?? "decode failed"),
    };
  }

  const wallet = new CashuWallet(new CashuMint(mint), {
    ...(unit ? { unit } : {}),
    ...(det ? { bip39seed: det.bip39seed } : {}),
  });

  try {
    await wallet.loadMint();

    const walletUnit = wallet.unit;
    const keysetId = wallet.keysetId;
    const counter0 = det
      ? getCashuDeterministicCounter({
          mintUrl: mint,
          unit: walletUnit,
          keysetId,
        })
      : undefined;

    const quote = await wallet.createMeltQuote(invoice);
    const paidAmount = quote.amount ?? 0;
    const feeReserve = quote.fee_reserve ?? 0;
    const total = paidAmount + feeReserve;

    const have = getProofAmountSum(allProofs);
    if (have < total) {
      return {
        ok: false,
        mint,
        unit: unit ?? null,
        paidAmount,
        feeReserve,
        feePaid: 0,
        remainingAmount: have,
        remainingToken: null,
        error: `Insufficient funds (need ${total}, have ${have})`,
      };
    }

    // Swap to get exact proofs for amount+fees; returns keep+send proofs.
    const swapped = await wallet.swap(
      total,
      allProofs,
      typeof counter0 === "number" ? { counter: counter0 } : undefined
    );

    let counterAfterSwap = counter0;
    if (det && typeof counter0 === "number") {
      const keepLen = Array.isArray(swapped.keep) ? swapped.keep.length : 0;
      const sendLen = Array.isArray(swapped.send) ? swapped.send.length : 0;
      counterAfterSwap = bumpCashuDeterministicCounter({
        mintUrl: mint,
        unit: walletUnit,
        keysetId,
        used: keepLen + sendLen,
      });
    }

    // If anything fails after this point, old proofs may already be invalid.
    // So we prepare a "recovery" token from the swapped proofs.
    const recoveryProofs = [...(swapped.keep ?? []), ...(swapped.send ?? [])];
    const recoveryAmount = getProofAmountSum(recoveryProofs);
    const recoveryToken =
      recoveryProofs.length > 0
        ? getEncodedToken({
            mint,
            proofs: recoveryProofs,
            unit: walletUnit,
          })
        : null;

    let melt:
      | {
          change?: Proof[];
          fee_paid?: unknown;
          feePaid?: unknown;
          fee?: unknown;
        }
      | (Record<string, unknown> & { change?: Proof[] });

    try {
      melt = (await wallet.meltProofs(
        quote,
        swapped.send,
        det && typeof counterAfterSwap === "number"
          ? { counter: counterAfterSwap }
          : undefined
      )) as any;
    } catch (e) {
      return {
        ok: false,
        mint,
        unit: unit ?? null,
        paidAmount,
        feeReserve,
        feePaid: 0,
        remainingAmount: recoveryAmount,
        remainingToken: recoveryToken,
        error: String(e ?? "melt failed"),
      };
    }

    if (det && typeof counterAfterSwap === "number") {
      bumpCashuDeterministicCounter({
        mintUrl: mint,
        unit: walletUnit,
        keysetId,
        used: Array.isArray(melt.change) ? melt.change.length : 0,
      });
    }

    const feePaid = (() => {
      const m = melt as unknown as Record<string, unknown>;
      const raw =
        (m.fee_paid as unknown) ??
        (m.feePaid as unknown) ??
        (m.fee as unknown) ??
        0;
      const n = Number(raw ?? 0);
      return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
    })();

    const remainingProofs = [...(swapped.keep ?? []), ...(melt.change ?? [])];
    const remainingAmount = getProofAmountSum(remainingProofs);

    const remainingToken =
      remainingProofs.length > 0
        ? getEncodedToken({
            mint,
            proofs: remainingProofs,
            unit: walletUnit,
          })
        : null;

    return {
      ok: true,
      mint,
      unit: walletUnit,
      paidAmount,
      feeReserve,
      feePaid,
      remainingAmount,
      remainingToken,
    };
  } catch (e) {
    return {
      ok: false,
      mint,
      unit: unit ?? null,
      paidAmount: 0,
      feeReserve: 0,
      feePaid: 0,
      remainingAmount: getProofAmountSum(allProofs),
      remainingToken: null,
      error: String(e ?? "melt failed"),
    };
  }
};
