import { useEffect, useRef } from 'react';

const stack = [];
const original = new Map();
let previousOverflow;
const focusable = node => [...node.querySelectorAll('button, [href], input, select, textarea, [tabindex]')]
    .filter(element => element.tabIndex >= 0 && !element.disabled && !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
        getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');

function isolate() {
    for (const [node, saved] of original) {
        node.inert = saved.inert;
        if (saved.hidden === null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', saved.hidden);
    }
    const top = stack.at(-1);
    if (!top) { original.clear(); document.body.style.overflow = previousOverflow; return; }
    for (const node of document.body.children) {
        if (node.contains(top.node)) continue;
        if (!original.has(node)) original.set(node, { inert: Boolean(node.inert), hidden: node.getAttribute('aria-hidden') });
        node.inert = true; node.setAttribute('aria-hidden', 'true');
    }
}

function keydown(event) {
    const top = stack.at(-1);
    if (!top) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); top.close(); }
    if (event.key !== 'Tab') return;
    const elements = focusable(top.node);
    const first = elements[0] || top.node, last = elements.at(-1) || top.node;
    if (!elements.length || !elements.includes(document.activeElement) ||
        (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
    }
}
function focusin(event) {
    const top = stack.at(-1);
    if (top && !top.node.contains(event.target)) (focusable(top.node)[0] || top.node).focus();
}

export function useModalFocus(open, ref, onClose) {
    const close = useRef(onClose);
    close.current = onClose;
    useEffect(() => {
        if (!open || !ref.current) return;
        const entry = { node: ref.current, returnFocus: document.activeElement, close: () => close.current() };
        if (!stack.length) {
            previousOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            document.addEventListener('keydown', keydown, true);
            document.addEventListener('focusin', focusin, true);
        }
        stack.push(entry); isolate();
        (focusable(entry.node)[0] || entry.node).focus();
        return () => {
            const wasTop = stack.at(-1) === entry;
            stack.splice(stack.indexOf(entry), 1); isolate();
            if (!stack.length) {
                document.removeEventListener('keydown', keydown, true);
                document.removeEventListener('focusin', focusin, true);
            }
            if (wasTop && entry.returnFocus?.isConnected && !entry.returnFocus.closest('[inert]')) entry.returnFocus.focus();
        };
    }, [open, ref]);
}
