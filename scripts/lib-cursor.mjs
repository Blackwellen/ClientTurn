/**
 * A pointer drawn into the page, for screencasts.
 *
 * Its own module so the recorder and anything that checks the recorder share
 * one copy. Exported as a string rather than a function because it is injected
 * with `addInitScript`, which serialises it into a fresh context.
 */

/**
 * Draws a pointer into the page that follows the mouse and pulses on click.
 *
 * This is not decoration, it is the difference between a usable screencast and
 * an unusable one. Playwright's input is **synthetic**: `page.mouse.move` and
 * `.click` dispatch DOM events and never touch the operating system's cursor.
 * So the browser has no pointer to paint, and the recording shows a UI that
 * changes on its own with nothing driving it — which reads as a video edit
 * rather than a demonstration.
 *
 * A screen-recording extension does not fix this, and it is worth saying why
 * before somebody tries: it would capture the real desktop cursor, which is
 * wherever the person left it, motionless, while the automation clicks
 * elsewhere. Drawing the pointer is the only way to show the thing that is
 * actually doing the clicking.
 *
 * Injected as an init script so it survives every navigation, and marked
 * `pointer-events: none` so the cursor can never intercept the click it exists
 * to illustrate.
 */
export const CURSOR_SCRIPT = `
(() => {
  if (window.__ctCursorInstalled) return;
  window.__ctCursorInstalled = true;

  const install = () => {
    if (!document.body || document.getElementById('__ct_cursor')) return;

    const style = document.createElement('style');
    style.textContent = \`
      #__ct_cursor {
        position: fixed; left: 0; top: 0; width: 22px; height: 22px;
        margin: -3px 0 0 -3px; z-index: 2147483647; pointer-events: none;
        transition: transform 40ms linear; will-change: transform;
      }
      #__ct_cursor svg { display: block; filter: drop-shadow(0 1px 3px rgba(0,0,0,.55)); }
      #__ct_ring {
        position: fixed; left: 0; top: 0; width: 46px; height: 46px;
        margin: -23px 0 0 -23px; border-radius: 50%; z-index: 2147483646;
        pointer-events: none; border: 3px solid #B7F34A; opacity: 0;
        background: rgba(183,243,74,.22);
      }
      /* Smooth scrolling makes an element's box a moving target: the recorder
         reads coordinates the instant a scroll is requested, and with easing
         those are stale before the pointer arrives. Instant scrolling keeps
         the drawn cursor and the real one in the same place. */
      html, body, * { scroll-behavior: auto !important; }
      @keyframes __ct_pulse {
        0%   { opacity: .95; transform: scale(.25); }
        100% { opacity: 0;   transform: scale(1.15); }
      }
    \`;
    document.head.appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = '__ct_cursor';
    cursor.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22">' +
      '<path d="M4 2 L4 19 L9 14.5 L12 21.5 L15 20 L12 13.5 L19 13 Z" ' +
      'fill="#0B1020" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cursor);

    const ring = document.createElement('div');
    ring.id = '__ct_ring';
    document.body.appendChild(ring);

    let x = window.innerWidth / 2, y = window.innerHeight / 2;
    const place = () => { cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
    place();

    document.addEventListener('mousemove', (e) => {
      x = e.clientX; y = e.clientY; place();
    }, true);

    document.addEventListener('mousedown', (e) => {
      ring.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
      ring.style.animation = 'none';
      void ring.offsetWidth;
      ring.style.animation = '__ct_pulse 480ms ease-out';
    }, true);
  };

  if (document.body) install();
  else document.addEventListener('DOMContentLoaded', install);
  // Client-side navigation can swap the body out from under us.
  setInterval(install, 700);
})();
`;

