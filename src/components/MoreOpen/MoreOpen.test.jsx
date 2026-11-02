import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MoreOpen from './MoreOpen';
const sheet = (open, close = vi.fn(), label = 'Edit account') => <MoreOpen isClicked={open} setIsClicked={close}
    dialogLabel={label} feed={() => <><input aria-label="Account name" /><button>Save account</button></>} />;

describe('Shared sheet keyboard access', () => {
    it('announces a dialog, traps focus, closes with Escape, and restores the opener', () => {
        const close = vi.fn();
        const { rerender } = render(<MemoryRouter><button>Open account</button>{sheet(false, close)}</MemoryRouter>);
        const opener = screen.getByRole('button', { name: 'Open account' }); opener.focus();
        rerender(<MemoryRouter><button>Open account</button>{sheet(true, close)}</MemoryRouter>);
        expect(screen.getByRole('dialog', { name: 'Edit account' }).getAttribute('aria-modal')).toBe('true');
        const first = screen.getByRole('button', { name: 'Close dialog' });
        const last = screen.getByRole('button', { name: 'Save account' });
        expect(document.activeElement).toBe(first);
        fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(last);
        fireEvent.keyDown(last, { key: 'Tab' });
        expect(document.activeElement).toBe(first);
        opener.focus(); expect(document.activeElement).toBe(first);
        fireEvent.keyDown(first, { key: 'Escape' }); expect(close).toHaveBeenCalledWith(null);
        rerender(<MemoryRouter><button>Open account</button>{sheet(false, close)}</MemoryRouter>);
        expect(document.activeElement).toBe(opener);
        expect(document.body.style.overflow).toBe('');
    });
    it('allows only the top nested dialog to receive Escape and restores its parent focus', () => {
        const outerClose = vi.fn(), innerClose = vi.fn();
        const { rerender } = render(<MemoryRouter>{sheet(true, outerClose, 'Outer')}{sheet(false, innerClose, 'Inner')}</MemoryRouter>);
        const outerFocus = document.activeElement;
        rerender(<MemoryRouter>{sheet(true, outerClose, 'Outer')}{sheet(true, innerClose, 'Inner')}</MemoryRouter>);
        fireEvent.keyDown(document.activeElement, { key: 'Escape' });
        expect(innerClose).toHaveBeenCalledOnce(); expect(outerClose).not.toHaveBeenCalled();
        rerender(<MemoryRouter>{sheet(true, outerClose, 'Outer')}{sheet(false, innerClose, 'Inner')}</MemoryRouter>);
        expect(document.activeElement).toBe(outerFocus);
    });
});


describe('Shared sheet header boundary', () => {
    it('keeps the sheet and backdrop below an overflowing month selector after resize', () => {
        const header = document.createElement('header');
        header.className = 'MoneyMonitor_header';
        const selector = document.createElement('div');
        selector.setAttribute('data-header-month-selector', '');
        header.appendChild(selector);
        document.body.appendChild(header);
        let selectorBottom = 72;
        header.getBoundingClientRect = () => ({ bottom: 55 });
        selector.getBoundingClientRect = () => ({ bottom: selectorBottom });
        try {
            render(<MemoryRouter><MoreOpen isClicked fillAvailable setIsClicked={vi.fn()}
                feed={() => <p>Transactions</p>} /></MemoryRouter>);
            const dialog = screen.getByRole('dialog');
            const backdrop = document.querySelector('.MoreOpen_Backdrop');
            expect(dialog.style.maxHeight).toBe('calc(100dvh - 80px)');
            expect(dialog.style.height).toBe('calc(100dvh - 80px)');
            expect(backdrop.style.top).toBe('80px');
            selectorBottom = 88;
            fireEvent(window, new Event('resize'));
            expect(dialog.style.maxHeight).toBe('calc(100dvh - 96px)');
            expect(backdrop.style.top).toBe('96px');
        } finally {
            header.remove();
        }
    });
});
