/**
 * The shortest path along an edge.
 *
 * Given a fixed anchor and a moving pointer, this answers "what is the cheapest route
 * from there to here, if walking along a boundary is cheap and cutting across a flat
 * area is dear". That is the whole magnetic lasso: the pointer says roughly where, the
 * path says exactly where.
 *
 * It is Mortensen and Barrett's live wire, minus the Laplacian zero-crossing term --
 * which is the one of their three features that misbehaves on photographic noise, and
 * the one that costs a second convolution to compute. What is left is edge strength,
 * which decides *whether* a pixel is on a boundary, and edge direction, which decides
 * whether the boundary through it is the same boundary we were already following. The
 * direction term is what stops the wire hopping between two parallel edges a few pixels
 * apart, and dropping it is very visible on anything with a rim light.
 *
 * Two things make it fast enough to run under a moving pointer:
 *
 * - **The search is never restarted.** Dijkstra settles nodes in cost order, so a node
 *   settled for one pointer position is settled for every later one. Moving the pointer
 *   expands the frontier a little further or, far more often, does not expand it at all
 *   and merely walks the back-pointers home. The expensive frame is the first one after
 *   an anchor; the rest are free.
 * - **The queue is an array of buckets, not a heap.** Link costs are quantised to small
 *   integers, so Dial's algorithm applies: pushing is an array push, popping is a pop,
 *   and there is no comparison anywhere. A binary heap here would spend more time
 *   reordering itself than the search spends deciding anything.
 */

import type { EdgeField } from './edge-field';

/** How the two features are weighed against each other. */
const EDGE_WEIGHT = 0.82;

/** The rest, spent on keeping the wire on the boundary it started on. */
const DIRECTION_WEIGHT = 1 - EDGE_WEIGHT;

/** Costs are integers, so the queue can be buckets rather than a heap. */
const COST_SCALE = 256;

/** The dearest single step, which is also how many buckets the queue needs. */
const MAX_LINK = 1 + Math.ceil( Math.SQRT2 * COST_SCALE );

/** Buckets in the circular queue. One more than the dearest step, by Dial's argument. */
const BUCKETS = MAX_LINK + 1;

/** The eight neighbours, as offsets. */
const NEIGHBOUR_X = [ 1, -1, 0, 0, 1, 1, -1, -1 ];
const NEIGHBOUR_Y = [ 0, 0, 1, -1, 1, -1, 1, -1 ];

/** How long each of those steps is, which is what makes a diagonal cost its extra 41%. */
const UNIT = NEIGHBOUR_X.map( ( dx, i ) => Math.hypot( dx, NEIGHBOUR_Y[ i ] ) );

/** The same eight as unit vectors, for the direction term. */
const UNIT_X = NEIGHBOUR_X.map( ( dx, i ) => dx / UNIT[ i ] );
const UNIT_Y = NEIGHBOUR_Y.map( ( dy, i ) => dy / UNIT[ i ] );

/** Resolution of the arc-cosine table. */
const ACOS_STEPS = 512;

/**
 * Arc-cosine, tabulated.
 *
 * The direction term needs two of these per edge relaxation, which is up to sixteen per
 * pixel settled. `Math.acos` is not slow, but it is not free either, and the argument
 * here is a dot product of two vectors already quantised to a signed byte -- so the
 * table is not even an approximation of anything the inputs could distinguish.
 */
const ACOS = ( () => {
	const table = new Float32Array( ACOS_STEPS + 1 );

	for ( let i = 0; i <= ACOS_STEPS; i++ ) {
		table[ i ] = Math.acos( ( i / ACOS_STEPS ) * 2 - 1 );
	}

	return table;
} )();

/**
 * Arc-cosine of a value already known to be in -1..1.
 *
 * @param value Cosine.
 */
function acos( value: number ): number {
	const clamped = value < -1 ? -1 : value > 1 ? 1 : value;

	return ACOS[ Math.round( ( clamped + 1 ) * 0.5 * ACOS_STEPS ) ];
}

