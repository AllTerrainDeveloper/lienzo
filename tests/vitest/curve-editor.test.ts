/**
 * The tone curve's drag lifecycle.
 *
 * All of it about how a drag *ends*, because that is where it was wrong: the move and
 * release were tracked on the canvas, so letting go outside the graph never reached a
 * handler and the grabbed point went on following a mouse with no button held.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CurveEditor } from '../../src/ui/curve-editor';
import type { CurvePoint } from '../../src/engine/lut';

/** The graph is drawn as a square; this is the box the test pretends it occupies. */
const BOX = { x: 0, y: 0, width: 256, height: 256 };

/**
 * A pointer event jsdom will dispatch, carrying the fields the editor reads.
 *
 * jsdom implements no `PointerEvent`, which is the whole reason the editor tests for
 * one by shape rather than by constructor.
 *
 * @param type    Event type.
 * @param graph   Position in graph units, 0..255 with y up.
 * @param pointer Pointer id.
 */
function pointer( type: string, graph: { x: number; y: number }, pointer = 1 ): Event {
	// The inverse of the editor's own `toGraph()`: the box is 256 CSS pixels across but
	// the graph is 0..255, so the two are not interchangeable.
	const event = new MouseEvent( type, {
		bubbles: true,
		cancelable: true,
		clientX: BOX.x + ( graph.x / 255 ) * BOX.width,
		clientY: BOX.y + ( 1 - graph.y / 255 ) * BOX.height,
	} );

	Object.defineProperty( event, 'pointerId', { value: pointer } );

	return event;
}

describe( 'CurveEditor', () => {
	let points: CurvePoint[];
	let editor: CurveEditor;
	let canvas: HTMLCanvasElement;
	let commits: number;

	beforeEach( () => {
		points = [
			[ 0, 0 ],
			[ 128, 128 ],
			[ 255, 255 ],
		];
		commits = 0;

		editor = new CurveEditor( {
			getPoints: () => points,
			onChange: ( next ) => {
				points = next;
			},
			onCommit: () => {
				commits++;
			},
		} );

		canvas = editor.el.querySelector( 'canvas' ) as HTMLCanvasElement;
		document.body.appendChild( editor.el );

		// jsdom lays nothing out, and every coordinate the editor reads comes from here.
		canvas.getBoundingClientRect = () => ( { ...BOX, top: 0, left: 0, right: 256, bottom: 256, toJSON: () => ( {} ) } ) as DOMRect;
		canvas.setPointerCapture = vi.fn();
		canvas.releasePointerCapture = vi.fn();
	} );

	// Every editor is torn down, because they listen on `window` -- one left alive
	// hears the next test's events and answers them.
	afterEach( () => {
		editor.destroy();
		editor.el.remove();
	} );

	/**
	 * Grabs the middle control point.
	 */
	function grabMiddle(): void {
		canvas.dispatchEvent( pointer( 'pointerdown', { x: 128, y: 128 } ) );
	}

	it( 'follows the pointer while it is down', () => {
		grabMiddle();
		window.dispatchEvent( pointer( 'pointermove', { x: 128, y: 200 } ) );

		expect( points[ 1 ] ).toEqual( [ 128, 200 ] );
	} );

	it( 'lets go when the release lands outside the graph', () => {
		grabMiddle();
		window.dispatchEvent( pointer( 'pointermove', { x: 128, y: 200 } ) );
		// Released well outside the canvas, which is where the old code heard nothing.
		window.dispatchEvent( pointer( 'pointerup', { x: 700, y: 200 } ) );

		const settled = points[ 1 ];

		window.dispatchEvent( pointer( 'pointermove', { x: 128, y: 40 } ) );

		expect( points[ 1 ] ).toEqual( settled );
		expect( commits ).toBe( 1 );
	} );

	it( 'lets go when the gesture is cancelled', () => {
		grabMiddle();
		window.dispatchEvent( pointer( 'pointercancel', { x: 128, y: 128 } ) );
		window.dispatchEvent( pointer( 'pointermove', { x: 128, y: 20 } ) );

		expect( points[ 1 ] ).toEqual( [ 128, 128 ] );
	} );

	it( 'lets go when the window loses focus mid-drag', () => {
		grabMiddle();
		window.dispatchEvent( new Event( 'blur' ) );
		window.dispatchEvent( pointer( 'pointermove', { x: 128, y: 20 } ) );

		expect( points[ 1 ] ).toEqual( [ 128, 128 ] );
	} );

	it( 'still deletes a point flicked well clear of the graph', () => {
		grabMiddle();
		window.dispatchEvent( pointer( 'pointermove', { x: 128, y: 600 } ) );
		window.dispatchEvent( pointer( 'pointerup', { x: 128, y: 600 } ) );

		// The endpoints define the domain and stay; the one in the middle goes.
		expect( points ).toEqual( [
			[ 0, 0 ],
			[ 255, 255 ],
		] );
	} );

	it( 'reads where the pointer was, not where a cancel claims it is', () => {
		grabMiddle();
		window.dispatchEvent( pointer( 'pointermove', { x: 128, y: 600 } ) );
		// A cancel carries no useful position. The drag still ended out in the weeds.
		window.dispatchEvent( pointer( 'pointercancel', { x: 0, y: 0 } ) );

		expect( points ).toEqual( [
			[ 0, 0 ],
			[ 255, 255 ],
		] );
	} );

	it( 'ignores a second pointer while one is dragging', () => {
		grabMiddle();
		window.dispatchEvent( pointer( 'pointermove', { x: 128, y: 200 }, 2 ) );

		expect( points[ 1 ] ).toEqual( [ 128, 128 ] );

		window.dispatchEvent( pointer( 'pointerup', { x: 0, y: 0 }, 2 ) );
		window.dispatchEvent( pointer( 'pointermove', { x: 128, y: 200 }, 1 ) );

		// The owning pointer still has it.
		expect( points[ 1 ] ).toEqual( [ 128, 200 ] );
	} );

	it( 'commits once, however many endings arrive', () => {
		grabMiddle();
		window.dispatchEvent( pointer( 'pointerup', { x: 128, y: 128 } ) );
		window.dispatchEvent( pointer( 'pointerup', { x: 128, y: 128 } ) );
		window.dispatchEvent( new Event( 'blur' ) );

		expect( commits ).toBe( 1 );
	} );

	it( 'drops a drag in progress when it is destroyed', () => {
		grabMiddle();
		editor.destroy();
		window.dispatchEvent( pointer( 'pointermove', { x: 128, y: 20 } ) );

		expect( points[ 1 ] ).toEqual( [ 128, 128 ] );
	} );
} );
