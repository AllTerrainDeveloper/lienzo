/**
 * What `bootDesktopMode()` registers, and when.
 *
 * Its own file because the thing under test is a listener on `window` guarded by a
 * once-flag on `window`, and vitest gives each file a fresh one. Sharing a window with
 * the other desktop tests would mean testing a listener some earlier block installed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootDesktopMode } from '../../src/hosts/desktop-mode';

/** Window ids the fake shell was asked to open. */
let opened: string[];

/**
 * Publishes a shell that records what it was asked to open.
 */
function publishShell(): void {
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

/**
 * Delivers a request as a chromeless iframe would.
 *
 * @param attachmentId Image the frame is asking for.
 */
function askFromFrame( attachmentId: number ): void {
	const event = new MessageEvent( 'message', {
		data: { type: 'lienzo-open', attachmentId },
	} );

	Object.defineProperty( event, 'origin', { value: window.location.origin } );
	window.dispatchEvent( event );
}

describe( 'bootDesktopMode', () => {
	beforeEach( () => {
		opened = [];
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	afterEach( () => {
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	it( 'hears a frame even when the shell was not up at boot', () => {
		// The bug, exactly. This bundle is parsed on the shell page before the shell
		// publishes `wp.os`, and the listener sat behind an early return that never ran
		// again -- so every "Edit with AllTerrain Photo Editor" posted up from the media modal, and every
		// Media -> Edit Photos, went unheard for the life of the page.
		bootDesktopMode();

		publishShell();
		askFromFrame( 5 );

		expect( opened ).toEqual( [ 'lienzo' ] );
	} );

	it( 'hears a frame when the shell was already up', () => {
		publishShell();
		bootDesktopMode();

		askFromFrame( 5 );

		expect( opened ).toEqual( [ 'lienzo' ] );
	} );

	it( 'does nothing on a page that never grows a shell', () => {
		bootDesktopMode();

		askFromFrame( 5 );

		expect( opened ).toEqual( [] );
	} );
} );
