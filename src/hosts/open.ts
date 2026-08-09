/**
 * One question -- "open this image" -- and the two places it can be answered.
 *
 * Inside the desktop shell the answer is a native window: that is where the shell's
 * components, its drag bridge and its PixiJS are, and an editor that opened anywhere
 * else on that page would be a worse editor. Everywhere else the answer is an overlay
 * over the current screen, because navigating away from a half-written post to edit
 * the photograph in it is not an acceptable price.
 *
 * Every entry point -- the media row action, the attachment screen, the grid modal,
 * the block editor toolbar -- calls this and nothing else. That is what keeps the two
 * surfaces from drifting: there is one decision, made in one place, rather than four
 * callers each with their own idea of when the shell counts as present.
 */

import { openInDesktop } from './desktop-mode';
import { openEditorOverlay } from './overlay';
import type { PostOrigin, SaveResult } from '../types';

export interface OpenOptions {
	/** The post the image was opened from, when it was opened from one. */
	origin?: PostOrigin | null;
	/** Called after each successful save. */
	onSave?: ( result: SaveResult ) => void;
}

/**
 * Opens an image in whichever surface this page can offer.
 *
 * The desktop window is tried first and reports whether it took the request, so the
 * fallback is driven by what actually happened rather than by a second guess at
 * whether the shell is there.
 *
 * @param attachmentId Attachment to edit.
 * @param options      Optional. Origin post and save callback.
 * @return True when something opened.
 */
export function openEditor(
	attachmentId: number,
	options: OpenOptions = {}
): boolean {
	const id = Number( attachmentId ) || 0;

	if ( ! id ) {
		return false;
	}

	// The overlay needs the configuration -- the REST root, the nonce, the op schema --
	// and this bundle can be on a page that never ran `lienzo_enqueue_editor()`: the
	// shell enqueues the handle it was registered with, and a screen outside the ones
	// the plugin enqueues on gets the script and no config. Mounting there would throw
	// where doing nothing lets the caller's own `href` navigate to the editor page,
	// which is exactly what that href is for.
	const overlay = () => {
		if ( window.lienzoConfig ) {
			openEditorOverlay( { attachmentId: id, onSave: options.onSave } );
		}
	};

	// Asking the desktop from inside a chromeless iframe means posting a message to the
	// top frame, and being told "yes, forwarded" is not the same as being told a window
	// opened. When nothing up there answers, this is what stops the click from having
	// been a click on nothing.
	if ( openInDesktop( id, options.origin ?? null, overlay ) ) {
		return true;
	}

	if ( ! window.lienzoConfig ) {
		return false;
	}

	overlay();

	return true;
}
