import { describe, expect, it } from 'vitest';
import { floodFillRegion, regionToCanvas } from '../../src/engine/brush';
import type { FloodRegion } from '../../src/engine/brush';

/**
 * Builds an RGBA buffer from a picture drawn in characters.
 *
 * `.` is black, `#` is white, `~` is mid grey -- enough to exercise tolerance without
 * anyone having to count bytes.
 *
 * @param rows Picture, one string per row.
 */
function pixelsFrom( rows: string[] ) {
	const height = rows.length;
	const width = rows[ 0 ].length;
	const pixels = new Uint8ClampedArray( width * height * 4 );
	const shades: Record< string, number > = { '.': 0, '~': 128, '#': 255 };

	for ( let y = 0; y < height; y++ ) {
		for ( let x = 0; x < width; x++ ) {
			const value = shades[ rows[ y ][ x ] ];
			const at = ( y * width + x ) * 4;

			pixels[ at ] = value;
			pixels[ at + 1 ] = value;
			pixels[ at + 2 ] = value;
			pixels[ at + 3 ] = 255;
		}
	}

	return { pixels, width, height };
}

/**
 * Renders a region back to characters, so a failure reads as a picture.
 *
 * @param region Region to draw.
 */
function drawRegion( region: FloodRegion ): string[] {
	const rows: string[] = [];

	for ( let y = 0; y < region.height; y++ ) {
		let row = '';

		for ( let x = 0; x < region.width; x++ ) {
			row += region.state[ y * region.width + x ] === 255 ? '#' : '.';
		}

		rows.push( row );
	}

	return rows;
}

