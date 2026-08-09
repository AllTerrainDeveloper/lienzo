import { describe, expect, it } from 'vitest';
import {
	buildEdgeField,
	LiveWire,
	MAX_FIELD_PIXELS,
} from '../../src/engine/magnetic';
import type { EdgeField } from '../../src/engine/magnetic';
import {
	anchorMarks,
	isPlacedShape,
	simplifyPath,
} from '../../src/model/selection';
import { MagneticTrace, anchorSpacing } from '../../src/ui/stage-tools/magnetic-trace';
import {
	closeMagnetic,
	moveMagnetic,
	pressMagnetic,
	undoMagneticAnchor,
} from '../../src/ui/stage-tools/magnetic-tools';
import type { Gesture } from '../../src/ui/stage-tools/gesture';
import type { StageToolsOptions } from '../../src/ui/stage-tools';
import { defaultBrush } from '../../src/ui/stage-tools';
import type { BrushSettings } from '../../src/ui/stage-tools';
import type { Selection, SelectionAnchor } from '../../src/model/selection';

/** A blank RGBA document, opaque black. */
function blank( width: number, height: number ): Uint8ClampedArray {
	const pixels = new Uint8ClampedArray( width * height * 4 );

	for ( let i = 3; i < pixels.length; i += 4 ) {
		pixels[ i ] = 255;
	}

	return pixels;
}

/**
 * Paints a filled rectangle into a document.
 *
 * @param pixels Document.
 * @param width  Document width.
 * @param rect   Rectangle, in pixels.
 * @param colour RGB.
 */
function fill(
	pixels: Uint8ClampedArray,
	width: number,
	rect: { x: number; y: number; w: number; h: number },
	colour: [ number, number, number ]
): void {
	for ( let y = rect.y; y < rect.y + rect.h; y++ ) {
		for ( let x = rect.x; x < rect.x + rect.w; x++ ) {
			const i = ( y * width + x ) * 4;

			pixels[ i ] = colour[ 0 ];
			pixels[ i + 1 ] = colour[ 1 ];
			pixels[ i + 2 ] = colour[ 2 ];
			pixels[ i + 3 ] = 255;
		}
	}
}

/** A white square on black: the shape every test below traces. */
const SQUARE = { x: 30, y: 30, w: 60, h: 60 };

/**
 * A 120x120 document with one white square in the middle of it.
 */
function squareDocument(): { pixels: Uint8ClampedArray; width: number; height: number } {
	const pixels = blank( 120, 120 );

	fill( pixels, 120, SQUARE, [ 255, 255, 255 ] );

	return { pixels, width: 120, height: 120 };
}

/** The subject of the photograph below. */
const ELLIPSE = { cx: 120, cy: 120, rx: 70, ry: 56 };

/**
 * Something closer to a photograph than to a diagram.
 *
 * A soft-edged ellipse over a graduated sky, both grainy, with the subject striped
 * strongly enough that its own texture is an edge the wire could mistake for its
 * outline. Deterministic, because a tracing tool that only works on some seeds is
 * broken and a test that only fails on some seeds is worse.
 */
function photograph(): {
	pixels: Uint8ClampedArray;
	width: number;
	height: number;
} {
	const pixels = new Uint8ClampedArray( 240 * 240 * 4 );
	const { cx, cy, rx, ry } = ELLIPSE;

	let seed = 1;

	for ( let y = 0; y < 240; y++ ) {
		for ( let x = 0; x < 240; x++ ) {
			const i = ( y * 240 + x ) * 4;
			const inside = Math.min(
				1,
				Math.max(
					0,
					0.5 - ( Math.hypot( x - cx, ( ( y - cy ) * rx ) / ry ) - rx )
				)
			);
			const stripe = inside > 0 ? Math.sin( x * 0.55 ) * 0.5 + 0.5 : 0;

			seed = ( seed * 1103515245 + 12345 ) & 0x7fffffff;

			const grain = ( seed / 0x7fffffff - 0.5 ) * 14;
			const sky = [ 70 + y * 0.25, 95 + y * 0.3, 140 + y * 0.2 ];
			const subject = [ 180 + 60 * stripe, 100 + 50 * stripe, 45 + 40 * stripe ];

			for ( let channel = 0; channel < 3; channel++ ) {
				pixels[ i + channel ] =
					sky[ channel ] * ( 1 - inside ) + subject[ channel ] * inside + grain;
			}

			pixels[ i + 3 ] = 255;
		}
	}

	return { pixels, width: 240, height: 240 };
}

