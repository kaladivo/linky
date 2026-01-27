import React from "react";

interface WalletBalanceProps {
  balance: number;
  displayUnit: string;
  formatInteger: (num: number) => string;
  ariaLabel: string;
}

export const WalletBalance: React.FC<WalletBalanceProps> = ({
  balance,
  displayUnit,
  formatInteger,
  ariaLabel,
}) => {
  return (
    <div className="balance-hero" aria-label={ariaLabel}>
      <span className="balance-number">{formatInteger(balance)}</span>
      <span className="balance-unit">{displayUnit}</span>
    </div>
  );
};
