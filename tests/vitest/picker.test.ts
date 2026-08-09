import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPicker } from '../../src/ui/picker';
import type { LienzoConfig } from '../../src/types';

const request = vi.fn();

vi.mock( '../../src/platform', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	request: ( ...args: unknown[] ) => request( ...args ),
} ) );

const CONFIG = {
	mediaUrl: 'https://example.test/wp-json/wp/v2/media',
	restNonce: 'nonce',
	supportedMimes: [ 'image/jpeg', 'image/png' ],
} as unknown as LienzoConfig;

/**
 * A stubbed `wp/v2/media` response.
 *
 * @param items      Media items to return.
 * @param totalPages What to report in X-WP-TotalPages.
 */
function page(
	items: Array< { id: number; mime_type: string } >,
	totalPages = 1
) {
	return {
		ok: true,
		headers: { get: () => String( totalPages ) },
		json: async () => items,
	};
}

/**
 * An image the picker can open.
 *
 * @param id Attachment id.
 */
function jpeg( id: number ) {
	return { id, mime_type: 'image/jpeg' };
}

/**
 * An image it cannot.
 *
 * @param id Attachment id.
 */
function gif( id: number ) {
	return { id, mime_type: 'image/gif' };
}

/**
 * A stand-in for the observer jsdom does not implement.
 *
 * Records every instance so a test can say "the end of the grid came into view" and
 * see what the picker did about it. `observe` and `unobserve` are counted rather than
 * simulated, because the behaviour under test is *when* the picker asks the question
 * again, not the browser's answer to it.
 */
class FakeObserver {
	static instances: FakeObserver[] = [];

	callback: IntersectionObserverCallback;

	observed: Element[] = [];

	disconnected = false;

	/**
	 * @param callback Called when an observed element's visibility changes.
	 */
	constructor( callback: IntersectionObserverCallback ) {
		this.callback = callback;
		FakeObserver.instances.push( this );
	}

	/**
	 * @param element Element to watch.
	 */
	observe( element: Element ): void {
		this.observed.push( element );
	}

	unobserve(): void {}

	disconnect(): void {
		this.disconnected = true;
	}

	/** Reports every observed element as visible. */
	reveal(): void {
		this.callback(
			this.observed.map(
				( target ) =>
					( { target, isIntersecting: true } ) as IntersectionObserverEntry
			),
			this as unknown as IntersectionObserver
		);
	}

	/** The most recent observer the picker created. */
	static get latest(): FakeObserver {
		return FakeObserver.instances[ FakeObserver.instances.length - 1 ];
	}
}