/**
 * The strength of a field at a point.
 *
 * @param field Edge field.
 * @param x     Field coordinates.
 * @param y     Field coordinates.
 */
function strengthAt( field: EdgeField, x: number, y: number ): number {
	return field.strength[ y * field.width + x ];
}

describe( 'buildEdgeField', () => {
	it( 'refuses a document too small to have a gradient', () => {
		expect( buildEdgeField( blank( 2, 2 ), 2, 2 ) ).toBeNull();
	} );

	it( 'finds the boundary of a square and nothing either side of it', () => {
		const doc = squareDocument();
		const field = buildEdgeField( doc.pixels, doc.width, doc.height );

		expect( field ).not.toBeNull();

		// On the boundary, in the black outside it, and in the white inside it.
		expect( strengthAt( field!, 30, 60 ) ).toBeGreaterThan( 200 );
		expect( strengthAt( field!, 15, 60 ) ).toBe( 0 );
		expect( strengthAt( field!, 60, 60 ) ).toBe( 0 );
	} );

	it( 'finds a boundary between two colours of the same brightness', () => {
		// Red and green chosen so their luminances are within a percent of each other:
		// a detector working on brightness sees almost nothing here, which is the whole
		// reason this one takes the gradient per channel.
		const pixels = blank( 120, 120 );

		fill( pixels, 120, { x: 0, y: 0, w: 120, h: 120 }, [ 220, 60, 60 ] );
		fill( pixels, 120, SQUARE, [ 0, 128, 60 ] );

		const field = buildEdgeField( pixels, 120, 120 );

		expect( strengthAt( field!, 30, 60 ) ).toBeGreaterThan( 200 );
		expect( strengthAt( field!, 15, 60 ) ).toBe( 0 );
	} );

	it( 'runs the edge across the boundary, so the tangent runs along it', () => {
		const doc = squareDocument();
		const field = buildEdgeField( doc.pixels, doc.width, doc.height )!;
		const at = 60 * field.width + 30;

		// The left edge of the square is vertical, so its tangent is too.
		expect( Math.abs( field.tangentX[ at ] ) ).toBeLessThan( 16 );
		expect( Math.abs( field.tangentY[ at ] ) ).toBeGreaterThan( 100 );
	} );

	it( 'discards edges under the contrast floor', () => {
		const pixels = blank( 120, 120 );

		// A faint square: a real boundary, but a tenth of the contrast of a white one.
		fill( pixels, 120, SQUARE, [ 26, 26, 26 ] );

		const lenient = buildEdgeField( pixels, 120, 120, 0 )!;
		const strict = buildEdgeField( pixels, 120, 120, 0.5 )!;

		// Normalisation is against the picture's own gradients, so a faint edge is still
		// the strongest thing here -- until the floor is raised past it.
		expect( strengthAt( lenient, 30, 60 ) ).toBeGreaterThan( 200 );
		expect( strengthAt( strict, 15, 60 ) ).toBe( 0 );
	} );

	it( 'samples a document too large to measure whole', () => {
		const side = Math.ceil( Math.sqrt( MAX_FIELD_PIXELS ) ) + 400;
		const field = buildEdgeField( blank( side, side ), side, side )!;

		expect( field.step ).toBeGreaterThan( 1 );
		expect( field.width * field.height ).toBeLessThanOrEqual( MAX_FIELD_PIXELS );
	} );
} );