describe( 'floodFillRegion', () => {
	it( 'declines a seed off the canvas', () => {
		const { pixels, width, height } = pixelsFrom( [ '##', '##' ] );

		expect( floodFillRegion( pixels, width, height, -1, 0, 0 ) ).toBeNull();
		expect( floodFillRegion( pixels, width, height, 0, 2, 0 ) ).toBeNull();
	} );

	it( 'fills a plain region and reports its extent', () => {
		const { pixels, width, height } = pixelsFrom( [
			'.....',
			'.###.',
			'.###.',
			'.....',
		] );
		const region = floodFillRegion( pixels, width, height, 2, 2, 0 )!;

		expect( region.count ).toBe( 6 );
		expect( region.bounds ).toEqual( { x: 1, y: 1, width: 3, height: 2 } );
	} );

	it( 'spreads through edges and not through corners', () => {
		// The two blocks touch only at a corner, so a fill seeded in one must not
		// escape into the other -- the outline tracer relies on the same rule.
		const { pixels, width, height } = pixelsFrom( [
			'##..',
			'##..',
			'..##',
			'..##',
		] );
		const region = floodFillRegion( pixels, width, height, 0, 0, 0 )!;

		expect( drawRegion( region ) ).toEqual( [ '##..', '##..', '....', '....' ] );
	} );

	it( 'reaches around an obstacle rather than through it', () => {
		const { pixels, width, height } = pixelsFrom( [
			'#####',
			'#.#.#',
			'#.#.#',
			'#...#',
			'#####',
		] );
		// Seeded in the left channel, which joins the right one along the bottom row.
		const region = floodFillRegion( pixels, width, height, 1, 1, 0 )!;

		expect( drawRegion( region ) ).toEqual( [
			'.....',
			'.#.#.',
			'.#.#.',
			'.###.',
			'.....',
		] );
	} );

	it( 'leaves an enclosed hole out of the region', () => {
		const { pixels, width, height } = pixelsFrom( [
			'#####',
			'#...#',
			'#.#.#',
			'#...#',
			'#####',
		] );
		const region = floodFillRegion( pixels, width, height, 1, 1, 0 )!;

		expect( region.count ).toBe( 8 );
		expect( drawRegion( region )[ 2 ] ).toBe( '.#.#.' );
	} );

	it( 'treats near-enough colours as the same, up to the tolerance', () => {
		const { pixels, width, height } = pixelsFrom( [ '#~#', '#~#' ] );

		expect( floodFillRegion( pixels, width, height, 0, 0, 0 )!.count ).toBe( 2 );
		expect( floodFillRegion( pixels, width, height, 0, 0, 200 )!.count ).toBe( 6 );
	} );

	it( 'fills a single pixel when nothing around it matches', () => {
		const { pixels, width, height } = pixelsFrom( [ '...', '.#.', '...' ] );
		const region = floodFillRegion( pixels, width, height, 1, 1, 0 )!;

		expect( region.count ).toBe( 1 );
		expect( region.bounds ).toEqual( { x: 1, y: 1, width: 1, height: 1 } );
	} );

	it( 'fills a whole canvas of one colour', () => {
		const size = 64;
		const pixels = new Uint8ClampedArray( size * size * 4 ).fill( 255 );
		const region = floodFillRegion( pixels, size, size, 3, 3, 0 )!;

		expect( region.count ).toBe( size * size );
		expect( region.bounds ).toEqual( { x: 0, y: 0, width: size, height: size } );
	} );

	it( 'fills a comb, which is where a span fill earns its keep', () => {
		// Alternating columns joined along the bottom: every row is a separate run, so
		// the spans stack up and come back off in the right order or the fill leaks.
		const rows: string[] = [];

		for ( let y = 0; y < 31; y++ ) {
			rows.push(
				y === 30 ? '#'.repeat( 31 ) : Array.from( { length: 31 }, ( _, x ) => ( x % 2 ? '.' : '#' ) ).join( '' )
			);
		}

		const { pixels, width, height } = pixelsFrom( rows );
		const region = floodFillRegion( pixels, width, height, 0, 0, 0 )!;

		// Sixteen teeth of thirty rows, plus the row that joins them.
		expect( region.count ).toBe( 16 * 30 + 31 );
	} );

	it( 'walks a spiral without overflowing a stack', () => {
		// The classic four-way stack fill dies on this; a span fill does not care.
		const size = 101;
		const rows: string[][] = Array.from( { length: size }, () =>
			Array.from( { length: size }, () => '#' )
		);

		for ( let ring = 0; ring * 4 + 2 < size; ring++ ) {
			const y = ring * 4 + 2;

			for ( let x = ring % 2 ? 0 : 1; x < size - ( ring % 2 ? 1 : 0 ); x++ ) {
				rows[ y ][ x ] = '.';
			}
		}

		const { pixels, width, height } = pixelsFrom( rows.map( ( row ) => row.join( '' ) ) );
		const region = floodFillRegion( pixels, width, height, 0, 0, 0 )!;
		const walls = rows.flat().filter( ( cell ) => cell === '.' ).length;

		expect( region.count ).toBe( size * size - walls );
	} );

	it( 'is fast enough on a twenty-megapixel photograph', () => {
		// The number that matters is the shape of the curve, not the wall clock: this
		// is a hundred times the pixels of the tests above and has to stay in the same
		// order of magnitude as the memory the mask itself needs.
		const width = 5200;
		const height = 3900;
		const pixels = new Uint8ClampedArray( width * height * 4 ).fill( 255 );
		const started = Date.now();
		const region = floodFillRegion( pixels, width, height, 10, 10, 0 )!;

		expect( region.count ).toBe( width * height );
		expect( Date.now() - started ).toBeLessThan( 2000 );
	} );
} );

describe( 'regionToCanvas', () => {
	it( 'draws only the pixels the fill reached', () => {
		const written: Array< { width: number; height: number } > = [];
		const original = HTMLCanvasElement.prototype.getContext;

		HTMLCanvasElement.prototype.getContext = function () {
			return {
				createImageData: ( width: number, height: number ) => ( {
					data: new Uint8ClampedArray( width * height * 4 ),
					width,
					height,
				} ),
				putImageData: ( image: { width: number; height: number } ) =>
					written.push( { width: image.width, height: image.height } ),
			} as unknown as CanvasRenderingContext2D;
		} as unknown as typeof original;

		try {
			const { pixels, width, height } = pixelsFrom( [
				'.....',
				'.##..',
				'.##..',
				'.....',
			] );
			const canvas = regionToCanvas(
				floodFillRegion( pixels, width, height, 1, 1, 0 )!
			)!;

			// Not five by four: a fill of one object on a large photograph must not
			// allocate the whole document to carry a handful of opaque pixels.
			expect( canvas.width ).toBe( 2 );
			expect( canvas.height ).toBe( 2 );
			expect( written ).toEqual( [ { width: 2, height: 2 } ] );
		} finally {
			HTMLCanvasElement.prototype.getContext = original;
		}
	} );
} );
