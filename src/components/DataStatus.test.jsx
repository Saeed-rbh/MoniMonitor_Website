import React from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import DataStatus from './DataStatus';
afterEach(cleanup);
test('initial failure offers retry and stale failure identifies cached data',()=>{
 const retry=vi.fn(); const {rerender}=render(<DataStatus error={new Error('offline')} refresh={retry} />);
 expect(screen.getByRole('alert').textContent).toContain('could not be loaded');
 fireEvent.click(screen.getByRole('button',{name:'Retry'})); expect(retry).toHaveBeenCalledOnce();
 rerender(<DataStatus error={new Error('offline')} refresh={retry} lastUpdated={new Date('2026-11-02T12:00:00Z')} />);
 expect(screen.getByRole('alert').textContent).toContain('Showing data last updated');
});