describe( 'LiveWire', () => {
	it( 'follows a boundary rather than the straight line to the pointer', () => {
		const doc = squareDocument();
		const wire = new LiveWire( buildEdgeField( doc.pixels, doc.width, doc.height )! );

		// Anchored on the left edge, pointing at a spot four pixels off it: a straight
		// line would cut the corner across the black, and the wire should not.
		wire.seed( 30, 40, 40 );

		const route = wire.pathTo( 34, 75 )!;

		expect( route ).not.toBeNull();
		expect( route[ 0 ] ).toEqual( { x: 30, y: 40 } );
		expect( route[ route.length - 1 ] ).toEqual( { x: 34, y: 75 } );

		// Every point but the short hop out to the pointer sits on the edge.
		const onEdge = route.filter( ( at ) => Math.abs( at.x - 30 ) <= 1 ).length;

		expect( onEdge ).toBeGreaterThan( route.length - 6 );
	} );

	it( 'goes the long way round rather than across an object', () => {
		const doc = squareDocument();
		const wire = new LiveWire( buildEdgeField( doc.pixels, doc.width, doc.height )! );

		// Two opposite corners of the square. Straight across is 85 pixels of blank
		// white; round two sides is 120 pixels of boundary, and boundary is cheaper.
		wire.seed( 30, 30, 90 );

		const route = wire.pathTo( 89, 89 )!;
		const across = route.filter(
			( at ) => at.x > 34 && at.x < 85 && at.y > 34 && at.y < 85
		).length;

		expect( route.length ).toBeGreaterThan( 110 );
		expect( across ).toBe( 0 );
	} );

	it( 'declines a point outside the width it was given', () => {
		const doc = squareDocument();
		const wire = new LiveWire( buildEdgeField( doc.pixels, doc.width, doc.height )! );

		wire.seed( 30, 40, 10 );

		expect( wire.pathTo( 30, 100 ) ).toBeNull();
		expect( wire.pathTo( 30, 48 ) ).not.toBeNull();
	} );

	it( 'reports where it is anchored', () => {
		const doc = squareDocument();
		const wire = new LiveWire( buildEdgeField( doc.pixels, doc.width, doc.height )! );

		wire.seed( 30, 40, 10 );
		expect( wire.anchor ).toEqual( { x: 30, y: 40 } );

		wire.seed( 55, 12, 10 );
		expect( wire.anchor ).toEqual( { x: 55, y: 12 } );
	} );

	it( 'answers a repeated question without re-searching', () => {
		const doc = squareDocument();
		const wire = new LiveWire( buildEdgeField( doc.pixels, doc.width, doc.height )! );

		wire.seed( 30, 30, 60 );

		const first = wire.pathTo( 30, 85 );
		const second = wire.pathTo( 30, 85 );

		expect( second ).toEqual( first );
	} );
} );

describe( 'anchorMarks', () => {
	it( 'draws a closed square centred on each anchor', () => {
		const d = anchorMarks(
			[ { point: { x: 0.5, y: 0.25 }, manual: true } ],
			200,
			100,
			8
		);

		// Centred on (100, 25) with a side of 8, so it starts four either way from it.
		expect( d ).toBe( 'M 96 21 h 8 v 8 h -8 Z' );
	} );

	it( 'draws nothing for no anchors, so the attribute empties', () => {
		expect( anchorMarks( [], 200, 100, 8 ) ).toBe( '' );
	} );
} );

describe( 'simplifyPath', () => {
	it( 'collapses a straight run to its ends', () => {
		const line = Array.from( { length: 50 }, ( _, i ) => ( { x: i, y: 0 } ) );

		expect( simplifyPath( line, 0.5 ) ).toEqual( [
			{ x: 0, y: 0 },
			{ x: 49, y: 0 },
		] );
	} );

	it( 'collapses the staircase a traced diagonal arrives as', () => {
		// What a pixel grid gives you for a 45-degree edge: alternating right and down.
		const stairs: Array< { x: number; y: number } > = [];

		for ( let i = 0; i < 40; i++ ) {
			stairs.push( { x: i, y: i }, { x: i + 1, y: i } );
		}

		expect( simplifyPath( stairs, 1 ).length ).toBeLessThan( 5 );
	} );

	it( 'keeps a corner', () => {
		const corner = [
			{ x: 0, y: 0 },
			{ x: 5, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 5 },
			{ x: 10, y: 10 },
		];

		expect( simplifyPath( corner, 0.5 ) ).toEqual( [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
		] );
	} );

	it( 'leaves alone what it cannot shorten', () => {
		const two = [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		];

		expect( simplifyPath( two, 5 ) ).toBe( two );
		expect( simplifyPath( two, 0 ) ).toBe( two );
	} );
} );

