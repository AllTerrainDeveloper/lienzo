/**
 * Finding the contiguous region that matches a colour.
 *
 * The paint bucket and the magic wand are the same search, and on a twenty-megapixel
 * photograph the search is the whole cost of the tool -- so what it does *per pixel*
 * decides whether the tool feels instant or takes a few seconds.
 *
 * Three things make it instant:
 *
 * - **Spans, not pixels.** The stack carries runs of matching pixels, one entry per
 *   row a run spreads into, rather than one entry per pixel. An earlier version
 *   pushed both vertical neighbours of every filled pixel, so filling a whole photo
 *   queued forty million coordinates through a JavaScript array -- hundreds of
 *   megabytes of boxed numbers, and the garbage collector paid for all of it.
 * - **One byte of state per pixel, tested at most once.** Matching is memoised as it
 *   is discovered rather than precomputed, so a fill covering ten pixels costs ten
 *   comparisons instead of twenty million.
 * - **The bounding box travels with the region.** Nearly every caller then works over
 *   the pixels the fill actually reached: the mask is rasterised at that size, the
 *   texture uploaded to the GPU is that size, and undo records that rectangle rather
 *   than the whole document.
 */

/** State byte: matches the seed colour and is not yet part of the region. */
const MATCH = 1;

/** State byte: tested, and a different colour. */
const MISS = 2;

/**
 * State byte: part of the region.
 *
 * 255 rather than 3 so the state array is also a perfectly ordinary 8-bit alpha mask:
 * the contour tracer reads "the last byte of each sample, at or above half" and that
 * one rule then covers both this and an RGBA `ImageData`.
 */
const INSIDE = 255;

/** A rectangle in pixels. */
export interface RegionBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * A contiguous matched region.
 *
 * One byte per pixel rather than RGBA, because every consumer asks the same yes/no
 * question of it and a four-channel copy of a twenty-megapixel document is eighty
 * megabytes to allocate before anything has been drawn.
 */
export interface FloodRegion {
	/** `INSIDE` where the region is, indexed `y * width + x`. */
	state: Uint8Array;
	width: number;
	height: number;
	/** The pixels the fill actually reached. */
	bounds: RegionBounds;
	/** How many pixels are in the region. */
	count: number;
}

/**
 * Finds the contiguous region matching the colour at a point.
 *
 * @param pixels    Source RGBA bytes.
 * @param width     Source width.
 * @param height    Source height.
 * @param startX    Seed point.
 * @param startY    Seed point.
 * @param tolerance 0..255 per-channel distance treated as the same colour.
 * @return The region, or null when the seed is off the canvas.
 */
