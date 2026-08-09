/**
 * Pixels back to an outline.
 *
 * The other direction from `buildSelectionMask()`, and what the magic wand needs: it
 * finds a region by colour and has to hand back something the marquee can draw.
 *
 * Every boundary is traced, not only the outer one. A wand over a leaf selects the
 * leaf and *not* the sky showing through the holes in it, which is what anyone who has
 * used the tool elsewhere expects. That does not cost a second selection model: the
 * contours are all closed paths in the one format the editor already speaks, and the
 * rasteriser fills them even-odd, so an inner loop punches a hole and a loop inside
 * *that* fills again, to any depth.
 */

import { thinPath } from './path';
import type { Point } from './types';

/** A mask the tracer can read. */
export interface TraceableMask {
	/**
	 * Samples.
	 *
	 * Either RGBA bytes -- an `ImageData` -- or one byte per pixel, as the flood fill
	 * produces. Which one is inferred from the length, and in both cases the *last*
	 * byte of a sample is the one that decides: alpha for RGBA, the byte itself
	 * otherwise.
	 */
	data: Uint8Array | Uint8ClampedArray;
	width: number;
	height: number;
	/** Limits the scan, when the region's extent is already known. */
	bounds?: { x: number; y: number; width: number; height: number };
}

/** Every closed boundary of a region. */
export interface TracedRegion {
	/** The outer boundary. Empty when the mask holds nothing. */
	outer: Point[];
	/** Inner boundaries: holes, and any islands inside them. */
	holes: Point[][];
}

/**
 * Holes to keep.
 *
 * A wand over foliage or film grain finds thousands of one-pixel gaps, and past a
 * point each is a vertex spent on something nobody can see. The largest are kept,
 * which is also the order anyone would pick them by eye. The outer contour is never
 * one of the ones dropped.
 */
const MAX_HOLES = 63;

/** Smallest hole worth a vertex, in pixels. Below this it is film grain. */
const MIN_HOLE_AREA = 4;

/**
 * Boundary loops to walk at all.
 *
 * The ranking above needs every candidate traced before it can choose, so this is the
 * backstop that keeps a pathological mask -- a checkerboard, which is all boundary --
 * from costing more than the tool that asked for it.
 */
const MAX_LOOPS = 4096;

/** Directions along the corner lattice, in clockwise order on a y-down canvas. */
const STEP = [
	[ 1, 0 ],
	[ 0, 1 ],
	[ -1, 0 ],
	[ 0, -1 ],
];

/**
 * Traces every boundary of a mask into closed paths.
 *
 * The walk is on the lattice of pixel *corners*, not on the pixels themselves, so the
 * path it produces encloses exactly the pixels that are set -- rasterising it back
 * reproduces the region rather than a version of it eroded by half a pixel. It follows
 * each boundary with the filled side always on its right, which closes a loop around
 * the region and a loop around each hole without needing to know in advance which is
 * which.
 *
 * Where two filled pixels meet only at a corner the walk turns rather than crossing,
 * keeping them apart. That matches the flood fill, which spreads through edges and not
 * through corners; letting the outline cross there would select a diagonal neighbour
 * the fill itself refused.
 *
 * @param mask      Mask to trace.
 * @param maxPoints Vertices to keep, shared across every contour by length.
 * @return The outer boundary and any inner ones.
 */
export function traceMask( mask: TraceableMask, maxPoints = 400 ): TracedRegion {
	const { width, height, data } = mask;

	if ( width < 1 || height < 1 ) {
		return { outer: [], holes: [] };
	}

	const stride = data.length >= width * height * 4 ? 4 : 1;
	const last = stride - 1;
	const filled = ( x: number, y: number ): boolean =>
		x >= 0 &&
		y >= 0 &&
		x < width &&
		y < height &&
		data[ ( y * width + x ) * stride + last ] > 127;

	const contours = walkContours( filled, width, height, mask.bounds );

	if ( contours.length === 0 ) {
		return { outer: [], holes: [] };
	}

	const budgets = shareBudget( contours, maxPoints );
	const paths = contours.map( ( contour, index ) =>
		thinPath( contour, budgets[ index ], width, height )
	);

	return { outer: paths[ 0 ], holes: paths.slice( 1 ) };
}

/**
 * Walks every boundary loop in the mask.
 *
 * Row-major scanning is what makes the first loop the outer one: the topmost, then
 * leftmost, boundary corner of a region cannot belong to a hole.
 *
 * @param filled Whether a pixel is set.
 * @param width  Mask width in pixels.
 * @param height Mask height in pixels.
 * @param bounds Region extent, when known, to keep the scan off the empty part.
 * @return Contours in pixel-corner coordinates, outer first.
 */
function walkContours(
	filled: ( x: number, y: number ) => boolean,
	width: number,
	height: number,
	bounds?: { x: number; y: number; width: number; height: number }
): Point[][] {
	const cols = width + 1;
	const visited = new Uint8Array( cols * ( height + 1 ) );
	const contours: Point[][] = [];

	const fromX = Math.max( 0, bounds ? bounds.x : 0 );
	const fromY = Math.max( 0, bounds ? bounds.y : 0 );
	const toX = Math.min( width, bounds ? bounds.x + bounds.width : width );
	const toY = Math.min( height, bounds ? bounds.y + bounds.height : height );

	/**
	 * Whether a boundary leaves a corner in a direction, with the region on its right.
	 *
	 * @param x         Corner column.
	 * @param y         Corner row.
	 * @param direction Index into `STEP`.
	 */
	const leaves = ( x: number, y: number, direction: number ): boolean => {
		switch ( direction ) {
			case 0:
				return filled( x, y ) && ! filled( x, y - 1 );
			case 1:
				return filled( x - 1, y ) && ! filled( x, y );
			case 2:
				return filled( x - 1, y - 1 ) && ! filled( x - 1, y );
			default:
				return filled( x, y - 1 ) && ! filled( x - 1, y - 1 );
		}
	};

	for ( let y = fromY; y <= toY && contours.length < MAX_LOOPS; y++ ) {
		for ( let x = fromX; x <= toX && contours.length < MAX_LOOPS; x++ ) {
			const corner = y * cols + x;

			// Every direction, not the first one that works: where two parts of the
			// region touch diagonally, one corner carries edges of two different loops.
			for ( let d = 0; d < 4; d++ ) {
				if ( visited[ corner ] & ( 1 << d ) || ! leaves( x, y, d ) ) {
					continue;
				}

				contours.push( walkLoop( x, y, d, leaves, visited, cols, width, height ) );
			}
		}
	}

	return rank( contours );
}