describe( 'anchorSpacing', () => {
	it( 'inverts the setting: more anchors means less distance between them', () => {
		expect( anchorSpacing( 100 ) ).toBeLessThan( anchorSpacing( 0 ) );
		expect( anchorSpacing( 100 ) ).toBe( 4 );
	} );

	it( 'clamps a setting from outside the range the bar offers', () => {
		expect( anchorSpacing( -50 ) ).toBe( anchorSpacing( 0 ) );
		expect( anchorSpacing( 500 ) ).toBe( anchorSpacing( 100 ) );
	} );
} );

describe( 'isPlacedShape', () => {
	it( 'names the shapes with no release to finish them', () => {
		expect( isPlacedShape( 'polygon' ) ).toBe( true );
		expect( isPlacedShape( 'magnetic' ) ).toBe( true );
		expect( isPlacedShape( 'rect' ) ).toBe( false );
		expect( isPlacedShape( 'lasso' ) ).toBe( false );
	} );
} );

/** What a fake stage recorded while a trace ran over it. */
interface Harness {
	options: StageToolsOptions;
	gesture: Gesture;
	brush: BrushSettings;
	preview: () => Selection | null;
	committed: () => Selection | null;
	anchors: () => SelectionAnchor[];
}

/**
 * A stage with one document on it and nothing else.
 *
 * @param document Optional. Pixels to trace over. A white square by default.
 */
function harness( document = squareDocument() ): Harness {
	const brush = defaultBrush();

	let preview: Selection | null = null;
	let committed: Selection | null = null;
	let anchors: SelectionAnchor[] = [];

	const options = {
		getViewport: () => ( { x: 0, y: 0, width: document.width, height: document.height } ),
		getCanvas: () => ( { width: document.width, height: document.height } ),
		getBrush: () => brush,
		readDocument: () => document,
		getSelectionMode: () => 'new' as const,
		previewSelection: ( next: Selection | null ) => {
			preview = next;
		},
		previewAnchors: ( next: SelectionAnchor[] ) => {
			anchors = next;
		},
		commitSelection: ( next: Selection | null ) => {
			committed = next;
		},
	} as unknown as StageToolsOptions;

	const gesture = {
		magnetic: new MagneticTrace( options ),
		selectionMode: 'new',
	} as unknown as Gesture;

	return {
		options,
		gesture,
		brush,
		preview: () => preview,
		committed: () => committed,
		anchors: () => anchors,
	};
}

/** A press, with no modifier keys held. */
const CLICK = { shiftKey: false, altKey: false } as unknown as PointerEvent;

/**
 * Walks the pointer round the square, a few pixels at a time.
 *
 * Deliberately sloppy -- every step is nudged outwards, off the boundary -- because a
 * tool that only works when the pointer is already exactly on the edge is not a
 * magnetic lasso, it is a lasso.
 *
 * @param h      The stage.
 * @param offset How far off the boundary the pointer strays.
 */
function traceSquare( h: Harness, offset: number ): void {
	const { x, y, w, h: height } = SQUARE;
	const corners = [
		{ x, y },
		{ x, y: y + height - 1 },
		{ x: x + w - 1, y: y + height - 1 },
		{ x: x + w - 1, y },
	];

	pressMagnetic( h.options, h.gesture, corners[ 0 ], CLICK );

	for ( let side = 0; side < 4; side++ ) {
		const from = corners[ side ];
		const to = corners[ ( side + 1 ) % 4 ];

		for ( let step = 1; step <= 12; step++ ) {
			const t = step / 12;
			// Outwards from the centre of the square, so the pointer is always in the
			// black rather than helpfully sitting on the edge.
			const at = {
				x: from.x + ( to.x - from.x ) * t,
				y: from.y + ( to.y - from.y ) * t,
			};
			const away = {
				x: at.x < 60 ? -offset : offset,
				y: at.y < 60 ? -offset : offset,
			};

			moveMagnetic( h.options, h.gesture, {
				x: at.x + ( from.x === to.x ? away.x : 0 ),
				y: at.y + ( from.y === to.y ? away.y : 0 ),
			} );
		}
	}
}

