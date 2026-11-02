import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import MoneyEntryAmount from './MoneyEntryAmount';
vi.mock('@/components/ui/blur-fade',()=>({default:({children,className,style})=><div className={className} style={style}>{children}</div>}));
it('shows Invest activity rather than cash savings and opens the matching transaction view',()=>{
 const setCategory=vi.fn(),navigate=vi.fn();
 const {rerender}=render(<MoneyEntryAmount type="Invest" transaction={{totalInvest:200,totalSaving:1000,netTotal:0}} setIsMoreClicked={setCategory} redirectClick={navigate} index={0}/>);
 expect(screen.getByRole('heading',{name:'$200.00'})).toBeInTheDocument();
 expect(screen.queryByText(/Save.*Invest/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByText('Invest'));expect(setCategory).toHaveBeenCalledWith('Invest');expect(navigate).toHaveBeenCalledWith('/Transactions');
 rerender(<MoneyEntryAmount type="Invest" transaction={{totalSaving:1000,netTotal:0}} setIsMoreClicked={setCategory} redirectClick={navigate} index={0}/>);
 expect(screen.getByRole('heading',{name:'$0.00'})).toBeInTheDocument();
});
