/**
 * Opening the desktop window, and the request an iframe posts up to do it.
 *
 * The zero case is the one that was wrong. "Open the window with no image" is what the
 * dock, the wallpaper icon and Media -> Edit Photos all ask for, and the listener that
 * received it from a chromeless iframe routed it through a function that requires an
 * image -- so the page said it was opening something and the shell did nothing.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDesktopWindow, openInDesktop } from '../../src/hosts/desktop-mode';
// Not on the barrel: it is wiring `bootDesktopMode()` installs, not public surface.
import { listenForOpenRequests } from '../../src/hosts/desktop-mode/open-window';

/** Window ids the fake shell was asked to open. */
let opened: string[];

/**
 * Installs a fake shell whose `openWindow` records what it was asked for.
 */
function fakeShell(): void {
	( window as unknown as { wp?: unknown } ).wp = {
		os: {
			isActive: () => true,
			openWindow: ( id: string ) => {
				opened.push( id );

				return true;
			},
		},
	};
}

describe( 'openDesktopWindow', () => {
	beforeEach( () => {
		opened = [];
		delete ( window as unknown as { __lienzoDesktop?: unknown } ).__lienzoDesktop;
		fakeShell();
	} );

	afterEach( () => {
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	it( 'opens the window on its own picker when given no image', () => {
		expect( openDesktopWindow( 0 ) ).toBe( true );
		expect( opened ).toEqual( [ 'lienzo' ] );
	} );

	it( 'opens the window for an image, and parks the id for it', () => {
		expect( openDesktopWindow( 42 ) ).toBe( true );
		expect( opened ).toEqual( [ 'lienzo' ] );
	} );

	it( 'declines when there is no shell to ask', () => {
		delete ( window as unknown as { wp?: unknown } ).wp;

		expect( openDesktopWindow( 42 ) ).toBe( false );
	} );
} );

describe( 'openInDesktop', () => {
	beforeEach( () => {
		opened = [];
		delete ( window as unknown as { __lienzoDesktop?: unknown } ).__lienzoDesktop;
		fakeShell();
	} );

	afterEach( () => {
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	it( 'refuses without an image, because that is what it is for', () => {
		// The distinction the listener used to miss: this one opens *an image*.
		expect( openInDesktop( 0 ) ).toBe( false );
		expect( opened ).toEqual( [] );
	} );

	it( 'opens an image it is given', () => {
		expect( openInDesktop( 7 ) ).toBe( true );
		expect( opened ).toEqual( [ 'lienzo' ] );
	} );
} );

describe( 'listenForOpenRequests', () => {
	// Registered once for the whole block, the way `bootDesktopMode()` does it. The
	// once-only guard lives on the shared state, so clearing that per test would let
	// each registration add another live listener and every message arrive twice.
	beforeAll( () => {
		delete ( window as unknown as { __lienzoDesktop?: unknown } ).__lienzoDesktop;
		listenForOpenRequests();
	} );

	beforeEach( () => {
		opened = [];
		fakeShell();
	} );

	afterEach( () => {
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	/**
	 * Delivers a message as a same-origin frame would.
	 *
	 * @param data Message payload.
	 */
	function post( data: unknown ): void {
		const event = new MessageEvent( 'message', { data } );

		Object.defineProperty( event, 'origin', { value: window.location.origin } );
		window.dispatchEvent( event );
	}

	it( 'opens the picker for a request carrying no image', () => {
		// Media -> Edit Photos inside the shell. This posted into the void.
		post( { type: 'lienzo-open', attachmentId: 0 } );

		expect( opened ).toEqual( [ 'lienzo' ] );
	} );

	it( 'opens an image a frame asks for', () => {
		post( { type: 'lienzo-open', attachmentId: 12 } );

		expect( opened ).toEqual( [ 'lienzo' ] );
	} );

	it( 'ignores anything that is not ours', () => {
		post( { type: 'something-else', attachmentId: 12 } );
		post( null );
		post( 'lienzo-open' );

		expect( opened ).toEqual( [] );
	} );

	it( 'ignores a message from another origin', () => {
		const event = new MessageEvent( 'message', {
			data: { type: 'lienzo-open', attachmentId: 3 },
		} );

		Object.defineProperty( event, 'origin', { value: 'https://example.test' } );
		window.dispatchEvent( event );

		expect( opened ).toEqual( [] );
	} );

	it( 'registers its listener once, however often it is called', () => {
		listenForOpenRequests();
		listenForOpenRequests();

		post( { type: 'lienzo-open', attachmentId: 0 } );

		expect( opened ).toEqual( [ 'lienzo' ] );
	} );
} );
