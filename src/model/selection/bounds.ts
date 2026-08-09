/**
 * The rectangle a selection occupies.
 */

import type { Selection } from './types';

/**
 * Whether a selection covers no meaningful area.
 *
 * @param selection Selection to test, or null.
 */
export function isEmptySelection( selection: Selection | null ): boolean {
	if ( ! selection || selection.points.length < 2 ) {
		return true;
	}

	const bounds = selectionBounds( selection );

	return bounds.w < 0.002 || bounds.h < 0.002;
}

/**
 * The axis-aligned bounding box, in normalised coordinates.
 *
 * Every contour counts, not only the outer one. On a hand-drawn selection that changes
 * nothing -- a hole is inside the outline that contains it, by definition. On one the
 * boolean combiner produced it is the whole answer: two regions added without touching
 * come back as two separate loops, and measuring only the first would crop the copy to
 * whichever of them the tracer happened to reach first.
 *
 * @param selection Selection to measure.
 */
export function selectionBounds( selection: Selection ): {
	x: number;
	y: number;
	w: number;
	h: number;
} {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for ( const contour of [ selection.points, ...( selection.holes ?? [] ) ] ) {
		for ( const point of contour ) {
			minX = Math.min( minX, point.x );
			minY = Math.min( minY, point.y );
			maxX = Math.max( maxX, point.x );
			maxY = Math.max( maxY, point.y );
		}
	}

	if ( ! Number.isFinite( minX ) ) {
		return { x: 0, y: 0, w: 0, h: 0 };
	}

	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
