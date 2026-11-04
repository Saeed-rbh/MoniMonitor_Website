import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { OperationalBanner, OperationalStatusPage } from './OperationalStatus';
afterEach(cleanup);
const data = {status:'degraded',checkedAt:'2026-11-02T12:00:00Z',agent:{connected:false},pending:{count:2,oldestAt:'2026-11-02T11:00:00Z'},reviewCount:1,notifications:{count:0},issues:['mail_disconnected'],unresolvedTotal:3,unresolved:[{sourceKey:'private-id',status:'review_required',attempts:2,lastError:'Account identity is ambiguous',transactionId:12}]};
test('status banner links to detailed operations page',()=>{
 render(<MemoryRouter><OperationalBanner remote={{data}} /></MemoryRouter>);
 expect(screen.getByRole('link').getAttribute('href')).toBe('/Status');
 expect(screen.getByRole('link').textContent).toContain('needs attention');
});
test('status page displays queue, review reason, next action and refresh control',()=>{
 const refresh=vi.fn(); render(<OperationalStatusPage remote={{data,refresh}} />);
 expect(screen.getByText('Account identity is ambiguous')).toBeTruthy();
 expect(screen.getByText('Showing 1 of 3 unresolved emails, oldest first.')).toBeTruthy();
 expect(screen.getByText(/mailbox is disconnected/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Refresh status'})); expect(refresh).toHaveBeenCalledOnce();
});
test('unavailable status is never presented as healthy or empty',()=>{
 render(<OperationalStatusPage remote={{error:new Error('offline'),refresh:vi.fn()}} />);
 expect(screen.getByRole('alert')).toBeTruthy(); expect(screen.queryByText('Ingestion running')).toBeNull();
 expect(screen.queryByText('No unresolved emails recorded.')).toBeNull();
});
