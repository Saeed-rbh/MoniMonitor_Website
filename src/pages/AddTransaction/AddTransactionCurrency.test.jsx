import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import AddTransaction from './AddTransaction';
const mocks=vi.hoisted(()=>({send:vi.fn(),navigate:vi.fn(),refresh:vi.fn(),setCategory:vi.fn()}));
vi.mock('react-router-dom',()=>({useNavigate:()=>mocks.navigate}));
vi.mock('../../context/TransactionContext',()=>({useTransactions:()=>({isAddClicked:'Expense',setIsAddClicked:mocks.setCategory,monthData:{refresh:mocks.refresh}})}));
vi.mock('../../services/apiService',()=>({sendDataToDB:mocks.send}));
vi.mock('../../utils/tools',()=>({useWindowHeight:()=>700}));
vi.mock('../../components/MoreOpen/MoreOpen',()=>({default:({feed:Feed})=><Feed/>}));
vi.mock('../../transactionFeedPage/AddTransactionFeed',()=>({default:({setAddTransaction,setOpen})=><button onClick={()=>{setAddTransaction({Amount:10,Category:'Expense',Currency:'CAD',BalanceAccountId:1});setOpen(true);}}>Save test transaction</button>}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
test('manual-entry page persists selected account and currency before navigating',async()=>{
 mocks.send.mockResolvedValue({message:'Created'});render(<AddTransaction/>);
 fireEvent.click(screen.getByRole('button'));
 await waitFor(()=>expect(mocks.navigate).toHaveBeenCalledWith('/'));
 expect(mocks.send).toHaveBeenCalledWith({record_entry:expect.objectContaining({Currency:'CAD',BalanceAccountId:1}),record_type:undefined});
 expect(mocks.refresh).toHaveBeenCalledOnce();
});
test('failed manual save shows an error and keeps the form available',async()=>{
 mocks.send.mockResolvedValue({status:'error',message:'Currency does not match'});render(<AddTransaction/>);
 fireEvent.click(screen.getByRole('button'));
 expect(await screen.findByText('Currency does not match')).toBeTruthy();expect(mocks.navigate).not.toHaveBeenCalled();
});
