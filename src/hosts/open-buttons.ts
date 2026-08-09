/**
 * The "Edit with Lienzo" controls scattered around the admin.
 *
 * The row action in the media list, the button on the attachment screen, and anything
 * a plugin adds with the same attribute. They are links to the classic editor page
 * that this file upgrades in place: the click opens a desktop window or an overlay
 * instead, and the `href` is what is left if this bundle never ran.
 *
 * That is why they are links and not buttons. Following the link *inside* the desktop
 * shell would load the editor page as an iframe window -- the one context where it can
 * reach neither Pixi nor the shell's components -- so the click has to be intercepted
 * there. Everywhere else, a control that does nothing without JavaScript is a worse
 * answer than one that navigates.
 *
 * One delegated listener rather than one per control: the media list re-renders its
 * rows on every filter and sort, and re-binding after each of those is how a button
 * ends up silently dead.
 */

import { openEditor } from './open';

/** Marks a control that opens an image in the desktop window. */
const ATTRIBUTE = 'data-lienzo-open';

/**
 * Wires up every open control on the page, present and future.
 */
export function bootOpenButtons(): void {
	document.addEventListener( 'click', ( event ) => {
		const target = event.target;

		if ( ! ( target instanceof Element ) ) {
			return;
		}

		const control = target.closest( `[${ ATTRIBUTE }]` );

		if ( ! ( control instanceof HTMLElement ) ) {
			return;
		}

		const attachmentId = Number( control.getAttribute( ATTRIBUTE ) ) || 0;

		if ( ! attachmentId ) {
			return;
		}

		// A modified click is the browser's, not ours: middle-click and
		// ctrl/cmd-click mean "open the editor page in a new tab", and hijacking
		// them would take away the one thing the href is for.
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		) {
			return;
		}

		// Prevented only once something has agreed to open. If neither surface can, the
		// link is left to navigate to the editor page, which is exactly what it says.
		if ( openEditor( attachmentId ) ) {
			event.preventDefault();
		}
	} );
}
