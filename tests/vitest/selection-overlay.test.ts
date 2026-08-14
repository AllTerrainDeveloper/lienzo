import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectionOverlay, SELECT_ALL } from '../../src/editor/selection-overlay';
import { attachEditorShortcuts } from '../../src/editor/shortcuts';
import type { ShortcutTarget } from '../../src/editor/shortcuts';
import type { Selection } from '../../src/model/selection';

/**
 * A rectangle, in normalised coordinates.
 *
 * @param x Left edge, 0..1.
 */
function rect( x: number ): Selection {
	return {
		shape: 'rect',
		points: [
			{ x, y: 0.1 },
			{ x: x + 0.2, y: 0.4 },
		],
	};
}

/** An overlay wired to nothing in particular. */
function overlay(): SelectionOverlay {
	return new SelectionOverlay( {
		stage: document.createElement( 'div' ),
		getViewport: () => null,
		getCanvas: () => ( { width: 40, height: 40 } ),
		setMask: () => {},
		onChange: () => {},
	} );
}

describe( 'SelectionOverlay history', () => {
	const realContext = HTMLCanvasElement.prototype.getContext;

	// jsdom has no 2D backend, and the mask rasteriser is already written to cope with
	// one that refuses. Answering null is that path, quietly, rather than a page of
	// "not implemented" between every assertion.
	beforeAll( () => {
		HTMLCanvasElement.prototype.getContext = ( () =>
			null ) as unknown as typeof realContext;
	} );

	afterAll( () => {
		HTMLCanvasElement.prototype.getContext = realContext;
	} );

	it( 'has nothing to step back to before anything is selected', () => {
		expect( overlay().canStepBack ).toBe( false );
	} );

	it( 'puts back the selection the last one replaced', () => {
		const marquee = overlay();
		const first = rect( 0.1 );

		marquee.set( first );
		marquee.set( rect( 0.5 ) );

		expect( marquee.stepBack() ).toBe( true );
		expect( marquee.current ).toBe( first );
	} );

	it( 'restores a selection that was dropped, which is Reselect', () => {
		const marquee = overlay();
		const chosen = rect( 0.1 );

		marquee.set( chosen );
		marquee.set( null );
		expect( marquee.current ).toBeNull();

		marquee.stepBack();

		expect( marquee.current ).toBe( chosen );
	} );

	it( 'does not record its own steps, so two presses go two back', () => {
		const marquee = overlay();
		const first = rect( 0.1 );
		const second = rect( 0.4 );

		marquee.set( first );
		marquee.set( second );
		marquee.set( rect( 0.7 ) );

		marquee.stepBack();
		expect( marquee.current ).toBe( second );

		// Ping-ponging between the last two is the one behaviour nobody wants here.
		marquee.stepBack();
		expect( marquee.current ).toBe( first );
	} );

	it( 'walks back to nothing selected and then stops', () => {
		const marquee = overlay();

		marquee.set( rect( 0.1 ) );

		expect( marquee.stepBack() ).toBe( true );
		expect( marquee.current ).toBeNull();
		expect( marquee.stepBack() ).toBe( false );
		expect( marquee.canStepBack ).toBe( false );
	} );

	it( 'does not fill the history with changes that changed nothing', () => {
		const marquee = overlay();
		const chosen = rect( 0.1 );

		marquee.set( chosen );

		// Escape over an empty canvas, three times. Without the guard these bury the
		// selection actually worth returning to.
		marquee.set( null );
		marquee.set( null );
		marquee.set( null );

		marquee.stepBack();

		expect( marquee.current ).toBe( chosen );
	} );

	it( 'treats an empty region as nothing selected', () => {
		const marquee = overlay();

		marquee.set( { shape: 'rect', points: [] } );

		expect( marquee.current ).toBeNull();
		expect( marquee.canStepBack ).toBe( false );
	} );

	it( 'bounds what it keeps', () => {
		const marquee = overlay();

		for ( let i = 0; i < 40; i++ ) {
			marquee.set( rect( i / 100 ) );
		}

		let steps = 0;

		while ( marquee.stepBack() ) {
			steps++;
		}

		// Twenty, and never the whole session's worth of six-hundred-point lassos.
		expect( steps ).toBe( 20 );
	} );

	it( 'remembers a select-all like any other change', () => {
		const marquee = overlay();
		const chosen = rect( 0.1 );

		marquee.set( chosen );
		marquee.selectAll();
		expect( marquee.current ).toEqual( SELECT_ALL );

		marquee.stepBack();

		expect( marquee.current ).toBe( chosen );
	} );
} );

describe( 'the step back shortcut', () => {
	let target: ShortcutTarget;
	let detach: () => void;

	beforeEach( () => {
		target = {
			undo: vi.fn(),
			redo: vi.fn(),
			copy: vi.fn(),
			paste: vi.fn(),
			selectAll: vi.fn(),
			deselect: vi.fn(),
			stepSelectionBack: vi.fn(),
			hasSelection: () => true,
			hasPendingPath: () => false,
			getTool: () => 'select',
			getSelectionShape: () => 'rect',
			commitPath: () => false,
			closeShape: vi.fn(),
			undoAnchor: () => false,
			clearPath: vi.fn(),
			resetView: vi.fn(),
		};

		detach?.();
		detach = attachEditorShortcuts( target );
	} );

	/**
	 * Presses a key with the command modifier held.
	 *
	 * @param key   Key to press.
	 * @param shift Whether Shift is held too.
	 */
	function press( key: string, shift = false ): void {
		document.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key,
				ctrlKey: true,
				shiftKey: shift,
				bubbles: true,
				cancelable: true,
			} )
		);
	}

	it( 'steps the selection back on Cmd+Shift+D', () => {
		press( 'd', true );

		expect( target.stepSelectionBack ).toHaveBeenCalled();
		expect( target.deselect ).not.toHaveBeenCalled();
	} );

	it( 'still deselects on Cmd+D', () => {
		press( 'd' );

		expect( target.deselect ).toHaveBeenCalled();
		expect( target.stepSelectionBack ).not.toHaveBeenCalled();
	} );
} );