/** Lets the picker's pending promises settle. */
async function settle(): Promise< void > {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe( 'renderPicker', () => {
	let root: HTMLElement;

	beforeEach( () => {
		request.mockReset();
		FakeObserver.instances = [];
		root = document.createElement( 'div' );
		document.body.appendChild( root );
		( globalThis as unknown as { IntersectionObserver: unknown } ).IntersectionObserver =
			FakeObserver;
	} );

	afterEach( () => {
		root.remove();
		delete ( globalThis as unknown as { IntersectionObserver?: unknown } )
			.IntersectionObserver;
	} );

	it( 'renders a tile for every image it can open', async () => {
		request.mockResolvedValueOnce( page( [ jpeg( 1 ), jpeg( 2 ) ], 1 ) );

		await renderPicker( root, CONFIG );

		expect( root.querySelectorAll( '.lz-picker__tile' ) ).toHaveLength( 2 );
		expect( root.querySelector( '.lz-picker__count' )?.textContent ).toBe(
			'Showing all 2 photos.'
		);
	} );

	it( 'says how many images it passed over', async () => {
		request.mockResolvedValueOnce(
			page( [ jpeg( 1 ), gif( 2 ), gif( 3 ) ], 1 )
		);

		await renderPicker( root, CONFIG );

		expect( root.querySelector( '.lz-picker__count' )?.textContent ).toBe(
			'Showing all 1 photos. Passing over 2 images Lienzo cannot open.'
		);
	} );

	it( 'uses the singular for a single passed-over image', async () => {
		request.mockResolvedValueOnce( page( [ jpeg( 1 ), gif( 2 ) ], 1 ) );

		await renderPicker( root, CONFIG );

		expect( root.querySelector( '.lz-picker__count' )?.textContent ).toContain(
			'Passing over 1 image Lienzo cannot open.'
		);
	} );

	it( 'tells a library of unopenable images why it looks empty', async () => {
		request.mockResolvedValueOnce( page( [ gif( 1 ), gif( 2 ) ], 1 ) );

		await renderPicker( root, CONFIG );

		const status = root.querySelector( '.lz-picker__status' )?.textContent ?? '';

		expect( status ).toContain( 'Your library has 2 images' );
		expect( status ).toContain( 'animated GIFs' );
		expect( root.querySelectorAll( '.lz-picker__tile' ) ).toHaveLength( 0 );
	} );

	it( 'still invites an upload when the library really is empty', async () => {
		request.mockResolvedValueOnce( page( [], 1 ) );

		await renderPicker( root, CONFIG );

		expect( root.querySelector( '.lz-picker__status' )?.textContent ).toBe(
			'No editable images yet. Upload a JPEG, PNG, WebP or AVIF to get started.'
		);
	} );

	it( 'fetches the next page when the end of the grid comes into view', async () => {
		request
			.mockResolvedValueOnce( page( [ jpeg( 1 ) ], 2 ) )
			.mockResolvedValueOnce( page( [ jpeg( 2 ) ], 2 ) );

		await renderPicker( root, CONFIG );
		expect( request ).toHaveBeenCalledTimes( 1 );

		FakeObserver.latest.reveal();
		await settle();

		expect( request ).toHaveBeenCalledTimes( 2 );
		expect( root.querySelectorAll( '.lz-picker__tile' ) ).toHaveLength( 2 );
	} );

	it( 'watches the footer, which is what sits under the last row', async () => {
		request.mockResolvedValueOnce( page( [ jpeg( 1 ) ], 2 ) );

		await renderPicker( root, CONFIG );

		expect( FakeObserver.latest.observed ).toEqual( [
			root.querySelector( '.lz-picker__footer' ),
		] );
	} );

	it( 'asks again after each page, so a short first page keeps going', async () => {
		request.mockResolvedValue( page( [ jpeg( 1 ) ], 5 ) );

		await renderPicker( root, CONFIG );

		const first = FakeObserver.latest;

		first.reveal();
		await settle();

		// A fresh observer, because one that stayed visible throughout would never
		// report a change and the picker would stop one page in.
		expect( FakeObserver.latest ).not.toBe( first );
		expect( first.disconnected ).toBe( true );
	} );

	it( 'stops watching at the end of the library', async () => {
		request.mockResolvedValueOnce( page( [ jpeg( 1 ) ], 1 ) );

		await renderPicker( root, CONFIG );

		// Nothing to watch for: the last page is already on screen.
		expect( FakeObserver.instances ).toHaveLength( 0 );
		expect( root.querySelector( '.lz-picker__footer button' ) ).toBeNull();
	} );

	it( 'does not start a second fetch while one is in flight', async () => {
		request.mockResolvedValue( page( [ jpeg( 1 ) ], 5 ) );

		await renderPicker( root, CONFIG );

		const observer = FakeObserver.latest;
		const button = root.querySelector(
			'.lz-picker__footer button'
		) as HTMLButtonElement;

		observer.reveal();
		button.click();
		observer.reveal();
		await settle();

		expect( request ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'leaves the button working where there is no observer', async () => {
		delete ( globalThis as unknown as { IntersectionObserver?: unknown } )
			.IntersectionObserver;

		request
			.mockResolvedValueOnce( page( [ jpeg( 1 ) ], 2 ) )
			.mockResolvedValueOnce( page( [ jpeg( 2 ) ], 2 ) );

		await renderPicker( root, CONFIG );

		(
			root.querySelector( '.lz-picker__footer button' ) as HTMLButtonElement
		 ).click();
		await settle();

		expect( root.querySelectorAll( '.lz-picker__tile' ) ).toHaveLength( 2 );
	} );

	it( 'stops watching once the picker no longer owns the element', async () => {
		request.mockResolvedValue( page( [ jpeg( 1 ) ], 5 ) );

		let stale = false;

		await renderPicker( root, CONFIG, undefined, () => stale );

		const observer = FakeObserver.latest;

		stale = true;
		observer.reveal();
		await settle();

		expect( observer.disconnected ).toBe( true );
		expect( request ).toHaveBeenCalledTimes( 1 );
	} );
} );
