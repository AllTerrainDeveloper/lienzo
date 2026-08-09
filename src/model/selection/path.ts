/**
 * Selections as SVG paths, and the drags that build them.
 *
 * One path for every shape, because a lasso is not a rectangle -- and once the outline
 * has to be a path anyway, one routine draws all four.
 */

import { selectionBounds } from './bounds';
import { MAX_LASSO_POINTS } from './types';
import type { Point, Selection, SelectionAnchor } from './types';

/**
 * Builds the selection's outline as an SVG path.
 *
 * Rendered as SVG rather than as a positioned `<div>` because a lasso is not a
 * rectangle and never was -- and once the outline has to be a path anyway, the same
 * code draws every shape.
 *
 * @param selection Selection to draw.
 * @param width     Viewport width in CSS pixels.
 * @param height    Viewport height in CSS pixels.
 */
export function selectionToPath(
	selection: Selection,
	width: number,
	height: number
): string {
	const at = ( point: Point ) => `${ point.x * width } ${ point.y * height }`;

	if ( selection.shape === 'rect' || selection.shape === 'ellipse' ) {
		const b = selectionBounds( selection );
		const x = b.x * width;
		const y = b.y * height;
		const w = b.w * width;
		const h = b.h * height;

		if ( selection.shape === 'rect' ) {
			return `M ${ x } ${ y } H ${ x + w } V ${ y + h } H ${ x } Z`;
		}

		const rx = w / 2;
		const ry = h / 2;

		// Two arcs, because a single arc command cannot close a full ellipse.
		return (
			`M ${ x } ${ y + ry } ` +
			`a ${ rx } ${ ry } 0 1 0 ${ w } 0 ` +
			`a ${ rx } ${ ry } 0 1 0 ${ -w } 0 Z`
		);
	}

	if ( selection.points.length < 2 ) {
		return '';
	}

	/**
	 * One closed subpath.
	 *
	 * @param points Vertices.
	 */
	const contour = ( points: Point[] ) =>
		`M ${ at( points[ 0 ] ) } ` +
		points
			.slice( 1 )
			.map( ( point ) => `L ${ at( point ) }` )
			.join( ' ' ) +
		' Z';

	// The holes are drawn too. Marching ants around the outline of a wand selection
	// with nothing around its holes would claim they are selected, and the ants are
	// the only thing on screen saying what is.
	return [ selection.points, ...( selection.holes ?? [] ) ]
		.filter( ( points ) => points.length > 1 )
		.map( contour )
		.join( ' ' );
}

/**
 * Reduces a pixel contour to a normalised path of at most `maxPoints` vertices.
 *
 * @param contour   Pixel vertices.
 * @param maxPoints Ceiling.
 * @param width     Canvas width.
 * @param height    Canvas height.
 */
export function thinPath(
	contour: Point[],
	maxPoints: number,
	width: number,
	height: number
): Point[] {
	const stride = Math.max( 1, Math.ceil( contour.length / Math.max( 3, maxPoints ) ) );
	const out: Point[] = [];

	for ( let i = 0; i < contour.length; i += stride ) {
		out.push( {
			x: contour[ i ].x / width,
			y: contour[ i ].y / height,
		} );
	}

	return out;
}

/**
 * Builds the anchor marks of a trace as one SVG path.
 *
 * One path holding every square rather than an element each, for the same reason the
 * outline is one path: the count changes on almost every pointer move, and a renderer
 * that has to add and remove twenty nodes a second is a renderer that will eventually
 * leave one behind. Setting a `d` attribute cannot.
 *
 * @param anchors Anchors to mark.
 * @param width   Viewport width in CSS pixels.
 * @param height  Viewport height in CSS pixels.
 * @param size    Length of each square's side, in CSS pixels.
 */
export function anchorMarks(
	anchors: SelectionAnchor[],
	width: number,
	height: number,
	size: number
): string {
	const half = size / 2;

	return anchors
		.map( ( anchor ) => {
			const x = anchor.point.x * width - half;
			const y = anchor.point.y * height - half;

			return `M ${ x } ${ y } h ${ size } v ${ size } h ${ -size } Z`;
		} )
		.join( ' ' );
}

