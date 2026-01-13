import {
  bumpCashuDeterministicCounter,
  getCashuDeterministicCounter,
  getCashuDeterministicSeedFromStorage,
} from "./utils/cashuDeterministic";
import { getCashuLib } from "./utils/cashuLib";

type CashuAcceptResult = {
  mint: string;
  unit: string | null;
  amount: number;
  token: string;
};

export const acceptCashuToken = async (
  rawToken: string
): Promise<CashuAcceptResult> => {
  const tokenText = rawToken.trim();
  if (!tokenText) throw new Error("Empty token");

  const { CashuMint, CashuWallet, getDecodedToken, getEncodedToken } =
    await getCashuLib();

  const decoded = getDecodedToken(tokenText);
  const mintUrl = decoded.mint;
  if (!mintUrl) throw new Error("Token mint missing");

  const det = getCashuDeterministicSeedFromStorage();

  const wallet = new CashuWallet(new CashuMint(mintUrl), {
    ...(decoded.unit ? { unit: decoded.unit } : {}),
    ...(det ? { bip39seed: det.bip39seed } : {}),
  });

  await wallet.loadMint();

  const unit = wallet.unit;
  const keysetId = wallet.keysetId;
  const counter = det
    ? getCashuDeterministicCounter({ mintUrl, unit, keysetId })
    : undefined;

  // This performs a swap at the mint, returning fresh proofs.
  const proofs = await wallet.receive(
    decoded,
    typeof counter === "number" ? { counter } : undefined
  );

  if (det) {
    bumpCashuDeterministicCounter({
      mintUrl,
      unit,
      keysetId,
      used: Array.isArray(proofs) ? proofs.length : 0,
    });
  }

  const amount = proofs.reduce((sum, proof) => sum + (proof.amount ?? 0), 0);

  const acceptedToken = getEncodedToken({
    mint: mintUrl,
    proofs,
    unit,
    ...(decoded.memo ? { memo: decoded.memo } : {}),
  });

  return {
    mint: mintUrl,
    unit,
    amount,
    token: acceptedToken,
  };
};
