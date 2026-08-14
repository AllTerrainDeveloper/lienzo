/**
 * The media modal host.
 *
 * Adds an "Edit with AllTerrain Photo Editor" button to the attachment details views, in both the
 * grid modal (`upload.php?mode=grid`) and the insert-media modal.
 *
 * The button is added by extending the view's `render()` rather than by replacing
 * its underscore template. Core's `tmpl-attachment-details-two-column` is long,
 * changes between releases, and forking it would silently freeze this plugin's copy
 * of the metadata form at whatever WordPress version it was copied from. Appending
 * one button after core has rendered survives core changing everything around it.
 *
 * `wp.media` has no hook registry -- extension is Backbone prototype patching --
 * so every step here is feature-detected and bails rather than throwing.
 *
 * The button also carries the answer back. A save writes a new attachment, and a modal
 * that was not told about it inserts the photograph the user has just finished editing
 * *as it was* -- so `returnEdit()` below puts the copy into the modal's library and
 * makes it the selection.
 */

import { __ } from '../i18n';
import { openEditor } from './open';

import type {
	BackboneCollectionLike,
	BackboneModelLike,
	BackboneView,
} from '../globals';
import type { SaveResult } from '../types';

/** Marks views already patched, so a re-boot cannot double-wrap them. */
const patched = new WeakSet< object >();

/**
 * Adds the editor button to the media modal.
 *
 * Safe to call on any admin screen; no-ops when `wp.media` is absent.
 */
export function bootMediaModal(): void {
	const details = window.wp?.media?.view?.Attachment?.Details;

	if ( ! details ) {
		return;
	}

	// The two-column view (grid modal) is the high-traffic one; the single-column
	// details view backs the insert-media modal.
	patchView( details.TwoColumn );
	patchView( details );
}

/**
 * Wraps a details view so it renders our button after its own markup.
 *
 * @param view Backbone view constructor.
 */
function patchView( view: BackboneView | undefined ): void {
	if ( ! view?.prototype?.render || patched.has( view ) ) {
		return;
	}

	patched.add( view );

	const originalRender = view.prototype.render;

	view.prototype.render = function ( this: BackboneView[ 'prototype' ], ...args: unknown[] ) {
		const result = originalRender.apply( this, args );

		try {
			addButton( this );
		} catch {
			// A core change to the view's shape must degrade to "no button", never
			// to a broken media modal.
		}

		return result;
	};
}

/**
 * Appends the button to a rendered attachment details view.
 *
 * @param view The view instance, typed loosely because `wp.media` ships no types.
 */
function addButton( view: Record< string, unknown > ): void {
	const el = ( view.el ?? null ) as HTMLElement | null;
	const model = view.model as
		| { get: ( key: string ) => unknown }
		| undefined;

	if ( ! el || ! model ) {
		return;
	}

	const id = Number( model.get( 'id' ) );
	const mime = String( model.get( 'mime' ) ?? '' );
	const config = window.lienzoConfig;

	if ( ! id || ! config || ! config.supportedMimes.includes( mime ) ) {
		return;
	}

	// `can.save` is core's own answer to "may this user edit this attachment",
	// already resolved server-side. Trusting it keeps the button honest without a
	// second round trip.
	const can = model.get( 'can' ) as { save?: boolean } | undefined;

	if ( can && can.save === false ) {
		return;
	}

	if ( el.querySelector( '.lz-modal-button' ) ) {
		return;
	}

	const host =
		el.querySelector( '.attachment-actions' ) ??
		el.querySelector( '.attachment-info' ) ??
		el;

	const button = document.createElement( 'button' );
	button.type = 'button';
	button.className = 'button lz-modal-button';
	button.textContent = __( 'Edit with AllTerrain Photo Editor' );

	button.addEventListener( 'click', ( event ) => {
		event.preventDefault();
		event.stopPropagation();

		openEditor( id, {
			onSave: ( result ) => returnEdit( view, id, result ),
		} );
	} );

	host.appendChild( button );
}

/**
 * Points the modal at the copy the editor just saved.
 *
 * A save writes a *new* attachment -- AllTerrain Photo Editor never rewrites an original -- so a modal
 * left alone goes on showing, and on inserting, the photograph as it was. Someone who
 * opened the picker to insert an image, edited it, and pressed Insert got the version
 * they had just finished changing.
 *
 * Two collections, because the modal keeps two different answers. The library is
 * everything on offer, and an attachment it has never heard of cannot be selected, so
 * that comes first -- it is also the whole of the answer in the grid modal, which has
 * no insert button and where seeing the new file appear is what "saved" looks like.
 * The selection is what Insert will use, and there the edited copy *replaces* the
 * original rather than joining it: a picker set to one image would otherwise refuse
 * the second, and a multi-select would insert the photograph twice.
 *
 * The model is fetched because `wp.media.attachment()` hands back whatever the store
 * has, which for an id uploaded seconds ago by somebody else's REST call is an id and
 * nothing else -- a tile with no URL, which renders as a broken thumbnail until
 * something asks the server. Backbone re-renders when the answer arrives.
 *
 * Every step is optional and every step is guarded: `wp.media` is a Backbone app with
 * no extension contract, and the worst thing this could do is throw inside a save
 * handler and make a successful save look like a failed one.
 *
 * @param view     The details view the button was added to.
 * @param sourceId The attachment that was opened.
 * @param result   What the save produced.
 */
function returnEdit(
	view: Record< string, unknown >,
	sourceId: number,
	result: SaveResult
): void {
	try {
		const attachment = window.wp?.media?.attachment?.( result.id );

		if ( ! attachment ) {
			return;
		}

		attachment.fetch?.();

		const controller = view.controller as
			| { state?: () => { get?: ( key: string ) => unknown } | undefined }
			| undefined;
		const state = controller?.state?.();

		( state?.get?.( 'library' ) as BackboneCollectionLike | undefined )?.add?.(
			attachment
		);

		const selection = state?.get?.( 'selection' ) as
			| BackboneCollectionLike
			| undefined;

		if ( ! selection?.add ) {
			return;
		}

		const original = selection.get?.( sourceId ) as
			| BackboneModelLike
			| undefined;

		if ( original ) {
			selection.remove?.( original );
		}

		selection.add( attachment );
	} catch {
		// The same bargain as the button itself: a core change to the modal's shape
		// means the edit is not carried back, never that the save reports a failure it
		// did not have.
	}
}
