import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootMediaModal } from '../../src/hosts/media-modal';
import type { LienzoConfig, SaveResult } from '../../src/types';

const openEditor = vi.fn();

vi.mock( '../../src/hosts/open', () => ( {
	openEditor: ( ...args: unknown[] ) => openEditor( ...args ),
} ) );

/** What a save from the modal's overlay reports. */
const SAVED = {
	flattened: false,
	id: 9,
	sourceId: 5,
	url: 'https://example.test/edited.jpg',
	width: 100,
	height: 100,
	mime: 'image/jpeg',
	recipe: {},
} as unknown as SaveResult;

/** A stand-in for one of the modal's Backbone collections. */
function collection( members: Record< number, unknown > = {} ) {
	return {
		add: vi.fn(),
		remove: vi.fn(),
		get: vi.fn( ( id: number ) => members[ id ] ),
	};
}

/**
 * A details view instance, of the shape `addButton()` reads.
 *
 * @param controller What `view.controller` should be.
 * @param mime       The attachment's MIME type.
 */
function instance( controller: unknown, mime = 'image/jpeg' ) {
	const el = document.createElement( 'div' );
	const actions = document.createElement( 'div' );

	actions.className = 'attachment-actions';
	el.appendChild( actions );

	return {
		el,
		controller,
		model: {
			get: ( key: string ) =>
				( { id: 5, mime } as Record< string, unknown > )[ key ],
		},
	};
}

/**
 * Installs a fake `wp.media` and returns the pieces a test needs to poke.
 *
 * @param attachment What `wp.media.attachment()` hands back.
 */
function fakeMedia( attachment: unknown ) {
	const render = vi.fn( function ( this: unknown ) {
		return this;
	} );
	const details = { prototype: { render }, extend: vi.fn() };
	const twoColumn = { prototype: { render: vi.fn() }, extend: vi.fn() };
	const media = {
		view: { Attachment: { Details: Object.assign( details, { TwoColumn: twoColumn } ) } },
		attachment: vi.fn( () => attachment ),
	};

	window.wp = { media } as unknown as Window[ 'wp' ];

	return { details, media };
}

/**
 * Renders a patched view and returns the button that was added to it.
 *
 * @param details The patched Details constructor.
 * @param view    The view instance to render.
 */
function renderInto(
	details: { prototype: { render: ( ...args: unknown[] ) => unknown } },
	view: unknown
): HTMLButtonElement {
	details.prototype.render.call( view );

	return ( view as { el: HTMLElement } ).el.querySelector(
		'.lz-modal-button'
	) as HTMLButtonElement;
}

describe( 'bootMediaModal', () => {
	beforeEach( () => {
		openEditor.mockReset();
		window.lienzoConfig = {
			supportedMimes: [ 'image/jpeg' ],
		} as unknown as LienzoConfig;
	} );

	afterEach( () => {
		delete window.wp;
		delete window.lienzoConfig;
	} );

	it( 'adds the button to a rendered details view', () => {
		const { details } = fakeMedia( null );

		bootMediaModal();

		expect( renderInto( details, instance( undefined ) ) ).not.toBeNull();
	} );

	it( 'leaves an image Lienzo cannot open alone', () => {
		const { details } = fakeMedia( null );

		bootMediaModal();

		expect(
			renderInto( details, instance( undefined, 'image/gif' ) )
		).toBeNull();
	} );

	it( 'makes the saved copy the modal selection, in place of the original', () => {
		const attachment = { fetch: vi.fn() };
		const original = { id: 5 };
		const library = collection();
		const selection = collection( { 5: original } );
		const { details, media } = fakeMedia( attachment );

		bootMediaModal();

		const view = instance( {
			state: () => ( {
				get: ( key: string ) =>
					( { library, selection } as Record< string, unknown > )[ key ],
			} ),
		} );

		renderInto( details, view ).click();

		const options = openEditor.mock.calls[ 0 ][ 1 ] as {
			onSave: ( result: SaveResult ) => void;
		};

		options.onSave( SAVED );

		expect( media.attachment ).toHaveBeenCalledWith( 9 );
		// Fetched, or the tile is an id with no URL behind it.
		expect( attachment.fetch ).toHaveBeenCalled();
		// The library first: what the modal has never heard of cannot be selected.
		expect( library.add ).toHaveBeenCalledWith( attachment );
		expect( selection.remove ).toHaveBeenCalledWith( original );
		expect( selection.add ).toHaveBeenCalledWith( attachment );
	} );

	it( 'adds to a selection that did not hold the original', () => {
		const attachment = { fetch: vi.fn() };
		const selection = collection();
		const { details } = fakeMedia( attachment );

		bootMediaModal();

		const view = instance( {
			state: () => ( { get: ( key: string ) => ( 'selection' === key ? selection : undefined ) } ),
		} );

		renderInto( details, view ).click();
		(
			openEditor.mock.calls[ 0 ][ 1 ] as { onSave: ( r: SaveResult ) => void }
		 ).onSave( SAVED );

		expect( selection.remove ).not.toHaveBeenCalled();
		expect( selection.add ).toHaveBeenCalledWith( attachment );
	} );

	it( 'survives a modal with no state to speak of', () => {
		const { details } = fakeMedia( { fetch: vi.fn() } );

		bootMediaModal();

		const view = instance( {
			state: () => {
				throw new Error( 'core moved on' );
			},
		} );

		renderInto( details, view ).click();

		expect( () =>
			(
				openEditor.mock.calls[ 0 ][ 1 ] as { onSave: ( r: SaveResult ) => void }
			 ).onSave( SAVED )
		).not.toThrow();
	} );

	it( 'does nothing when the store has no model for the copy', () => {
		const selection = collection();
		const { details } = fakeMedia( undefined );

		bootMediaModal();

		const view = instance( {
			state: () => ( { get: () => selection } ),
		} );

		renderInto( details, view ).click();
		(
			openEditor.mock.calls[ 0 ][ 1 ] as { onSave: ( r: SaveResult ) => void }
		 ).onSave( SAVED );

		expect( selection.add ).not.toHaveBeenCalled();
	} );
} );
