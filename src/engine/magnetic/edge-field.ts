/**
 * Where the edges are.
 *
 * The magnetic lasso does not follow the pointer. It follows the strongest boundary
 * near the pointer, which means something has to have decided, for every pixel, how
 * much of a boundary it is and which way that boundary runs. That is this file: one
 * Sobel pass over the composed document, producing two answers per pixel that the
 * live wire then treats as terrain.
 *
 * Three decisions matter here, and all three are about photographs rather than about
 * gradient operators.
 *
 * - **Colour, not brightness.** The gradient is taken on each of red, green and blue
 *   and the strongest of the three wins. A red poppy against green leaves is a boundary
 *   anyone can see and very nearly no boundary at all in luminance, so a tool that
 *   measured brightness would slide straight through the flower. Taking the maximum
 *   costs three Sobels instead of one and is the entire reason this snaps to colour.
 * - **The scale is the picture's, not the operator's.** Strength is normalised against
 *   the 99th percentile of the gradients actually present, so "a strong edge" means
 *   strong *in this photograph*. A fixed divisor would make a soft-focus portrait read
 *   as having no edges at all, and the wire would then wander through it in straight
 *   lines.
 * - **Big documents are sampled, not refused.** Past two megapixels the field is built
 *   at a stride. A fifty-megapixel scan would otherwise spend a second and 150MB before
 *   the first anchor, to place a boundary more precisely than the six hundred vertices a
 *   `Selection` keeps could ever record.
 */

/**
 * The largest field the detector will build, in pixels.
 *
 * The default, not the rule: `lienzo_max_edge_pixels` moves it, and the editor hands
 * whatever comes back to `buildEdgeField()`. A parameter rather than something written
 * into this module at boot, because everything under `engine/` is pure -- it is handed
 * pixels and asked for a field, and a pure function that reads a global is neither
 * testable nor honest.
 */
export const MAX_FIELD_PIXELS = 2_000_000;

/**
 * How much of a boundary every pixel is, and which way that boundary runs.
 *
 * One byte and two signed bytes per pixel rather than floats: the live wire quantises
 * its costs to integers anyway, and a fifty-megapixel document has to fit in something
 * that can be allocated between a pointer going down and the first frame after it.
 */
export interface EdgeField {
	width: number;
	height: number;
	/** Document pixels per field pixel. 1 unless the document was too big to sample whole. */
	step: number;
	/** Edge strength, 0..255, indexed `y * width + x`. */
	strength: Uint8Array;
	/** The unit tangent of the edge -- along it, not across it -- scaled to -127..127. */
	tangentX: Int8Array;
	tangentY: Int8Array;
}

/** How many gradient-magnitude bins the percentile is measured in. */
const HISTOGRAM_BINS = 256;

/** The largest magnitude a 3x3 Sobel can produce from 8-bit samples. */
const MAX_SOBEL = 1443;

/** The share of pixels allowed to sit above "full strength". */
const PERCENTILE = 0.99;

/**
 * Builds the edge field for a document.
 *
 * @param pixels    Composed document, RGBA.
 * @param width     Document width.
 * @param height    Document height.
 * @param contrast  How strong an edge must be before it counts at all, 0..1. Raising it
 *                  tells the wire to ignore texture and hold out for real boundaries.
 * @param maxPixels Optional. Ceiling on the field, from `lienzo_max_edge_pixels`.
 *                  Defaults to two megapixels. Anything under one pixel is meaningless
 *                  and is read as the default, so a filter returning zero cannot ask
 *                  for a field with no pixels in it.
 * @return The field, or null when the document is too small to have edges.
 */
