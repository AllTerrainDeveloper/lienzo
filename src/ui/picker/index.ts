/**
 * The image picker shown when the editor page is opened without an attachment.
 *
 * "Media -> Edit Photos" is a reasonable thing to click before you have chosen a
 * photo, so that route needs to end somewhere useful rather than telling you to go
 * somewhere else and come back.
 *
 * The library is read a page at a time, and the next page is fetched when the end of
 * the grid comes into view. That used to be a Load more button and nothing else,
 * because the picker renders inside an OpenStation window and which element actually
 * scrolls is not the picker's to know -- a `scroll` listener bound to the wrong one
 * silently never fires. An `IntersectionObserver` is the answer to exactly that
 * question: it reports whether an element is *visible*, having already clipped it
 * against every scrolling ancestor between here and the viewport, so it does not
 * matter which of them moved.
 *
 * The Load more button is what a browser with no observer gets instead, and only that.
 * Keeping both would leave a control that is never the reason anything happened: by
 * the time anyone reached for it, the page it asks for is the page already on its way.
 */

import { __, _n, sprintf } from '../../i18n';
import { createButton } from '../controls';
import type { LienzoConfig } from '../../types';
import { MediaPager } from './media-pager';
import { renderTile } from './tile';

export type { MediaItem } from './types';

/**
 * The class the picker puts on the element it fills.
 *
 * Exported because the picker dresses the element it is *given* -- which, in both
 * hosts, is the editor's own root -- and something has to take the class off again
 * when a photo is chosen and the editor moves in. `EditorShell` does, and shares this
 * constant so the two cannot drift.
 */
export const PICKER_CLASS = 'lz-picker';

/**
 * Renders a grid of editable images into an element.
 *
 * @param root    Element to fill.
 * @param config  Runtime configuration.
 * @param onPick  Optional. When given, intercepts the click instead of navigating --
 *                needed inside an OpenStation window, where following the link would
 *                navigate the whole shell away from the desktop.
 * @param isStale Optional. Returns true once this render no longer owns the element,
 *                so a fetch that finishes late writes nothing.
 */
export async function renderPicker(
	root: HTMLElement,
	config: LienzoConfig,
	onPick?: ( attachmentId: number ) => void,
	isStale?: () => boolean
): Promise< void > {
	if ( isStale?.() ) {
		return;
	}

	const pager = new MediaPager( config );
	const ui = buildChrome( root );

	// Only where nothing else will ask. An observer that works makes this a control
	// with nothing to do -- the page it would fetch is the page already arriving -- and
	// a button that is never the reason anything happened is chrome, not an affordance.
	const more = hasObserver()
		? null
		: createButton( {
				label: __( 'Load more' ),
				variant: 'secondary',
				onClick: () => void load(),
		  } );

	ui.footer.append( ui.count );

	if ( more ) {
		ui.footer.appendChild( more.el );
	}

	/** Whether a fetch is already in flight, so two cannot start at once. */
	let loading = false;

	/** Stops watching for the end of the grid. Replaced once watching begins. */
	let unwatch = () => {};

	/**
	 * Fetches the next page and appends it.
	 *
	 * Guarded against re-entry with a flag rather than with the button's disabled
	 * state: the observer below asks for pages too, and it cannot see a button.
	 */
	async function load(): Promise< void > {
		if ( loading || isStale?.() ) {
			return;
		}

		loading = true;
		more?.setDisabled( true );

		let items;

		try {
			items = await pager.next();
		} catch ( error ) {
			loading = false;

			if ( ! isStale?.() ) {
				fail( ui, error );
				more?.setDisabled( false );
			}

			return;
		}

		loading = false;

		// Anything can happen during that fetch -- most often the user picking a photo,
		// which mounts the editor into this very element. Writing the grid afterwards
		// would erase the editor and leave the picker showing over a window that had
		// already moved on.
		if ( isStale?.() ) {
			unwatch();

			return;
		}

		for ( const item of items ) {
			ui.grid.appendChild( renderTile( item, onPick ) );
		}

		if ( 0 === pager.count && ! pager.hasMore ) {
			unwatch();
			showEmpty( ui, pager.skipped );

			return;
		}

		ui.status.remove();
		root.append( ui.grid, ui.footer );

		ui.count.textContent = countLabel(
			pager.count,
			pager.skipped,
			pager.hasMore
		);

		if ( pager.hasMore ) {
			more?.setDisabled( false );
			watch();

			return;
		}

		unwatch();

		// Removed rather than hidden. `[hidden]` is a UA rule of the lowest possible
		// specificity, and inside OpenStation this button is a shell component the
		// shell gives an explicit `display` -- which wins, so the button stayed on
		// screen at the end of the library with nothing left to load.
		more?.destroy();
		more?.el.remove();
	}

	/**
	 * Asks for the next page once the end of the grid is on screen.
	 *
	 * The footer *is* the sentinel. It already sits directly under the last row and it
	 * is already always there, so a dedicated marker element would be one more thing to
	 * position, style and keep out of the accessibility tree for no extra information.
	 *
	 * Re-armed after every page rather than left observing, because an observer only
	 * reports a *change* of visibility: a first page too short to push the footer off
	 * screen leaves it visible throughout, no second callback ever arrives, and the
	 * picker stops one page in with the rest of the library behind a button the user
	 * has no reason to think is needed. Unobserving and observing again asks the
	 * question afresh.
	 */
	function watch(): void {
		if ( ! hasObserver() ) {
			return;
		}

		unwatch();

		const observer = new IntersectionObserver( ( entries ) => {
			if ( isStale?.() || ! ui.footer.isConnected || ! pager.hasMore ) {
				observer.disconnect();

				return;
			}

			if ( entries.some( ( entry ) => entry.isIntersecting ) ) {
				void load();
			}
		} );

		unwatch = () => {
			observer.disconnect();
			unwatch = () => {};
		};

		observer.observe( ui.footer );
	}

	await load();
}

