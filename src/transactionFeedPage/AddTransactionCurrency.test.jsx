import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import AddTransactionFeed from './AddTransactionFeed';
vi.mock('../context/TransactionContext',()=>({useTransactions:()=>({currency:'USD'})}));
vi.mock('../hooks/useRemoteData',()=>({useRemoteData:()=>({data:{accounts:[{id:1,name:'CAD chequing',currency:'CAD'},{id:2,name:'USD savings',currency:'USD'}]}})}));
vi.mock('../utils/tools',()=>({useWindowHeight:()=>700,ScalableElement:({children})=><div>{children}</div>}));
vi.mock('@react-spring/web',()=>({useSpring:()=>({}),animated:{div:({children,...props})=><div {...props}>{children}</div>}}));
afterEach(cleanup);
test('account selection derives the currency and carries both through transaction submission',()=>{
 const save=vi.fn();
 render(<AddTransactionFeed isAddClicked="Expense" setIsClicked={vi.fn()} setAddTransaction={save} addTransaction={{id:1,Amount:10,Label:'Other',Timestamp:'2026-10-01T12:00:00Z'}} setModify={vi.fn()} setOpen={vi.fn()} />);
 fireEvent.change(screen.getByLabelText('Transaction account'),{target:{value:'1'}});
 expect(screen.getByLabelText('Transaction currency').value).toBe('CAD');
 expect(screen.getByLabelText('Transaction currency').readOnly).toBe(true);
 fireEvent.submit(screen.getByLabelText('Transaction currency').closest('form'));
 expect(save).toHaveBeenCalledWith(expect.objectContaining({Currency:'CAD',BalanceAccountId:1,Amount:10}));
});
