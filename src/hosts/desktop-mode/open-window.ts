/**
 * Asking the desktop to open an image.
 *
 * Three routes, best first: the shell's own `openWindow`, a postMessage to the parent
 * frame, and a same-frame custom event. Which one is available depends on whether this
 * bundle is running in the shell, in a chromeless iframe, or neither.
 */

import { readConfig } from '../../editor/config';
import { RestClient } from '../../net/rest';
import { isDesktopModeEnabled, toast } from '../../platform';
import { __ } from '../../i18n';
import type { PostOrigin } from '../../types';
import { desktop, state, WINDOW_ID } from './desktop-api';

/** The message an iframe sends to ask the shell to open an image. */
const OPEN_MESSAGE = 'lienzo-open';

/**
 * Opens an image in the desktop window, from anywhere on the page.
 *
 * Callable from the shell itself or from inside a chromeless iframe: the shell's
 * window manager only exists in the top frame, so a request from an iframe is posted
 * up to the listener installed by `bootDesktopMode()`.
 *
 * @param attachmentId Attachment to edit.
 * @param origin       Optional. The post it came from, so a save can offer to put
 *                     the edit back on it.
 * @return True when the request was handled or forwarded.
 */
export function openInDesktop(
	attachmentId: number,
	origin: PostOrigin | null = null
): boolean {
	const id = Number( attachmentId ) || 0;

	if ( ! id ) {
		return false;
	}

	return openDesktopWindow( id, origin );
}

/**
 * Opens the desktop window, with or without an image.
 *
 * Without one it opens on its own picker, which is what the dock and the wallpaper
 * icon do. The classic-admin page uses that when someone reaches it while desktop mode
 * is on: the shell hides the whole admin body behind the desktop, so an editor mounted
 * into that page would be a live WebGL context inside a `display: none` container.
 *
 * @param attachmentId Attachment to edit, or 0 for the picker.
 * @param origin       Optional. The post it came from.
 * @return True when the request was handled or forwarded.
 */
export function openDesktopWindow(
	attachmentId = 0,
	origin: PostOrigin | null = null
): boolean {
	const id = Number( attachmentId ) || 0;

	if ( desktop()?.openWindow ) {
		if ( ! id ) {
			desktop()?.openWindow?.( WINDOW_ID, { source: 'lienzo' } );

			return true;
		}

		// The most recently rendered window is the one on screen. Load into it rather
		// than focusing a window showing something else and leaving the id parked.
		const live = [ ...state().openers ].pop();

		if ( live ) {
			live( id, origin );
		} else {
			state().pending = id;
			state().pendingOrigin = origin;
		}

		desktop()?.openWindow?.( WINDOW_ID, { source: 'lienzo' } );

		return true;
	}

	// A chromeless iframe: the window manager only exists in the top frame, so the
	// request is posted up to the listener `bootDesktopMode()` installed there.
	//
	// Gated on desktop mode being *on for this user*, not merely on being framed.
	// Returning true here is a promise that something will open, and the caller's
	// fallback -- the classic-admin overlay -- is skipped on the strength of it. An
	// admin page that happens to be embedded in someone else's iframe with no shell
	// above it would otherwise post into the void and open nothing at all.
	if ( isDesktopModeEnabled() && window.parent && window.parent !== window ) {
		window.parent.postMessage(
			{ type: OPEN_MESSAGE, attachmentId: id },
			window.location.origin
		);

		return true;
	}

	return false;
}

/**
 * Whether this page is the shell's, rather than a classic admin screen.
 *
 * The question the classic-admin page has to ask before mounting anything: with the
 * desktop running, `#wpbody` is hidden behind it and nothing in there can be seen.
 */
export function isShellPage(): boolean {
	return undefined !== desktop()?.openWindow || isDesktopModeEnabled();
}

/**
 * Listens for open requests posted up from chromeless iframes.
 *
 * Same-origin only, and the payload is one integer -- an iframe on this page is our
 * own admin, but the check costs nothing and the alternative is trusting whatever
 * else might be embedded.
 *
 * Zero is a request, not a missing one: "open the window on its own picker", which is
 * what Media -> Edit Photos asks for. Routing it through `openInDesktop()` -- which
 * requires an image and refuses without one -- meant that page posted a message the
 * shell dropped on the floor, having already told the user it was opening something.
 */
export function listenForOpenRequests(): void {
	if ( state().listenerRegistered ) {
		return;
	}

	state().listenerRegistered = true;

	window.addEventListener( 'message', ( event: MessageEvent ) => {
		if ( event.origin !== window.location.origin ) {
			return;
		}

		const data = event.data as { type?: string; attachmentId?: number } | null;

		if ( ! data || data.type !== OPEN_MESSAGE ) {
			return;
		}

		openDesktopWindow( Number( data.attachmentId ) || 0 );
	} );
}

/**
 * Opens the image a post is about.
 *
 * The server decides which image that is -- featured, then the product gallery, then
 * anything attached -- because the answer depends on the post type and on plugins
 * that have their own idea of it. A post with no image at all says so rather than
 * opening an empty editor.
 *
 * @param postId Post to open.
 * @return True when an image was found and opened.
 */
export async function openPostInDesktop( postId: number ): Promise< boolean > {
	const id = Number( postId ) || 0;

	if ( ! id ) {
		return false;
	}

	try {
		const image = await new RestClient( readConfig() ).getPostImage( id );

		return openInDesktop( image.attachmentId, {
			postId: image.postId,
			postTitle: image.postTitle,
			postType: image.postType,
			postTypeLabel: image.postTypeLabel,
			slot: image.slot,
			canAttach: image.canAttach,
		} );
	} catch ( error ) {
		toast(
			error instanceof Error
				? error.message
				: __( 'That post has no image Lienzo can open.' ),
			'error'
		);

		return false;
	}
}