/** A point on the edge field, in field pixels. */
export interface WirePoint {
	x: number;
	y: number;
}

/**
 * A live wire anchored at one point of an edge field.
 *
 * One instance per gesture, reseeded at every anchor. The arrays are allocated once and
 * reused: a generation stamp says which seed wrote each entry, so reseeding is an
 * increment rather than three writes per pixel of the document.
 */
export class LiveWire {
	private field: EdgeField;

	/** Cheapest route found to each node so far, for the current seed. */
	private cost: Int32Array;

	/** The node each one was reached from. */
	private parent: Int32Array;

	/** Which seed last wrote `cost` and `parent` here. */
	private stamp: Int32Array;

	/** Which seed settled this node, meaning its cost is final. */
	private settled: Int32Array;

	private buckets: number[][] = [];

	private generation = 0;

	/** How many entries are in the queue, stale ones included. */
	private queued = 0;

	/** The cost the queue has swept up to. */
	private sweep = 0;

	private seedIndex = -1;

	private minX = 0;

	private minY = 0;

	private maxX = 0;

	private maxY = 0;

	/**
	 * @param field The edge field to search.
	 */
	constructor( field: EdgeField ) {
		const count = field.width * field.height;

		this.field = field;
		this.cost = new Int32Array( count );
		this.parent = new Int32Array( count );
		this.stamp = new Int32Array( count );
		this.settled = new Int32Array( count );

		for ( let i = 0; i < BUCKETS; i++ ) {
			this.buckets.push( [] );
		}
	}

	/**
	 * Anchors the wire at a point, and bounds how far from it the search may go.
	 *
	 * The bound is the tool's Width setting, and it is what makes the wire predictable:
	 * inside it the pointer is a suggestion and the boundary decides, outside it there
	 * is no boundary on offer and the caller draws a straight line instead. A search
	 * with no bound would eventually find *some* route to anywhere, and the further away
	 * the pointer got the less that route would resemble anything the user pointed at.
	 *
	 * @param x      Field coordinates.
	 * @param y      Field coordinates.
	 * @param radius How far the search may travel, in field pixels.
	 */
	seed( x: number, y: number, radius: number ): void {
		const { width, height } = this.field;
		const sx = clamp( Math.round( x ), 0, width - 1 );
		const sy = clamp( Math.round( y ), 0, height - 1 );

		for ( const bucket of this.buckets ) {
			bucket.length = 0;
		}

		this.generation++;
		this.queued = 0;
		this.sweep = 0;
		this.minX = Math.max( 0, sx - radius );
		this.minY = Math.max( 0, sy - radius );
		this.maxX = Math.min( width - 1, sx + radius );
		this.maxY = Math.min( height - 1, sy + radius );
		this.seedIndex = sy * width + sx;

		this.cost[ this.seedIndex ] = 0;
		this.parent[ this.seedIndex ] = -1;
		this.stamp[ this.seedIndex ] = this.generation;
		this.buckets[ 0 ].push( this.seedIndex );
		this.queued++;
	}

	/** Where the wire is currently anchored, in field pixels. */
	get anchor(): WirePoint | null {
		if ( this.seedIndex < 0 ) {
			return null;
		}

		return {
			x: this.seedIndex % this.field.width,
			y: Math.floor( this.seedIndex / this.field.width ),
		};
	}

	/**
	 * The cheapest route from the anchor to a point.
	 *
	 * @param x Field coordinates.
	 * @param y Field coordinates.
	 * @return The route, anchor first, or null when the point is out of reach.
	 */
	pathTo( x: number, y: number ): WirePoint[] | null {
		const px = Math.round( x );
		const py = Math.round( y );

		if (
			this.seedIndex < 0 ||
			px < this.minX ||
			px > this.maxX ||
			py < this.minY ||
			py > this.maxY
		) {
			return null;
		}

		const target = py * this.field.width + px;

		if ( ! this.expandTo( target ) ) {
			return null;
		}

		const route: WirePoint[] = [];

		for ( let i = target; i >= 0; i = this.parent[ i ] ) {
			route.push( {
				x: i % this.field.width,
				y: Math.floor( i / this.field.width ),
			} );

			if ( i === this.seedIndex ) {
				break;
			}
		}

		return route.reverse();
	}

