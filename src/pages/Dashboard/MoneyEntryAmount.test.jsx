import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import MoneyEntryAmount from './MoneyEntryAmount';
vi.mock('@react-spring/web', () => ({ useSpring: styles => styles, animated: { div: ({ children, ...props }) => <div {...props}>{children}</div> } }));
vi.mock('@/components/ui/blur-fade', () => ({ default: ({ children, delay, duration, ...props }) => <div {...props}>{children}</div> }));
afterEach(cleanup);
const props = { type:'Save&Invest', transaction:{totalSaving:75,netTotal:0},index:1,setIsMoreClicked:vi.fn(),redirectClick:vi.fn() };
test('mixed-currency portfolio displays each currency, never the null scalar as zero',()=>{
 render(<MoneyEntryAmount {...props} portfolio={{accountCount:2,totalValueMinor:null,totalsByCurrency:[{currency:'CAD',totalValueMinor:10000},{currency:'USD',totalValueMinor:25000}]}} />);
 const values=screen.getByLabelText('Portfolio values by currency');
 expect(values.textContent).toMatch(/CAD\s*100\.00/); expect(values.textContent).toMatch(/USD\s*250\.00/);
 expect(values.children).toHaveLength(2);
 expect(screen.queryByRole('heading',{level:1})).toBeNull();
});
test('single-currency portfolio keeps its currency and negative liability sign',()=>{
 render(<MoneyEntryAmount {...props} portfolio={{accountCount:1,totalsByCurrency:[{currency:'CAD',totalValueMinor:-2500}]}} />);
 expect(screen.getByLabelText('Portfolio values by currency').textContent).toMatch(/-CAD\s*25\.00/);
});
test('empty portfolio retains total contributed fallback',()=>{
 render(<MoneyEntryAmount {...props} portfolio={{accountCount:0,totalsByCurrency:[]}} />);
 expect(screen.getByRole('heading',{level:2}).textContent).toContain('Total contributed');
 expect(screen.getByRole('heading',{level:1}).textContent).toContain('75.00');
});
test('loading and unavailable portfolio states never display a made-up balance',()=>{
 const {rerender}=render(<MoneyEntryAmount {...props} portfolioLoading />);
 expect(screen.getByRole('status').textContent).toBe('Loading…');
 rerender(<MoneyEntryAmount {...props} portfolioError />);
 expect(screen.getByRole('status').textContent).toBe('Unavailable');
 expect(screen.queryByRole('heading',{level:1})).toBeNull();
});
