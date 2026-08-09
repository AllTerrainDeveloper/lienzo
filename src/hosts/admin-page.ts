/**
 * The editor page, for a user with desktop mode switched off.
 *
 * The simplest of the editor's surfaces, and the one the others are validated
 * against: it does nothing but find the mount point PHP printed and hand it to
 * `mount()`. If the editor works here it works everywhere, because every other host
 * differs only in where the element lives.
 *
 * With no attachment in the URL it shows the library picker -- the same picker the
 * desktop window shows when it is opened from the dock rather than by double-clicking
 * a photograph.
 *
 * With desktop mode *on* it mounts nothing and asks for the window instead. The shell
 * hides `#wpbody` behind the desktop, so an editor mounted here would be a live WebGL
 * context and a full-resolution texture inside a `display: none` container -- invisible,
 * unreachable, and still holding the GPU. Reaching this URL at all then means a
 * bookmark or a typed address rather than a control, since every control intercepts
 * its own click.
 */

import { mount } from '../editor';
import type { EditorInstance } from '../editor';
import { isShellPage, openDesktopWindow } from './desktop-mode';
import { __ } from '../i18n';
import { renderPicker } from '../ui/picker';

/** The live instance, so a re-boot cannot leak a second Pixi context. */
let instance: EditorInstance | null = null;

/**
 * Finds the admin page's mount point and starts the editor.
 *
 * Safe to call on any admin screen; it no-ops when the mount point is absent.
 */
export function bootAdminPage(): void {
	const root = document.querySelector< HTMLElement >(
		'[data-lienzo-root][data-host="page"]'
	);

	if ( ! root ) {
		return;
	}

	const attachmentId = Number( root.dataset.attachment ?? 0 );

	instance?.destroy();
	instance = null;

	if ( isShellPage() ) {
		handOverToDesktop( root, attachmentId );

		return;
	}

	if ( attachmentId ) {
		open( root, attachmentId );
	} else {
		showPicker( root );
	}

	// A bfcache restore or a Turbo-style navigation would otherwise leave a live WebGL
	// context and its textures behind.
	window.addEventListener(
		'pagehide',
		() => {
			instance?.destroy();
			instance = null;
		},
		{ once: true }
	);
}

/**
 * Mounts the editor on one image.
 *
 * @param root         Mount point.
 * @param attachmentId Image to open.
 */
function open( root: HTMLElement, attachmentId: number ): void {
	instance?.destroy();
	root.replaceChildren();

	instance = mount( root, {
		attachmentId,
		host: 'page',
		// Closing the only thing on the page has nowhere to go but back to the library.
		onClose: () => {
			window.location.href = window.lienzoConfig?.editorUrl ?? 'upload.php';
		},
	} );

	// Reachable from the console for diagnosing render problems.
	( window as unknown as { lienzoEditor?: unknown } ).lienzoEditor = instance;

	// So a reload, a bookmark or the back button all land on the same photograph. The
	// history entry is replaced rather than pushed: picking from the picker is not a
	// navigation the user should have to press back through twice.
	const url = new URL( window.location.href );

	url.searchParams.set( 'attachment', String( attachmentId ) );
	window.history.replaceState( {}, '', url );
}

/**
 * Asks the desktop for a window, and says so on the page behind it.
 *
 * The message is written even though the desktop covers it: this page is also what a
 * chromeless iframe loads, and there the shell shows exactly this body inside a window
 * frame while the *parent* opens the native one. Someone who gets here with the shell
 * half-loaded should read a sentence rather than stare at an empty screen.
 *
 * @param root         Mount point.
 * @param attachmentId Image to open, or 0 for the window's own picker.
 */
function handOverToDesktop( root: HTMLElement, attachmentId: number ): void {
	const opened = openDesktopWindow( attachmentId );
	const message = document.createElement( 'p' );

	message.className = 'lz-page-notice';
	message.textContent = opened
		? __( 'Opening Lienzo on your desktop…' )
		: __( 'Lienzo opens as a window on your desktop. Open it from the dock or its icon.' );

	root.replaceChildren( message );
}

/**
 * Shows the library picker, for a page opened without an image.
 *
 * @param root Mount point.
 */
function showPicker( root: HTMLElement ): void {
	const config = window.lienzoConfig;

	if ( ! config ) {
		root.textContent = __( 'Lienzo could not load its configuration.' );

		return;
	}

	void renderPicker( root, config, ( id ) => open( root, id ) );
}