/**
 * Whether this browser can tell the picker that the end of the grid is on screen.
 *
 * The one question that decides which of the two pagers the picker offers, asked in
 * one place so the button and the observer can never both be absent.
 */
function hasObserver(): boolean {
	return 'undefined' !== typeof IntersectionObserver;
}

/** The picker's elements. */
interface PickerChrome {
	root: HTMLElement;
	grid: HTMLElement;
	footer: HTMLElement;
	/** Loading, error and empty messages. Removed once there is a grid. */
	status: HTMLElement;
	/** How many photos are showing, beside the Load more button. */
	count: HTMLElement;
}

/**
 * Builds the picker's markup.
 *
 * @param root Element to fill. Its contents are replaced.
 */
function buildChrome( root: HTMLElement ): PickerChrome {
	root.classList.add( PICKER_CLASS );

	const heading = document.createElement( 'h2' );
	heading.className = 'lz-picker__heading';
	heading.textContent = __( 'Choose a photo to edit' );

	const status = document.createElement( 'p' );
	status.className = 'lz-picker__status';
	status.textContent = __( 'Loading your photos…' );

	const grid = document.createElement( 'div' );
	grid.className = 'lz-picker__grid';
	grid.setAttribute( 'role', 'list' );

	const footer = document.createElement( 'div' );
	footer.className = 'lz-picker__footer';

	const count = document.createElement( 'p' );
	count.className = 'lz-picker__count';
	// Announced politely, so someone using a screen reader hears the new total after
	// pressing Load more rather than being left to guess whether it did anything.
	count.setAttribute( 'aria-live', 'polite' );

	root.replaceChildren( heading, status );

	return { root, grid, footer, status, count };
}

/**
 * What to say about how much of the library is on screen.
 *
 * Two sentences, because the grid answers only half the question. Everything the pager
 * could not open -- an animated GIF, an SVG, anything a site has taken out of
 * `lienzo_supported_mime_types` -- is dropped on its way through, and a picker that
 * counts only what survived reports a library smaller than the one the user knows they
 * have. Saying how many were passed over is the difference between "you have twelve
 * photos" and "you have twelve photos AllTerrain Photo Editor can edit".
 *
 * @param shown   Photos rendered so far.
 * @param skipped Images passed over, of the pages read so far.
 * @param hasMore Whether the library has pages left.
 */
function countLabel( shown: number, skipped: number, hasMore: boolean ): string {
	// Reachable only while pages remain: a library read to the end with nothing in it
	// shows the invitation to upload instead of a count.
	let label = __( 'No photos to show yet.' );

	if ( shown > 0 ) {
		label = hasMore
			? sprintf(
					/* translators: %d: number of photos shown so far. */
					__( 'Showing the %d most recent photos.' ),
					shown
			  )
			: sprintf(
					/* translators: %d: total number of photos. */
					__( 'Showing all %d photos.' ),
					shown
			  );
	}

	if ( skipped < 1 ) {
		return label;
	}

	return `${ label } ${ sprintf(
		/* translators: %d: number of images that cannot be edited. */
		_n(
			'Passing over %d image AllTerrain Photo Editor cannot open.',
			'Passing over %d images AllTerrain Photo Editor cannot open.',
			skipped
		),
		skipped
	) }`;
}

/**
 * Reports a library that could not be read.
 *
 * @param ui    The picker's elements.
 * @param error The failure.
 */
function fail( ui: PickerChrome, error: unknown ): void {
	ui.status.textContent =
		error instanceof Error
			? error.message
			: __( 'Your media library could not be loaded.' );
	ui.status.classList.add( 'lz-picker__status--error' );

	if ( ! ui.status.isConnected ) {
		ui.root.appendChild( ui.status );
	}
}

/**
 * Replaces the grid with an invitation to upload something.
 *
 * "No editable images yet" is true of an empty library and misleading about a full one:
 * a library of nothing but animated GIFs reads, to this screen, exactly like a library
 * of nothing at all, and the user is invited to upload photos they have already
 * uploaded. So when images were passed over, the message says how many and why.
 *
 * @param ui      The picker's elements.
 * @param skipped Images in the library that AllTerrain Photo Editor cannot open.
 */
function showEmpty( ui: PickerChrome, skipped: number ): void {
	ui.status.textContent =
		skipped > 0
			? sprintf(
					/* translators: %d: number of images that cannot be edited. */
					_n(
						'Your library has %d image, and it is not one AllTerrain Photo Editor can open. AllTerrain Photo Editor edits JPEG, PNG, WebP and AVIF; an animated GIF is left alone because a canvas would flatten it to a single frame.',
						'Your library has %d images, and none of them are ones AllTerrain Photo Editor can open. AllTerrain Photo Editor edits JPEG, PNG, WebP and AVIF; animated GIFs are left alone because a canvas would flatten them to a single frame.',
						skipped
					),
					skipped
			  )
			: __(
					'No editable images yet. Upload a JPEG, PNG, WebP or AVIF to get started.'
			  );

	const link = document.createElement( 'a' );

	link.className = 'button button-primary';
	link.href = 'media-new.php';
	link.textContent = __( 'Upload a photo' );
	ui.root.appendChild( link );
}