/**
 * Keeps the outer contour and the holes worth drawing.
 *
 * The outer contour is whichever loop was found first -- row-major scanning guarantees
 * the topmost, then leftmost, boundary corner belongs to it -- and is never dropped,
 * however small the region is.
 *
 * @param contours Every loop that was walked, outer first.
 * @return The outer contour followed by the holes to keep, largest first.
 */
function rank( contours: Point[][] ): Point[][] {
	if ( contours.length < 2 ) {
		return contours;
	}

	const holes = contours
		.slice( 1 )
		.map( ( contour ) => ( { contour, area: contourArea( contour ) } ) )
		.filter( ( hole ) => hole.area >= MIN_HOLE_AREA )
		.sort( ( a, b ) => b.area - a.area )
		.slice( 0, MAX_HOLES )
		.map( ( hole ) => hole.contour );

	return [ contours[ 0 ], ...holes ];
}

/**
 * The area a closed contour encloses, in pixels.
 *
 * Unsigned: a hole is wound the other way from the boundary that contains it, and how
 * big it is does not depend on which.
 *
 * @param contour Closed contour in corner coordinates.
 */
function contourArea( contour: Point[] ): number {
	let sum = 0;

	for ( let i = 0; i < contour.length; i++ ) {
		const a = contour[ i ];
		const b = contour[ ( i + 1 ) % contour.length ];

		sum += a.x * b.y - b.x * a.y;
	}

	return Math.abs( sum ) / 2;
}

/**
 * Follows one boundary back to where it started.
 *
 * Only the corners where the boundary turns are recorded. A straight edge a thousand
 * pixels long is two vertices, which is both the whole shape of it and all the
 * thinning budget it should ever consume.
 *
 * @param startX  Corner column to start from.
 * @param startY  Corner row to start from.
 * @param startD  Direction to leave in.
 * @param leaves  Whether a boundary leaves a corner in a direction.
 * @param visited Directed edges already walked, one bit per direction.
 * @param cols    Corners per row.
 * @param width   Mask width in pixels.
 * @param height  Mask height in pixels.
 * @return The loop's turning points, in corner coordinates.
 */
function walkLoop(
	startX: number,
	startY: number,
	startD: number,
	leaves: ( x: number, y: number, direction: number ) => boolean,
	visited: Uint8Array,
	cols: number,
	width: number,
	height: number
): Point[] {
	const points: Point[] = [];
	// A directed edge is walked at most once, and there are four per corner.
	const limit = ( width + 1 ) * ( height + 1 ) * 4;

	let x = startX;
	let y = startY;
	let d = startD;
	let lastD = -1;

	for ( let step = 0; step < limit; step++ ) {
		visited[ y * cols + x ] |= 1 << d;

		if ( d !== lastD ) {
			points.push( { x, y } );
			lastD = d;
		}

		x += STEP[ d ][ 0 ];
		y += STEP[ d ][ 1 ];

		// Turning right before going straight is what keeps two pixels that meet only
		// at a corner apart, rather than merging them into one region.
		let next = -1;

		for ( const candidate of [ ( d + 1 ) % 4, d, ( d + 3 ) % 4 ] ) {
			if ( leaves( x, y, candidate ) ) {
				next = candidate;
				break;
			}
		}

		if ( next < 0 ) {
			break;
		}

		d = next;

		// Closing on the corner alone is not enough: a boundary can pass through the
		// same corner twice where two parts of the region touch diagonally, and
		// stopping there would truncate the loop. The edge is what identifies it.
		if ( x === startX && y === startY && d === startD ) {
			break;
		}
	}

	// The first corner is only a corner if the loop arrived travelling some other way.
	if ( points.length > 2 && lastD === startD ) {
		points.shift();
	}

	return points;
}

/**
 * Divides a vertex budget between contours by length.
 *
 * The outer boundary is never starved: it gets at least half, however many holes the
 * mask turned out to have. Everything left is shared out in proportion, so one large
 * hole is drawn properly and forty specks get four vertices each.
 *
 * @param contours  Traced contours, outer first.
 * @param maxPoints Total vertices to spend.
 * @return One budget per contour.
 */
function shareBudget( contours: Point[][], maxPoints: number ): number[] {
	const budget = Math.max( 3, maxPoints );

	if ( contours.length === 1 ) {
		return [ budget ];
	}

	const outer = Math.max( 4, Math.round( budget / 2 ) );
	const holes = contours.slice( 1 );
	const total = holes.reduce( ( sum, hole ) => sum + hole.length, 0 ) || 1;
	const spare = budget - outer;

	// Four vertices apiece at the least: a contour thinned below that stops being a
	// shape, and a hole that encloses nothing cuts nothing out.
	return [
		outer,
		...holes.map( ( hole ) =>
			Math.max( 4, Math.round( ( spare * hole.length ) / total ) )
		),
	];
}
