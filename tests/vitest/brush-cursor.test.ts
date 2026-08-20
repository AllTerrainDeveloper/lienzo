/**
 * The clone stamp's half of the brush cursor.
 *
 * The ring itself is geometry; what is worth pinning down is the state machine around
 * it -- where the sample marker sits before and after a stroke fixes the offset, and
 * that holding Alt swaps the ring for the picker without leaving either stuck on.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { BrushCursor } from '../../src/ui/brush-cursor';
import type { BrushCursorOptions } from '../../src/ui/brush-cursor';
import type { ActiveTool } from '../../src/ui/panels';
import type { Point } from '../../src/model/selection';

/** The canvas is drawn at half size: 400x200 shown in a 200x100 viewport at (10, 20). */
const VIEWPORT = { x: 10, y: 20, width: 200, height: 100 };

let cursor: BrushCursor | null = null;

/**
 * Builds a cursor over a detached stage.
 *
 * @param tool Active tool.
 */
function makeCursor( tool: ActiveTool ): {
	stage: HTMLElement;
	ring: HTMLElement;
	marker: HTMLElement;
	setSource: ( point: Point | null ) => void;
	setOffset: ( offset: Point | null ) => void;
} {
	const stage = document.createElement( 'div' );

	document.body.appendChild( stage );

	let source: Point | null = null;
	let offset: Point | null = null;

	cursor = new BrushCursor( {
		stage,
		getViewport: () => VIEWPORT,
		getCanvas: () => ( { width: 400, height: 200 } ),
		getTool: () => tool,
		getBrush: () => ( { size: 40, shape: 'hard', hardness: 1 } ),
		getCloneSource: () => source,
		getCloneOffset: () => offset,
	} satisfies BrushCursorOptions );

	return {
		stage,
		ring: stage.querySelector( '.lz-brush-cursor' ) as HTMLElement,
		marker: stage.querySelector( '.lz-clone-source' ) as HTMLElement,
		setSource: ( point ) => {
			source = point;
		},
		setOffset: ( next ) => {
			offset = next;
		},
	};
}

/**
 * A pointer move jsdom will dispatch.
 *
 * jsdom implements no `PointerEvent`, and the cursor only reads the mouse fields. The
 * detached stage's rect sits at (0, 0), so client coordinates are stage coordinates.
 *
 * @param stage Stage element.
 * @param x     Stage x, in CSS pixels.
 * @param y     Stage y, in CSS pixels.
 */
function move( stage: HTMLElement, x: number, y: number ): void {
	stage.dispatchEvent(
		new MouseEvent( 'pointermove', { bubbles: true, clientX: x, clientY: y } )
	);
}

/**
 * Presses or releases Alt.
 *
 * @param down Whether the key goes down.
 */
function alt( down: boolean ): void {
	window.dispatchEvent(
		new KeyboardEvent( down ? 'keydown' : 'keyup', { key: 'Alt' } )
	);
}

afterEach( () => {
	cursor?.destroy();
	cursor = null;
	document.body.innerHTML = '';
} );

describe( 'BrushCursor clone source marker', () => {
	it( 'stays hidden while no source is set', () => {
		const { stage, marker } = makeCursor( 'clone' );

		move( stage, 100, 80 );

		expect( marker.style.display ).toBe( 'none' );
	} );

	it( 'stays hidden for tools other than the clone stamp', () => {
		const { stage, marker, setSource } = makeCursor( 'brush' );

		setSource( { x: 100, y: 50 } );
		move( stage, 100, 80 );

		expect( marker.style.display ).toBe( 'none' );
	} );

	it( 'pins on the picked point before any stroke, in stage pixels', () => {
		const { stage, marker, setSource } = makeCursor( 'clone' );

		setSource( { x: 100, y: 50 } );
		move( stage, 150, 90 );

		// Canvas (100, 50) at half zoom, inside a viewport at (10, 20).
		expect( marker.style.display ).toBe( '' );
		expect( marker.style.insetInlineStart ).toBe( '60px' );
		expect( marker.style.insetBlockStart ).toBe( '45px' );
	} );

	it( 'tracks the pointer at the fixed offset once a stroke set one', () => {
		const { stage, marker, setSource, setOffset } = makeCursor( 'clone' );

		setSource( { x: 100, y: 50 } );
		setOffset( { x: 40, y: 20 } );
		move( stage, 100, 80 );

		// The dab at the pointer reads 40x20 canvas pixels back: half that on screen.
		expect( marker.style.insetInlineStart ).toBe( '80px' );
		expect( marker.style.insetBlockStart ).toBe( '70px' );
	} );

	it( 'falls back to the picked point when the pointer leaves the stage', () => {
		const { stage, marker, setSource, setOffset } = makeCursor( 'clone' );

		setSource( { x: 100, y: 50 } );
		setOffset( { x: 40, y: 20 } );
		move( stage, 100, 80 );
		stage.dispatchEvent( new MouseEvent( 'pointerleave' ) );

		expect( marker.style.insetInlineStart ).toBe( '60px' );
		expect( marker.style.insetBlockStart ).toBe( '45px' );
	} );
} );

describe( 'BrushCursor Alt sample picker', () => {
	it( 'swaps the ring for the picker while Alt is held', () => {
		const { stage, ring } = makeCursor( 'clone' );

		move( stage, 100, 80 );
		expect( ring.style.display ).toBe( '' );

		alt( true );
		expect( stage.classList.contains( 'is-sampling' ) ).toBe( true );
		expect( ring.style.display ).toBe( 'none' );

		alt( false );
		expect( stage.classList.contains( 'is-sampling' ) ).toBe( false );
		expect( ring.style.display ).toBe( '' );
	} );

	it( 'ignores Alt on tools that do not sample', () => {
		const { stage } = makeCursor( 'brush' );

		alt( true );

		expect( stage.classList.contains( 'is-sampling' ) ).toBe( false );
	} );

	it( 'lets go of Alt when the window loses focus', () => {
		const { stage } = makeCursor( 'clone' );

		alt( true );
		window.dispatchEvent( new Event( 'blur' ) );

		expect( stage.classList.contains( 'is-sampling' ) ).toBe( false );
	} );
} );