describe( 'MagneticTrace', () => {
	it( 'declines when there are no pixels to follow', () => {
		const h = harness();

		( h.options as { readDocument: () => null } ).readDocument = () => null;

		expect( pressMagnetic( h.options, h.gesture, { x: 10, y: 10 }, CLICK ) ).toBe(
			false
		);
		expect( h.gesture.magnetic.isTracing ).toBe( false );
	} );

	it( 'starts tracing on the first press and shows nothing yet', () => {
		const h = harness();

		expect( pressMagnetic( h.options, h.gesture, { x: 30, y: 30 }, CLICK ) ).toBe(
			true
		);
		expect( h.gesture.magnetic.isTracing ).toBe( true );
		expect( h.gesture.magnetic.anchorCount ).toBe( 1 );

		// One point is not an outline.
		expect( h.preview() ).toBeNull();
	} );

	it( 'snaps a sloppy trace onto the edge of the object', () => {
		const h = harness();

		traceSquare( h, 5 );

		const selection = closeSelection( h );
		const width = 120;

		expect( selection ).not.toBeNull();

		// The pointer was never nearer than five pixels to the boundary, and the result
		// is on it to within a pixel and a half.
		for ( const point of selection!.points ) {
			const x = point.x * width;
			const y = point.y * width;
			const onVertical = Math.abs( x - 30 ) < 1.5 || Math.abs( x - 89.5 ) < 1.5;
			const onHorizontal = Math.abs( y - 30 ) < 1.5 || Math.abs( y - 89.5 ) < 1.5;

			expect( onVertical || onHorizontal ).toBe( true );
		}
	} );

	it( 'encloses the object it traced', () => {
		const h = harness();

		traceSquare( h, 4 );

		const selection = closeSelection( h )!;
		const xs = selection.points.map( ( p ) => p.x * 120 );
		const ys = selection.points.map( ( p ) => p.y * 120 );

		expect( Math.min( ...xs ) ).toBeGreaterThan( 28 );
		expect( Math.min( ...xs ) ).toBeLessThan( 32 );
		expect( Math.max( ...xs ) ).toBeGreaterThan( 87 );
		expect( Math.max( ...xs ) ).toBeLessThan( 92 );
		expect( Math.min( ...ys ) ).toBeGreaterThan( 28 );
		expect( Math.max( ...ys ) ).toBeLessThan( 92 );
	} );

	it( 'spends few vertices on a shape with four corners', () => {
		const h = harness();

		traceSquare( h, 4 );

		// 240 pixels of boundary arrive as hundreds of grid steps. What is kept is a
		// square, plus the handful of vertices where the trace joined and closed.
		expect( closeSelection( h )!.points.length ).toBeLessThan( 20 );
	} );

	it( 'pins anchors as it goes, without being asked', () => {
		const h = harness();

		traceSquare( h, 4 );

		expect( h.gesture.magnetic.anchorCount ).toBeGreaterThan( 4 );
	} );

	it( 'takes an anchor back, and abandons the trace with the last one', () => {
		const h = harness();

		traceSquare( h, 4 );

		const before = h.gesture.magnetic.anchorCount;

		expect( undoMagneticAnchor( h.options, h.gesture ) ).toBe( true );
		expect( h.gesture.magnetic.anchorCount ).toBe( before - 1 );

		for ( let i = 0; i < before; i++ ) {
			undoMagneticAnchor( h.options, h.gesture );
		}

		expect( h.gesture.magnetic.isTracing ).toBe( false );
		expect( h.preview() ).toBeNull();
		expect( undoMagneticAnchor( h.options, h.gesture ) ).toBe( false );
	} );

	it( 'reads a press near where it started as "close here"', () => {
		const h = harness();

		traceSquare( h, 4 );
		expect( h.gesture.magnetic.nearStart( { x: 32, y: 31 } ) ).toBe( true );
		expect( h.gesture.magnetic.nearStart( { x: 60, y: 89 } ) ).toBe( false );

		pressMagnetic( h.options, h.gesture, { x: 32, y: 31 }, CLICK );

		expect( h.gesture.magnetic.isTracing ).toBe( false );
		expect( h.committed() ).not.toBeNull();
		expect( h.preview() ).toBeNull();
	} );

	it( 'will not close a loop it has barely started', () => {
		const h = harness();

		pressMagnetic( h.options, h.gesture, { x: 30, y: 30 }, CLICK );

		expect( h.gesture.magnetic.nearStart( { x: 30, y: 30 } ) ).toBe( false );
		expect( closeMagnetic( h.options, h.gesture ) ).toBe( true );
		expect( h.committed() ).toBeNull();
	} );

	it( 'fixes the boolean mode at the first press, not the close', () => {
		const h = harness();
		const shifted = { shiftKey: true, altKey: false } as unknown as PointerEvent;

		pressMagnetic( h.options, h.gesture, { x: 30, y: 30 }, shifted );

		expect( h.gesture.selectionMode ).toBe( 'add' );

		// A later press with nothing held pins an anchor and must not change the mode.
		moveMagnetic( h.options, h.gesture, { x: 30, y: 50 } );
		pressMagnetic( h.options, h.gesture, { x: 30, y: 50 }, CLICK );

		expect( h.gesture.selectionMode ).toBe( 'add' );
	} );

	it( 'invents no boundary where a picture has none', () => {
		// A blank document: there is nothing to follow anywhere in it, and what comes
		// back is the straight line the pointer asked for and nothing else.
		const h = harness( { pixels: blank( 120, 120 ), width: 120, height: 120 } );

		pressMagnetic( h.options, h.gesture, { x: 10, y: 10 }, CLICK );
		moveMagnetic( h.options, h.gesture, { x: 110, y: 110 } );

		const points = h.preview()!.points;

		expect( points.length ).toBeGreaterThan( 1 );

		for ( const point of points ) {
			expect( Math.abs( point.x - point.y ) * 120 ).toBeLessThan( 2 );
		}
	} );

	it( 'keeps up with a pointer it cannot reach, rather than stalling', () => {
		const h = harness( { pixels: blank( 400, 400 ), width: 400, height: 400 } );

		// A narrow search, and a pointer flicked right across the document.
		h.brush.magneticWidth = 8;
		pressMagnetic( h.options, h.gesture, { x: 10, y: 200 }, CLICK );

		const far = { x: 390, y: 200 };
		const reached = () => {
			const points = h.preview()!.points;

			return points[ points.length - 1 ].x * 400;
		};

		moveMagnetic( h.options, h.gesture, far );

		// It got there -- and got there by walking the anchor along, not by rubber-banding
		// from a search that had been left behind. Without that walk, a single flick of
		// the wrist would strand the wire at the first anchor for the rest of the trace.
		expect( reached() ).toBeGreaterThan( 380 );
		expect( h.gesture.magnetic.anchorCount ).toBeGreaterThan( 1 );

		moveMagnetic( h.options, h.gesture, far );

		expect( reached() ).toBeGreaterThan( 380 );
	} );

	it( 'reads its width in screen pixels, so zoom does not change the tool', () => {
		const zoomed = harness();

		// The same document shown at a quarter size: one screen pixel is now four
		// document pixels, and a 20-pixel width has to reach four times as far.
		( zoomed.options as { getViewport: () => object } ).getViewport = () => ( {
			x: 0,
			y: 0,
			width: 30,
			height: 30,
		} );

		pressMagnetic( zoomed.options, zoomed.gesture, { x: 30, y: 30 }, CLICK );
		moveMagnetic( zoomed.options, zoomed.gesture, { x: 30, y: 90 } );

		// 60 document pixels away: out of reach at 1:1, comfortably inside the same
		// setting at 1:4.
		expect( zoomed.preview()!.points.length ).toBeGreaterThan( 2 );
	} );

	it( 'traces a photograph, not a diagram', () => {
		// Everything a hard-edged square does not have: a curve, a soft anti-aliased
		// boundary, grain over the whole frame, a graduated background, and texture
		// inside the subject strong enough to be an edge in its own right. And a pointer
		// that never once touches the boundary -- it circles six pixels outside it,
		// wobbling by another four either way.
		const h = harness( photograph() );
		const { cx, cy, rx, ry } = ELLIPSE;
		const at = ( turn: number, off: number ) => ( {
			x: cx + Math.cos( turn ) * ( rx + off ),
			y: cy + Math.sin( turn ) * ( ry + off ),
		} );

		pressMagnetic( h.options, h.gesture, at( 0, 0 ), CLICK );

		for ( let i = 1; i <= 140; i++ ) {
			moveMagnetic(
				h.options,
				h.gesture,
				at( ( i / 140 ) * Math.PI * 1.97, 6 + Math.sin( i * 0.7 ) * 4 )
			);
		}

		const points = closeSelection( h )!.points;
		const off = points
			.map( ( p ) =>
				Math.abs(
					Math.hypot( p.x * 240 - cx, ( ( p.y * 240 - cy ) * rx ) / ry ) - rx
				)
			)
			.sort( ( a, b ) => a - b );

		// Half the vertices land within a pixel of the true boundary, and none of them
		// is more than three off it -- from a pointer that was never nearer than six.
		expect( off[ off.length >> 1 ] ).toBeLessThan( 1 );
		expect( off[ off.length - 1 ] ).toBeLessThan( 3 );
	} );

	it( 'marks its anchors, and says which ones a click put there', () => {
		const h = harness();

		pressMagnetic( h.options, h.gesture, { x: 30, y: 30 }, CLICK );

		// The first anchor is one somebody clicked, by definition.
		expect( h.anchors() ).toHaveLength( 1 );
		expect( h.anchors()[ 0 ].manual ).toBe( true );

		traceSquare( h, 4 );

		const marks = h.anchors();
		const manual = marks.filter( ( anchor ) => anchor.manual );

		// Everything the trace pinned for itself is reported as automatic.
		expect( marks.length ).toBeGreaterThan( manual.length );
		expect( manual ).toHaveLength( 1 );

		// Marked where they actually are: on the boundary of the square, in normalised
		// coordinates, not under the pointer four pixels outside it.
		for ( const anchor of marks ) {
			const x = anchor.point.x * 120;
			const y = anchor.point.y * 120;

			expect(
				Math.abs( x - 30 ) < 2 ||
					Math.abs( x - 90 ) < 2 ||
					Math.abs( y - 30 ) < 2 ||
					Math.abs( y - 90 ) < 2
			).toBe( true );
		}
	} );

	it( 'marks an anchor a click asked for as manual', () => {
		const h = harness();

		traceSquare( h, 4 );

		const before = h.anchors().filter( ( anchor ) => anchor.manual ).length;

		pressMagnetic( h.options, h.gesture, { x: 89, y: 60 }, CLICK );

		expect( h.anchors().filter( ( anchor ) => anchor.manual ) ).toHaveLength(
			before + 1
		);
	} );

	it( 'takes its marks down when the trace ends', () => {
		const h = harness();

		traceSquare( h, 4 );
		expect( h.anchors().length ).toBeGreaterThan( 1 );

		closeMagnetic( h.options, h.gesture );

		expect( h.anchors() ).toHaveLength( 0 );
	} );

	it( 'lets go of the edge field when it is done', () => {
		const h = harness();

		traceSquare( h, 4 );
		closeMagnetic( h.options, h.gesture );

		expect( h.gesture.magnetic.isTracing ).toBe( false );
		expect( h.gesture.magnetic.outline() ).toBeNull();
		expect( h.gesture.magnetic.close() ).toBeNull();
	} );
} );

/**
 * Closes a trace and hands back what it committed.
 *
 * @param h The stage.
 */
function closeSelection( h: Harness ): Selection | null {
	closeMagnetic( h.options, h.gesture );

	return h.committed();
}
