import React from 'react';
import { useTransactions } from '../context/TransactionContext';

export default function CurrencyNotice() {
  const { allTransactions } = useTransactions();
  const currencies = [...new Set(Object.values(allTransactions).flatMap((month) => month?.otherCurrencies || []))];
  if (!currencies.length) return null;
  return <p role="status" style={{ margin: '8px 12px', fontSize: '.85rem' }}>
    Reports are in CAD. {currencies.join(', ')} activity is kept separately in Accounts; amounts are not converted.
  </p>;
}
