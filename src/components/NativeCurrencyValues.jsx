import React from 'react';

export default function NativeCurrencyValues({ totals = [], baseCurrency = 'CAD' }) {
  const separate = totals.filter((total) => total.currency !== baseCurrency &&
    [total.totalCashMinor, total.totalLiabilitiesMinor, total.holdingsValueMinor].some((amount) => amount !== 0));
  if (!separate.length) return null;
  return <div aria-label="Separate native currency values">
    {separate.map((total) => <p key={total.currency}>
      {total.currency}: {new Intl.NumberFormat(undefined, { style: 'currency', currency: total.currency }).format(total.totalValueMinor / 100)}
      {' · kept separately; no conversion'}
    </p>)}
  </div>;
}