	/**
	 * Settles nodes in cost order until the target is one of them.
	 *
	 * @param target Node to reach.
	 * @return Whether it was reached.
	 */
	private expandTo( target: number ): boolean {
		if ( this.settled[ target ] === this.generation ) {
			return true;
		}

		while ( this.queued > 0 ) {
			const bucket = this.buckets[ this.sweep % BUCKETS ];

			if ( 0 === bucket.length ) {
				this.sweep++;

				continue;
			}

			const index = bucket.pop() as number;

			this.queued--;

			// A node reached again more cheaply leaves its dearer entry behind. Both the
			// stamp and the cost have to agree before an entry is believed.
			if (
				this.stamp[ index ] !== this.generation ||
				this.cost[ index ] !== this.sweep ||
				this.settled[ index ] === this.generation
			) {
				continue;
			}

			this.settled[ index ] = this.generation;

			if ( index === target ) {
				return true;
			}

			this.relax( index );
		}

		return this.settled[ target ] === this.generation;
	}

	/**
	 * Offers a cheaper route to each of a settled node's eight neighbours.
	 *
	 * @param index Node to expand from.
	 */
	private relax( index: number ): void {
		const { width, strength, tangentX, tangentY } = this.field;
		const x = index % width;
		const y = ( index - x ) / width;
		const base = this.cost[ index ];
		const fromX = tangentX[ index ] / 127;
		const fromY = tangentY[ index ] / 127;

		for ( let n = 0; n < 8; n++ ) {
			const nx = x + NEIGHBOUR_X[ n ];
			const ny = y + NEIGHBOUR_Y[ n ];

			if ( nx < this.minX || nx > this.maxX || ny < this.minY || ny > this.maxY ) {
				continue;
			}

			const next = ny * width + nx;

			if ( this.settled[ next ] === this.generation ) {
				continue;
			}

			// The step is read backwards where that agrees better with the edge running
			// through the node we are leaving: a boundary has no preferred way round, and
			// penalising a wire for tracing one anticlockwise would be an artefact of how
			// the tangent happened to be signed.
			let stepX = UNIT_X[ n ];
			let stepY = UNIT_Y[ n ];

			if ( fromX * stepX + fromY * stepY < 0 ) {
				stepX = -stepX;
				stepY = -stepY;
			}

			const turn =
				acos( fromX * stepX + fromY * stepY ) +
				acos( stepX * ( tangentX[ next ] / 127 ) + stepY * ( tangentY[ next ] / 127 ) );

			const local =
				EDGE_WEIGHT * ( 1 - strength[ next ] / 255 ) +
				DIRECTION_WEIGHT * turn * ( 2 / ( 3 * Math.PI ) );

			// A step is never free, however perfect the edge under it: without the one,
			// a wire crossing a large flat-out region of maximum strength could wander
			// through it at no charge and come out anywhere.
			const link = 1 + Math.round( local * UNIT[ n ] * COST_SCALE );
			const total = base + link;

			if ( this.stamp[ next ] === this.generation && this.cost[ next ] <= total ) {
				continue;
			}

			this.stamp[ next ] = this.generation;
			this.cost[ next ] = total;
			this.parent[ next ] = index;
			this.buckets[ total % BUCKETS ].push( next );
			this.queued++;
		}
	}
}

/**
 * Holds a value inside a range.
 *
 * @param value Value.
 * @param min   Lowest allowed.
 * @param max   Highest allowed.
 */
function clamp( value: number, min: number, max: number ): number {
	return value < min ? min : value > max ? max : value;
}
