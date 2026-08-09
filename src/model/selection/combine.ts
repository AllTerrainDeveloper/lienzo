/**
 * Two selections into one.
 *
 * Adding, subtracting and intersecting are set operations on *regions*, and the editor
 * stores regions as closed paths -- so the honest implementation is a path clipper, and
 * a path clipper is several hundred lines of numerically delicate geometry that has to
 * agree with the rasteriser about every edge case it gets wrong.
 *
 * There is already a round trip that does not: `buildSelectionMask()` turns a path into
 * pixels and `traceMask()` turns pixels back into paths, and the tracer walks the
 * lattice of pixel *corners*, so the outline it produces encloses exactly the pixels
 * that were set. Compositing two masks with `globalCompositeOperation` is then the whole
 * of the boolean algebra -- three keywords the browser has implemented for twenty years
 * -- and the result comes back in the one format the outline renderer, the mask
 * rasteriser and the brush clipper already speak.
 *
 * The cost is that it runs once per completed gesture, not once per pointer move, and it
 * is bounded: the working raster is capped, because nobody can see a boundary at a finer
 * resolution than the four hundred vertices the tracer keeps anyway.
 */

import { isEmptySelection } from './bounds';
import { buildSelectionMask } from './mask';
import { traceMask } from './trace';
import type { Selection, SelectionMode } from './types';

/**
 * Pixels the boolean raster may cost, however large the document is.
 *
 * Four megapixels is a 2000-square working canvas: far more than the traced outline can
 * carry, and a readback that finishes inside a frame. Uncapped, one intersection on a
 * fifty-megapixel scan would allocate two hundred megabytes to answer a question whose
 * answer is four hundred points long.
 */
const MAX_COMBINE_PIXELS = 4_000_000;

/**
 * Vertices the combined outline keeps.
 *
 * More than a wand selection gets, because a union genuinely has more boundary: two
 * shapes joined at a corner have every vertex both of them had.
 */
const MAX_COMBINE_POINTS = 600;

/** Which composite operation performs each boolean, with the base drawn first. */
const OPERATIONS: Record<
	Exclude< SelectionMode, 'new' >,
	GlobalCompositeOperation
> = {
	add: 'source-over',
	subtract: 'destination-out',
	intersect: 'source-in',
};

/**
 * Folds a newly drawn region into the selection that is already there.
 *
 * @param base      Selection in place, or null when nothing is selected.
 * @param incoming  Region just drawn, or null when the gesture produced nothing.
 * @param mode      What the new region does to the old one.
 * @param canvas    Canvas size the selections are expressed against.
 * @return The combined selection, or null when the result covers nothing.
 */
export function combineSelections(
	base: Selection | null,
	incoming: Selection | null,
	mode: SelectionMode,
	canvas: { width: number; height: number }
): Selection | null {
	const from = isEmptySelection( base ) ? null : base;
	const next = isEmptySelection( incoming ) ? null : incoming;

	if ( 'new' === mode ) {
		return next;
	}

	// Nothing to combine with: adding is drawing, and taking a share of nothing --
	// whether by subtraction or by intersection -- leaves nothing.
	if ( ! from ) {
		return 'add' === mode ? next : null;
	}

	if ( ! next ) {
		// A gesture that drew nothing must not destroy what was already selected, and
		// that includes an intersection: an accidental click is not an instruction to
		// deselect everything.
		return from;
	}

	return traceCombined( from, next, mode, canvas );
}

/**
 * Rasterises both selections, composites them, and traces the result back.
 *
 * @param base     Selection in place.
 * @param incoming Region just drawn.
 * @param mode     Boolean to perform.
 * @param canvas   Canvas size the selections are expressed against.
 * @return The combined selection, or a graceful fallback when no canvas is available.
 */
function traceCombined(
	base: Selection,
	incoming: Selection,
	mode: Exclude< SelectionMode, 'new' >,
	canvas: { width: number; height: number }
): Selection | null {
	const size = workingSize( canvas );
	const baseMask = buildSelectionMask( base, size.width, size.height );
	const nextMask = buildSelectionMask( incoming, size.width, size.height );
	const surface = document.createElement( 'canvas' );

	surface.width = size.width;
	surface.height = size.height;

	const ctx = surface.getContext( '2d', { willReadFrequently: true } );

	if ( ! baseMask || ! nextMask || ! ctx ) {
		// No 2D backend -- a headless test, or a context the browser refused. Falling
		// back to the base leaves the user's selection intact, which is the only answer
		// here that cannot lose work.
		return base;
	}

	ctx.drawImage( baseMask, 0, 0 );
	ctx.globalCompositeOperation = OPERATIONS[ mode ];
	ctx.drawImage( nextMask, 0, 0 );

	const pixels = ctx.getImageData( 0, 0, size.width, size.height );
	const traced = traceMask(
		{ data: pixels.data, width: size.width, height: size.height },
		MAX_COMBINE_POINTS
	);

	if ( traced.outer.length < 3 ) {
		return null;
	}

	// Always a path, whatever the two inputs were: the union of two rectangles is not a
	// rectangle, and storing it as one would put its corners back.
	//
	// Disjoint results survive as extra contours. `traceMask` calls everything after the
	// first a hole, but both rasterisers fill even-odd, so a loop that lies outside the
	// first one is filled rather than punched -- which is exactly right for two regions
	// added without touching.
	return { shape: 'lasso', points: traced.outer, holes: traced.holes };
}

/**
 * The raster size to do the arithmetic at.
 *
 * The canvas's own size where that is affordable, scaled down by area where it is not.
 * Selections are normalised, so the result is expressed the same way whichever size was
 * used -- only the precision of the boundary changes, and the tracer's vertex budget
 * costs more of that than the scaling does.
 *
 * @param canvas Canvas size.
 */
function workingSize( canvas: { width: number; height: number } ): {
	width: number;
	height: number;
} {
	const width = Math.max( 1, Math.round( canvas.width ) );
	const height = Math.max( 1, Math.round( canvas.height ) );
	const scale = Math.sqrt( MAX_COMBINE_PIXELS / ( width * height ) );

	if ( scale >= 1 ) {
		return { width, height };
	}

	return {
		width: Math.max( 1, Math.round( width * scale ) ),
		height: Math.max( 1, Math.round( height * scale ) ),
	};
}