export function floodFillRegion(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
	startX: number,
	startY: number,
	tolerance: number
): FloodRegion | null {
	const x0 = Math.round( startX );
	const y0 = Math.round( startY );

	if ( width < 1 || height < 1 || x0 < 0 || y0 < 0 || x0 >= width || y0 >= height ) {
		return null;
	}

	const state = new Uint8Array( width * height );
	const seed = ( y0 * width + x0 ) * 4;
	const target0 = pixels[ seed ];
	const target1 = pixels[ seed + 1 ];
	const target2 = pixels[ seed + 2 ];
	const target3 = pixels[ seed + 3 ];
	const tol = Math.max( 0, Math.min( 255, Math.round( tolerance ) ) );

	let count = 0;
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;

	/**
	 * Whether a pixel matches and has not been claimed yet.
	 *
	 * The answer is written back into `state`, so a pixel is compared against the seed
	 * colour once however many times a span walk arrives at it.
	 *
	 * @param index Pixel index, `y * width + x`.
	 */
	const open = ( index: number ): boolean => {
		const known = state[ index ];

		if ( known !== 0 ) {
			return known === MATCH;
		}

		const p = index * 4;
		const matches =
			( pixels[ p ] - target0 <= tol && target0 - pixels[ p ] <= tol ) &&
			( pixels[ p + 1 ] - target1 <= tol && target1 - pixels[ p + 1 ] <= tol ) &&
			( pixels[ p + 2 ] - target2 <= tol && target2 - pixels[ p + 2 ] <= tol ) &&
			( pixels[ p + 3 ] - target3 <= tol && target3 - pixels[ p + 3 ] <= tol );

		state[ index ] = matches ? MATCH : MISS;

		return matches;
	};

	/**
	 * Claims a pixel for the region.
	 *
	 * @param index Pixel index.
	 * @param x     Column, tracked for the bounding box.
	 * @param y     Row, tracked for the bounding box.
	 */
	const claim = ( index: number, x: number, y: number ): void => {
		state[ index ] = INSIDE;
		count++;

		if ( x < minX ) {
			minX = x;
		}

		if ( x > maxX ) {
			maxX = x;
		}

		if ( y < minY ) {
			minY = y;
		}

		if ( y > maxY ) {
			maxY = y;
		}
	};

	// Each entry is a run to examine on one row: first column, last column, the row,
	// and which way the fill was travelling when it got there. Four numbers rather
	// than an object, because a pathological mask pushes a great many of them.
	const stack: number[] = [ x0, x0, y0, 1, x0, x0, y0 - 1, -1 ];

	while ( stack.length > 0 ) {
		const dy = stack.pop()!;
		const y = stack.pop()!;
		let x2 = stack.pop()!;
		let x1 = stack.pop()!;

		if ( y < 0 || y >= height ) {
			continue;
		}

		const row = y * width;
		let x = x1;

		if ( open( row + x ) ) {
			// Walk left off the end of the seeding run, then report the overhang back
			// to the row we came from -- that is the part the previous row never saw.
			while ( x > 0 && open( row + x - 1 ) ) {
				claim( row + x - 1, x - 1, y );
				x--;
			}

			if ( x < x1 ) {
				stack.push( x, x1 - 1, y - dy, -dy );
			}
		}

		while ( x1 <= x2 ) {
			while ( x1 < width && open( row + x1 ) ) {
				claim( row + x1, x1, y );
				x1++;
			}

			if ( x1 > x ) {
				stack.push( x, x1 - 1, y + dy, dy );
			}

			if ( x1 - 1 > x2 ) {
				stack.push( x2 + 1, x1 - 1, y - dy, -dy );
			}

			x1++;

			while ( x1 <= x2 && ! open( row + x1 ) ) {
				x1++;
			}

			x = x1;
		}
	}

	if ( count === 0 ) {
		return null;
	}

	return {
		state,
		width,
		height,
		bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
		count,
	};
}

/**
 * Rasterises a region into a canvas covering only the pixels it reached.
 *
 * Deliberately not canvas-sized. A fill of a small object on a large photograph would
 * otherwise allocate the whole document twice -- once as `ImageData`, once as the GPU
 * texture it is uploaded into -- to carry a few thousand opaque pixels. Callers place
 * it with `region.bounds`.
 *
 * @param region Region to draw.
 * @return An opaque-white-on-transparent bitmap, or null without a 2D context.
 */
export function regionToCanvas( region: FloodRegion ): HTMLCanvasElement | null {
	const { bounds, state, width } = region;
	const canvas = document.createElement( 'canvas' );

	canvas.width = bounds.width;
	canvas.height = bounds.height;

	const ctx = canvas.getContext( '2d' );

	if ( ! ctx ) {
		return null;
	}

	const image = ctx.createImageData( bounds.width, bounds.height );
	// One 32-bit write per pixel instead of four 8-bit ones. Endianness is irrelevant:
	// every channel of the value written is 0xff.
	const words = new Uint32Array( image.data.buffer );

	for ( let y = 0; y < bounds.height; y++ ) {
		const from = ( bounds.y + y ) * width + bounds.x;
		const to = y * bounds.width;

		for ( let x = 0; x < bounds.width; x++ ) {
			if ( state[ from + x ] === INSIDE ) {
				words[ to + x ] = 0xffffffff;
			}
		}
	}

	ctx.putImageData( image, 0, 0 );

	return canvas;
}

/**
 * Builds a mask of the contiguous region matching the colour at a point.
 *
 * The region and its bitmap in one call, for callers that want both. The bitmap covers
 * `bounds`, not the whole canvas.
 *
 * @param pixels    Source RGBA bytes.
 * @param width     Source width.
 * @param height    Source height.
 * @param startX    Seed point.
 * @param startY    Seed point.
 * @param tolerance 0..255 per-channel distance treated as the same colour.
 * @return The region and its bitmap, or null for an empty fill.
 */
export function floodFillMask(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
	startX: number,
	startY: number,
	tolerance: number
): { region: FloodRegion; mask: HTMLCanvasElement } | null {
	const region = floodFillRegion( pixels, width, height, startX, startY, tolerance );

	if ( ! region ) {
		return null;
	}

	const mask = regionToCanvas( region );

	return mask ? { region, mask } : null;
}
