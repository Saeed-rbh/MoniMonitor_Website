import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../utils/modalFocus';

export default function ProfileDialog({ label, closing, onClose, children }) {
  const ref = useRef(null);
  useModalFocus(true, ref, onClose);
  return createPortal(
    <div className={`modal-overlay ${closing ? 'closing' : ''}`} ref={ref}
      role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      {children}
    </div>, document.body,
  );
}