export function buildEdgeField(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
	contrast = 0,
	maxPixels = MAX_FIELD_PIXELS
): EdgeField | null {
	if ( width < 3 || height < 3 ) {
		return null;
	}

	const ceiling = maxPixels >= 1 ? maxPixels : MAX_FIELD_PIXELS;
	const step = Math.max(
		1,
		Math.ceil( Math.sqrt( ( width * height ) / ceiling ) )
	);
	const fw = Math.floor( width / step );
	const fh = Math.floor( height / step );

	if ( fw < 3 || fh < 3 ) {
		return null;
	}

	const count = fw * fh;
	const magnitude = new Uint16Array( count );
	const tangentX = new Int8Array( count );
	const tangentY = new Int8Array( count );
	const histogram = new Uint32Array( HISTOGRAM_BINS );

	// The Sobel window is one field step wide, so a downsampled field still measures the
	// gradient across the distance it is actually sampling rather than across three
	// adjacent document pixels it will never look at again.
	const row = width * 4;
	const col = step * 4;
	const band = step * row;
	const shift = Math.ceil( Math.log2( MAX_SOBEL / HISTOGRAM_BINS ) );

	for ( let y = 0; y < fh; y++ ) {
		// Clamped so the window always lies on the canvas: the outermost field row then
		// repeats its neighbour, which is cheaper than a bounds test per sample and
		// indistinguishable at the edge of a photograph.
		const sy = Math.min( height - 1 - step, Math.max( step, y * step ) );

		for ( let x = 0; x < fw; x++ ) {
			const sx = Math.min( width - 1 - step, Math.max( step, x * step ) );
			const centre = ( sy * width + sx ) * 4;

			let best = -1;
			let bestX = 0;
			let bestY = 0;

			for ( let channel = 0; channel < 3; channel++ ) {
				const i = centre + channel;
				const tl = pixels[ i - band - col ];
				const tc = pixels[ i - band ];
				const tr = pixels[ i - band + col ];
				const ml = pixels[ i - col ];
				const mr = pixels[ i + col ];
				const bl = pixels[ i + band - col ];
				const bc = pixels[ i + band ];
				const br = pixels[ i + band + col ];

				const gx = tr + 2 * mr + br - tl - 2 * ml - bl;
				const gy = bl + 2 * bc + br - tl - 2 * tc - tr;
				const squared = gx * gx + gy * gy;

				if ( squared > best ) {
					best = squared;
					bestX = gx;
					bestY = gy;
				}
			}

			const mag = Math.round( Math.sqrt( best ) );
			const index = y * fw + x;

			magnitude[ index ] = mag;
			histogram[ Math.min( HISTOGRAM_BINS - 1, mag >> shift ) ]++;

			if ( mag > 0 ) {
				// Perpendicular to the gradient, which is the direction the edge itself
				// travels in -- the wire is trying to walk *along* a boundary, and the
				// gradient points across one.
				tangentX[ index ] = Math.round( ( bestY / mag ) * 127 );
				tangentY[ index ] = Math.round( ( -bestX / mag ) * 127 );
			}
		}
	}

	return {
		width: fw,
		height: fh,
		step,
		strength: normalise( magnitude, histogram, shift, count, contrast ),
		tangentX,
		tangentY,
	};
}

/**
 * Rescales raw gradient magnitudes into 0..255 strengths.
 *
 * Against a percentile rather than the maximum, because one specular highlight on a
 * chrome bumper is several times stronger than every edge that matters and would push
 * the rest of the photograph down into the noise.
 *
 * @param magnitude Raw Sobel magnitudes.
 * @param histogram Bin counts of those magnitudes.
 * @param shift     How far a magnitude was shifted right to reach its bin.
 * @param count     How many pixels the field has.
 * @param contrast  Strength below which an edge is discarded entirely, 0..1.
 */
function normalise(
	magnitude: Uint16Array,
	histogram: Uint32Array,
	shift: number,
	count: number,
	contrast: number
): Uint8Array {
	const target = count * PERCENTILE;
	let seen = 0;
	let bin = 0;

	for ( ; bin < HISTOGRAM_BINS - 1; bin++ ) {
		seen += histogram[ bin ];

		if ( seen >= target ) {
			break;
		}
	}

	// One bin up, so the pixels *at* the percentile reach full strength rather than
	// stopping just short of it.
	const peak = Math.max( 1, ( bin + 1 ) << shift );
	const floor = Math.min( 0.95, Math.max( 0, contrast ) );
	const strength = new Uint8Array( count );

	for ( let i = 0; i < count; i++ ) {
		const scaled = magnitude[ i ] / peak;

		// Everything under the contrast floor is flattened to nothing, and what remains
		// is stretched back over the full range: raising the setting does not merely
		// dim weak edges, it stops them competing with strong ones at all.
		strength[ i ] =
			scaled <= floor
				? 0
				: Math.min( 255, Math.round( ( ( scaled - floor ) / ( 1 - floor ) ) * 255 ) );
	}

	return strength;
}
