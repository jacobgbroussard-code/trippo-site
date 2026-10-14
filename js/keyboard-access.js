/* ==========================================================================
   Trippo Travel Planner - Keyboard & screen-reader access for tap targets
   js/keyboard-access.js

   Much of the UI uses clickable divs (trip cards, bottom nav, list rows),
   which keyboards can't reach and screen readers don't announce as buttons.
   This marks every such element as a focusable button, including ones rendered
   later, and lets Enter / Space activate it like a real button.
   ========================================================================== */

const NATIVE = 'a, button, input, select, textarea, label, option, summary';

function isTapTarget(el) {
    if (!(el instanceof HTMLElement) || !el.hasAttribute('onclick') || el.matches(NATIVE)) return false;
    const handler = el.getAttribute('onclick').trim();
    // Modal backdrops and click shields aren't controls.
    if (el.classList.contains('modal') || /^event\.stopPropagation\(\);?$/.test(handler)) return false;
    return true;
}

function enhance(el) {
    if (!isTapTarget(el)) return;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
}

function enhanceTree(root) {
    if (!(root instanceof Element)) return;
    enhance(root);
    root.querySelectorAll('[onclick]').forEach(enhance);
}

export function initKeyboardAccess() {
    enhanceTree(document.body);

    new MutationObserver(mutations => {
        for (const m of mutations) m.addedNodes.forEach(enhanceTree);
    }).observe(document.body, { childList: true, subtree: true });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const el = e.target;
        if (!isTapTarget(el) || el.getAttribute('role') !== 'button') return;
        e.preventDefault(); // Space would otherwise scroll the page
        el.click();
    });
}