/**
 * Drops the vertices of a path that were already implied by its neighbours.
 *
 * Ramer, Douglas and Peucker: keep the two ends, keep whichever point in between lies
 * furthest from the line joining them, and recur on the two halves -- but only where
 * that furthest point is further out than the tolerance allows.
 *
 * A traced path needs this in a way a hand-drawn one does not. A lasso is thinned as it
 * is drawn, by distance, because a pointer emits far more samples than an outline needs.
 * A path that came off a *pixel grid* has the opposite problem: every vertex is exactly
 * one pixel from the last, so a straight run of two hundred pixels arrives as two
 * hundred vertices, and dropping every third one to fit a budget would take the corners
 * with it. Simplifying by distance-from-the-line keeps the corners -- which are the only
 * part anyone can see -- and spends nothing on the straights.
 *
 * Iterative rather than recursive: these paths are thousands of points long, and the
 * worst case for the recursion is one frame per vertex.
 *
 * @param points    Path.
 * @param tolerance How far a dropped vertex may lie from the line that replaces it.
 */
export function simplifyPath( points: Point[], tolerance: number ): Point[] {
	if ( points.length < 3 || tolerance <= 0 ) {
		return points;
	}

	const keep = new Uint8Array( points.length );
	const stack: Array< [ number, number ] > = [ [ 0, points.length - 1 ] ];
	const limit = tolerance * tolerance;

	keep[ 0 ] = 1;
	keep[ points.length - 1 ] = 1;

	while ( stack.length > 0 ) {
		const [ first, last ] = stack.pop() as [ number, number ];

		let worst = -1;
		let at = -1;

		for ( let i = first + 1; i < last; i++ ) {
			const distance = squaredDistanceToSegment(
				points[ i ],
				points[ first ],
				points[ last ]
			);

			if ( distance > worst ) {
				worst = distance;
				at = i;
			}
		}

		if ( at < 0 || worst <= limit ) {
			continue;
		}

		keep[ at ] = 1;
		stack.push( [ first, at ], [ at, last ] );
	}

	return points.filter( ( _, i ) => 1 === keep[ i ] );
}

/**
 * How far a point lies from a segment, squared.
 *
 * Squared throughout, so the whole simplification runs without a square root.
 *
 * @param point Point to measure.
 * @param from  Start of the segment.
 * @param to    End of the segment.
 */
function squaredDistanceToSegment( point: Point, from: Point, to: Point ): number {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = dx * dx + dy * dy;

	// A zero-length segment is a point, and the distance to it is the distance to either
	// end. This happens whenever a closed path is simplified in one call.
	const t =
		0 === length
			? 0
			: Math.max(
					0,
					Math.min(
						1,
						( ( point.x - from.x ) * dx + ( point.y - from.y ) * dy ) / length
					)
			  );

	const ox = point.x - ( from.x + t * dx );
	const oy = point.y - ( from.y + t * dy );

	return ox * ox + oy * oy;
}

/**
 * Builds a rectangle or ellipse selection from two dragged corners.
 *
 * @param shape Which shape.
 * @param from  First corner.
 * @param to    Second corner.
 */
export function selectionFromDrag(
	shape: 'rect' | 'ellipse',
	from: Point,
	to: Point
): Selection {
	return {
		shape,
		points: [
			{ x: clamp01( Math.min( from.x, to.x ) ), y: clamp01( Math.min( from.y, to.y ) ) },
			{ x: clamp01( Math.max( from.x, to.x ) ), y: clamp01( Math.max( from.y, to.y ) ) },
		],
	};
}

/**
 * Adds a point to a freeform path, thinning as it goes.
 *
 * A pointer emits far more samples than an outline needs. Dropping points that
 * barely moved keeps the path short enough to rasterise instantly, and makes no
 * visible difference to the shape.
 *
 * @param points  Path so far.
 * @param point   New point.
 * @param minStep Smallest movement worth recording, in normalised units.
 */
export function appendPathPoint(
	points: Point[],
	point: Point,
	minStep = 0.004
): Point[] {
	const last = points[ points.length - 1 ];

	if (
		last &&
		Math.abs( last.x - point.x ) < minStep &&
		Math.abs( last.y - point.y ) < minStep
	) {
		return points;
	}

	const next = [ ...points, { x: clamp01( point.x ), y: clamp01( point.y ) } ];

	// A pathological drag should not be allowed to grow without bound.
	return next.length > MAX_LASSO_POINTS
		? next.slice( next.length - MAX_LASSO_POINTS )
		: next;
}

/**
 * Clamps a value into 0..1.
 *
 * @param value Value to clamp.
 */
function clamp01( value: number ): number {
	return Math.min( 1, Math.max( 0, value ) );
}
