import React, { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import ProfileDialog from './ProfileDialog';
import { actionKeyboard } from '../utils/actionKeyboard';
import { ScalableElement } from '../utils/tools';

afterEach(cleanup);
function ProfileFlow() {
  const [open, setOpen] = useState(false);
  return <><div {...actionKeyboard(() => setOpen(true))} onClick={() => setOpen(true)}>Currency</div>
    {open && <ProfileDialog label="Currency" onClose={() => setOpen(false)}>
      <button onClick={() => setOpen(false)}>Close currency</button><button>CAD</button>
    </ProfileDialog>}</>;
}
it('profile settings open by keyboard, trap focus and restore the opener after Escape', () => {
  render(<ProfileFlow />);
  const opener = screen.getByRole('button', { name: 'Currency' });
  opener.focus(); fireEvent.keyDown(opener, { key: 'Enter' });
  expect(screen.getByRole('dialog', { name: 'Currency' })).toHaveAttribute('aria-modal', 'true');
  const close = screen.getByRole('button', { name: 'Close currency' });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(screen.getByRole('button', { name: 'CAD' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(opener).toHaveFocus();
});
it('space activates animated navigation once and disabled profile actions stay out of tab order', () => {
  let clicks = 0;
  render(<><ScalableElement as="p" aria-label="Add transaction" onClick={() => clicks++}>+</ScalableElement>
    <div {...actionKeyboard(undefined)}>Connecting bank</div></>);
  const action = screen.getByRole('button', { name: 'Add transaction' });
  action.focus(); fireEvent.keyDown(action, { key: ' ' });
  fireEvent.keyDown(action, { key: ' ', repeat: true });
  expect(clicks).toBe(1);
  expect(screen.getByRole('button', { name: 'Connecting bank' })).toHaveAttribute('tabindex', '-1');
});
