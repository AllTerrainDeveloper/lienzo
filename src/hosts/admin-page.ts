/**
 * The classic-admin editor page.
 *
 * The simplest of the editor's surfaces, and the one the others are validated
 * against: it does nothing but find the mount point PHP printed and hand it to
 * `mount()`. If the editor works here it works everywhere, because every other host
 * differs only in where the element lives.
 *
 * With no attachment in the URL it shows the library picker -- the same picker the
 * desktop window shows when it is opened from the dock rather than by double-clicking
 * a photograph.
 */

import { mount } from '../editor';
import type { EditorInstance } from '../editor';
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
