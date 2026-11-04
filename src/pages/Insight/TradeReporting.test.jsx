import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import InsightCategoryBreakdown from './InsightCategoryBreakdown';
vi.mock('../../context/TransactionContext',()=>({useTransactions:()=>({currency:'CAD'})}));
afterEach(cleanup);
test('security purchases with Debit type do not appear in spending breakdowns',()=>{
 render(<InsightCategoryBreakdown transactions={[
  {Category:'Saving',Type:'Debit',PortfolioAction:'BUY',Amount:100,Label:'Security purchase'},
  {Category:'Saving',Type:'Credit',PortfolioAction:'SELL',Amount:120,Label:'Security sale'},
  {Category:'Saving',Type:'Debit',PortfolioPostingKind:'EMAIL_BUY',Amount:50,Label:'Old security purchase'},
 ]} />);
 expect(screen.getByText('No Expense Data')).toBeTruthy();
 expect(screen.queryByText('Security purchase')).toBeNull();
 expect(screen.queryByText('Old security purchase')).toBeNull();
});
