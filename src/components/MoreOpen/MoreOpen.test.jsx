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
