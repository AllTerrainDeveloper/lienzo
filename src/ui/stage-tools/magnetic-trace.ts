/**
 * The magnetic lasso, as a gesture.
 *
 * Everything the live wire does not know: where the document is, how big a screen pixel
 * currently is, when to stop following the pointer and pin what has been traced so far,
 * and how a few thousand pixel coordinates become the six hundred normalised vertices a
 * `Selection` is allowed to carry.
 *
 * The lifecycle is deliberately not a drag. A magnetic trace is *placed*, like a
 * polygon: pressing starts it, moving the pointer -- button held or not -- extends it,
 * pressing again pins an anchor, and it is finished by clicking where it started, by
 * double-clicking, or with Enter. Releasing the button does nothing at all, which is
 * what lets someone trace a whole subject in one pass, let go halfway to reposition
 * their hand, and carry on. Every editor that has this tool works this way, and the
 * alternative -- close on release -- would make a slipped finger destroy a minute of
 * careful tracing.
 *
 * Two settings are read in *screen* pixels and converted once, when the trace begins:
 *
 * - **Width** is how far from the pointer the wire may look for a boundary.
 * - **Frequency** decides how often an anchor is pinned automatically.
 *
 * Screen rather than document pixels because both describe how carefully someone is
 * pointing, and how carefully you can point is a fact about the picture on your monitor,
 * not about the file behind it. Photoshop measures them in image pixels, which is why
 * its magnetic lasso is unusable at fit zoom on a 50-megapixel scan and twitchy at 400%
 * on a thumbnail: the same setting means two different gestures. Converting at the start
 * of the trace, not per frame, keeps a zoom mid-gesture from changing the tool under the
 * user's hand.
 */

import { buildEdgeField, LiveWire } from '../../engine/magnetic';
import type { EdgeField, WirePoint } from '../../engine/magnetic';
import { MAX_LASSO_POINTS, simplifyPath } from '../../model/selection';
import type { Point, Selection, SelectionAnchor } from '../../model/selection';
import type { StageToolsOptions } from './types';

/** How near its first anchor a press has to land to close the loop, in screen pixels. */
const CLOSE_DISTANCE = 12;

/** The narrowest search the Width setting can ask for, in field pixels. */
const MIN_RADIUS = 6;

/**
 * The widest.
 *
 * The search is quadratic in this, and past a couple of hundred pixels it is also
 * pointless: a wire allowed to look that far from the pointer stops being a suggestion
 * about what the user meant and starts finding whichever object happens to have the
 * cleanest outline nearby.
 */
const MAX_RADIUS = 120;

/**
 * The furthest apart automatic anchors may sit, in field pixels.
 *
 * Only a backstop against a search box big enough to be slow. Frequency 0 is meant to
 * read as "pin them myself", and it very nearly does: a 200-pixel stretch of live wire
 * is longer than most subjects have in one uninterrupted edge.
 */
const MAX_SPACING = 200;

/**
 * The largest search box, as a half-width in field pixels.
 *
 * The search is quadratic in this, and the box has to be paid for once per anchor. At
 * 220 that is a few hundred thousand nodes spread over a couple of hundred pixels of
 * tracing -- unnoticeable. Left uncapped, a wide Width and a Frequency of zero would ask
 * for a box big enough to stall a frame.
 */
const MAX_REACH = 220;

/** How far a simplified vertex may sit from the traced boundary, in field pixels. */
const SIMPLIFY_TOLERANCE = 0.7;

/** How far past the spacing rule an anchor may be moved to land on the boundary. */
const SNAP_WINDOW = 6;

/** The weakest edge worth snapping an anchor to, out of 255. */
const MIN_EDGE = 32;

/**
 * A magnetic lasso being traced.
 *
 * Coordinates are in *field* pixels throughout -- the edge field's grid, which is the
 * document's on anything under two megapixels and a stride of it above that. Converting
 * once at the end rather than at every step keeps the arithmetic in the units the wire
 * actually works in.
 */
export class MagneticTrace {
	private options: StageToolsOptions;

	private field: EdgeField | null = null;

	private wire: LiveWire | null = null;

	/** Document size when the trace began, which the vertices are normalised against. */
	private document = { width: 0, height: 0 };

	/** The boundary pinned so far, from the first anchor to the last. */
	private traced: WirePoint[] = [];

	/**
	 * Where each anchor sits in `traced`, and how it got there.
	 *
	 * The index rather than the point, because taking an anchor back means truncating
	 * the traced path at it -- and an index is the only form of that answer which
	 * survives the path being simplified on its way out.
	 */
	private anchors: Array< { at: number; manual: boolean } > = [];

	/** The wire from the last anchor to the pointer, redrawn on every move. */
	private live: WirePoint[] = [];

	private radius = MIN_RADIUS;

	/** How much boundary is pinned at a time, in field pixels. */
	private spacing = 20;

	/**
	 * How far each search may travel, in field pixels.
	 *
	 * The Width setting *plus* the spacing, because those are the two ways the pointer
	 * gets away from the anchor and the box has to hold both. Width is how far off the
	 * boundary someone is pointing; the spacing is how far behind them the last anchor
	 * was left. Sizing the box to the width alone looks fine until a hand wobbles by
	 * most of it, and then the wire spends every other frame out of reach -- which is
	 * visible as a chain of straight jogs across an outline it was otherwise tracing
	 * perfectly.
	 */
	private reach = MIN_RADIUS;

	private closeWithin = CLOSE_DISTANCE;

	/**
	 * @param options Tool wiring.
	 */
	constructor( options: StageToolsOptions ) {
		this.options = options;
	}

	/** Whether a trace is in progress. */
	get isTracing(): boolean {
		return null !== this.field;
	}

	/** How many anchors are pinned. */
	get anchorCount(): number {
		return this.anchors.length;
	}

	/**
	 * Reads the document, finds its edges, and drops the first anchor.
	 *
	 * The edge field is built once here and kept for the whole trace. It is the one
	 * expensive thing this tool does -- a Sobel over the composed document, plus the
	 * read-back from the GPU that feeds it -- and rebuilding it per anchor would put
	 * that cost on every click instead of on the first.
	 *
	 * @param point Canvas coordinates.
	 * @return Whether a trace could be started. False when there are no pixels to follow,
	 *         and the caller should fall back to an ordinary freeform lasso.
	 */
	begin( point: Point ): boolean {
		const source = this.options.readDocument();

		if ( ! source ) {
			return false;
		}

		const brush = this.options.getBrush();
		const field = buildEdgeField(
			source.pixels,
			source.width,
			source.height,
			brush.magneticContrast / 100,
			this.options.maxEdgePixels
		);

		if ( ! field ) {
			return false;
		}

		// Document pixels per screen pixel, so the two settings below mean the same
		// gesture at every zoom level.
		const zoom = this.documentPerScreenPixel() / field.step;

		this.field = field;
		this.wire = new LiveWire( field );
		this.document = { width: source.width, height: source.height };
		this.radius = clamp(
			Math.round( brush.magneticWidth * zoom ),
			MIN_RADIUS,
			MAX_RADIUS
		);
		// Not capped against the width. Tying the two together was a mistake worth naming:
		// with a 20-pixel width, a Frequency of 57 -- which asks for an anchor every 43
		// pixels -- pinned one every 20 instead, four times as often as the setting said.
		// An anchor is a commitment. The wire between the last one and the pointer keeps
		// re-flowing as the hand moves, and everything behind it is fixed for good, so
		// pinning too eagerly means the tool stops reconsidering a stretch the user is
		// still looking at. The search box is sized to hold both (`reach` below), so a
		// wide spacing costs a larger search rather than a wrong one.
		this.spacing = clamp(
			Math.round( anchorSpacing( brush.magneticFrequency ) * zoom ),
			3,
			MAX_SPACING
		);
		this.closeWithin = Math.max( 3, CLOSE_DISTANCE * zoom );

		const start = this.toField( point );

		this.traced = [ start ];
		// Manual: somebody clicked to put it there, which is the whole of what the
		// distinction means.
		this.anchors = [ { at: 0, manual: true } ];
		this.live = [ start ];
		this.reach = Math.min( MAX_REACH, this.radius + this.spacing );
		this.wire.seed( start.x, start.y, this.reach );

		return true;
	}

	/**
	 * Follows the pointer, pinning boundary behind it as it goes.
	 *
	 * Anchors are dropped inside this loop rather than on a timer, and they are dropped
	 * at a point *on the traced boundary* rather than under the pointer. That difference
	 * is most of why this feels magnetic: the pointer is allowed to be sloppy, and every
	 * anchor it leaves behind still lands on the edge.
	 *
	 * @param point Canvas coordinates.
	 */
	moveTo( point: Point ): void {
		if ( ! this.wire || ! this.field ) {
			return;
		}

		const target = this.toField( point );

		// Bounded, because a single fast drag can cross several anchors' worth of
		// boundary and each pin restarts the search.
		for ( let pass = 0; pass < 8; pass++ ) {
			const route = this.wire.pathTo( target.x, target.y );

			if ( ! route ) {
				if ( this.advance( target ) ) {
					continue;
				}

				return;
			}

			const cut = cutAt( route, this.spacing );

			if ( cut < 0 ) {
				this.live = route;

				return;
			}

			this.pin( route.slice( 0, this.pinIndex( route, cut ) + 1 ), false );
		}
	}

	/**
	 * Walks one straight step towards a pointer the wire cannot reach.
	 *
	 * Someone moving faster than the search can follow, or deliberately cutting across
	 * open sky, leaves the anchor behind -- and an anchor that can no longer see the
	 * pointer can never find the boundary near it again, so without this the trace would
	 * stall the first time anyone flicked their wrist and rubber-band forever after.
	 * Stepping the anchor towards the pointer keeps the search where the pointer is, and
	 * the straight line it lays down is the honest record of a stretch where the tool
	 * was following the hand rather than the picture.
	 *
	 * @param target Field coordinates of the pointer.
	 * @return Whether an anchor was moved, and the caller should search again.
	 */
	private advance( target: WirePoint ): boolean {
		const from = this.traced[ this.traced.length - 1 ];
		const gap = Math.hypot( target.x - from.x, target.y - from.y );

		if ( gap <= this.spacing ) {
			this.live = [ from, target ];

			return false;
		}

		const reach = this.spacing / gap;

		this.pin(
			[
				from,
				{
					x: Math.round( from.x + ( target.x - from.x ) * reach ),
					y: Math.round( from.y + ( target.y - from.y ) * reach ),
				},
			],
			false
		);

		return true;
	}

	/**
	 * Pins an anchor where the pointer is.
	 *
	 * @param point Canvas coordinates.
	 */
	anchorAt( point: Point ): void {
		if ( ! this.wire ) {
			return;
		}

		this.moveTo( point );

		// Whatever the wire is currently showing is what the user is looking at when they
		// click, so that is what gets pinned -- not a fresh path to the pointer, which
		// would be a different route from the one they just accepted.
		this.pinLive( true );
	}

	/**
	 * Takes back the last anchor.
	 *
	 * @return Whether the trace is still alive. False once the first anchor has gone,
	 *         and the caller should abandon it.
	 */
	undoAnchor(): boolean {
		if ( ! this.wire || this.anchors.length < 2 ) {
			return false;
		}

		this.anchors.pop();

		const { at } = this.anchors[ this.anchors.length - 1 ];
		const anchor = this.traced[ at ];

		this.traced.length = at + 1;
		this.live = [ anchor ];
		this.wire.seed( anchor.x, anchor.y, this.reach );

		return true;
	}

	/**
	 * Closes the loop and hands back what was traced.
	 *
	 * Whatever the wire is showing is included first, because what is on screen when
	 * someone presses Enter is what they think they are selecting. The segment from
	 * there back to the first anchor is traced too where the wire can reach it, which is
	 * exactly the case that matters: closing by clicking near where you started should
	 * follow the boundary round the last few pixels rather than cutting the corner.
	 *
	 * @return The region, or null when too little was traced to enclose anything.
	 */
	close(): Selection | null {
		if ( ! this.field || this.anchors.length < 1 ) {
			return null;
		}

		this.pinLive( true );

		const start = this.traced[ 0 ];
		const closing = this.wire?.pathTo( start.x, start.y );

		if ( closing && closing.length > 2 ) {
			// Both ends are already in `traced`: the first because it is the anchor the
			// closing wire was seeded at, the last because it is the start of the loop.
			this.traced.push( ...closing.slice( 1, -1 ) );
		}

		const points = this.normalise( this.traced );

		return points.length > 2 ? { shape: 'lasso', points } : null;
	}

	/**
	 * The anchors to mark right now.
	 *
	 * Shown because an anchor is the only irreversible thing this tool does while it is
	 * running: everything behind one is fixed for the rest of the trace, and only the
	 * stretch in front of it still moves with the hand. Somebody deciding whether to
	 * click needs to know where the last one landed, and somebody deciding whether to
	 * press Backspace needs to know what it would take back.
	 *
	 * @return Anchors in normalised coordinates, or an empty list when nothing is traced.
	 */
	anchorPoints(): SelectionAnchor[] {
		if ( ! this.field ) {
			return [];
		}

		return this.anchors.map( ( anchor ) => ( {
			point: this.toNormalised( this.traced[ anchor.at ] ),
			manual: anchor.manual,
		} ) );
	}

	/**
	 * The outline to draw right now: everything pinned, plus the live wire.
	 *
	 * @return The outline, or null when there is not enough of it to draw.
	 */
	outline(): Selection | null {
		if ( ! this.field ) {
			return null;
		}

		const points = this.normalise( [ ...this.traced, ...this.live.slice( 1 ) ] );

		return points.length > 1 ? { shape: 'lasso', points } : null;
	}

	/**
	 * Whether a press at a point should be read as "close the loop".
	 *
	 * @param point Canvas coordinates.
	 */
	nearStart( point: Point ): boolean {
		if ( ! this.field || this.anchors.length < 2 ) {
			return false;
		}

		const at = this.toField( point );
		const start = this.traced[ 0 ];

		return Math.hypot( at.x - start.x, at.y - start.y ) <= this.closeWithin;
	}

	/** Abandons the trace and releases the edge field. */
	clear(): void {
		this.field = null;
		this.wire = null;
		this.traced = [];
		this.anchors = [];
		this.live = [];
	}

	/**
	 * Pins whatever the wire is currently showing, ending it on the boundary.
	 *
	 * @param manual Whether a click asked for this.
	 */
	private pinLive( manual: boolean ): void {
		if ( this.live.length < 2 ) {
			return;
		}

		this.pin(
			this.live.slice( 0, this.pinIndex( this.live, this.live.length - 1 ) + 1 ),
			manual
		);
	}

	/**
	 * Where along a wire an anchor may safely be pinned.
	 *
	 * The last stretch of any wire is the hop out to wherever the pointer actually is,
	 * which is off the boundary by however sloppily the user is pointing. Pinning there
	 * is the single most visible way this tool can go wrong: the slop is baked in
	 * permanently, and because the next wire starts from the anchor and has to climb
	 * back onto the boundary, what the user gets is a *spike* out to where their hand
	 * happened to be and straight back again.
	 *
	 * So the anchor goes to the last point that is genuinely on an edge -- the moment
	 * before the wire let go of it -- measured against the strongest edge this particular
	 * wire found rather than against a fixed number, because "strong" on a foggy morning
	 * and "strong" on a studio cut-out are two different quantities. A wire that found no
	 * edge at all is pinned exactly where the spacing rule asked, since there is nothing
	 * better on offer and moving it would only be guessing.
	 *
	 * @param route Wire path.
	 * @param cut   Where the spacing rule wants the anchor.
	 */
	private pinIndex( route: WirePoint[], cut: number ): number {
		const field = this.field as EdgeField;
		const last = Math.min( route.length - 1, cut + SNAP_WINDOW );
		const strength = ( i: number ) =>
			field.strength[ route[ i ].y * field.width + route[ i ].x ];

		let peak = 0;

		for ( let i = 1; i <= last; i++ ) {
			peak = Math.max( peak, strength( i ) );
		}

		if ( peak < MIN_EDGE ) {
			return cut;
		}

		// Backwards, so the anchor is the *furthest* point still on the boundary: every
		// pixel it gives up is a pixel the next wire has to search again.
		for ( let i = last; i >= 1; i-- ) {
			if ( strength( i ) * 2 >= peak ) {
				return i;
			}
		}

		return cut;
	}

	/**
	 * Adds a stretch of traced boundary and reseeds the wire at the end of it.
	 *
	 * @param route  Wire path, starting at the current anchor.
	 * @param manual Whether a click asked for this, rather than the Frequency setting.
	 */
	private pin( route: WirePoint[], manual: boolean ): void {
		const end = route[ route.length - 1 ];

		this.traced.push( ...route.slice( 1 ) );
		this.anchors.push( { at: this.traced.length - 1, manual } );
		this.live = [ end ];
		this.wire?.seed( end.x, end.y, this.reach );
	}

	/**
	 * Field coordinates for a point on the canvas.
	 *
	 * @param point Canvas coordinates.
	 */
	private toField( point: Point ): WirePoint {
		const field = this.field as EdgeField;

		return {
			x: clamp( Math.round( point.x / field.step ), 0, field.width - 1 ),
			y: clamp( Math.round( point.y / field.step ), 0, field.height - 1 ),
		};
	}

	/**
	 * A traced path as normalised vertices, simplified to fit a `Selection`.
	 *
	 * The tolerance is loosened until the path fits rather than the path being
	 * decimated to length: dropping every third vertex of a boundary would spend the
	 * budget evenly over straights and corners, and the corners are the only part of a
	 * traced outline anyone can see.
	 *
	 * @param route Field coordinates.
	 */
	private normalise( route: WirePoint[] ): Point[] {
		let simplified = simplifyPath( route, SIMPLIFY_TOLERANCE );

		for (
			let tolerance = SIMPLIFY_TOLERANCE * 2;
			simplified.length > MAX_LASSO_POINTS && tolerance < 64;
			tolerance *= 2
		) {
			simplified = simplifyPath( route, tolerance );
		}

		return simplified.map( ( at ) => this.toNormalised( at ) );
	}

	/**
	 * One field point as a normalised canvas coordinate.
	 *
	 * Half a field pixel is added, so a vertex sits in the middle of the pixel it names
	 * rather than on its leading corner -- which matters at a stride of four, where the
	 * difference is two document pixels of consistent bias.
	 *
	 * @param at Field coordinates.
	 */
	private toNormalised( at: WirePoint ): Point {
		const { step } = this.field as EdgeField;

		return {
			x: clamp( ( at.x * step + step / 2 ) / this.document.width, 0, 1 ),
			y: clamp( ( at.y * step + step / 2 ) / this.document.height, 0, 1 ),
		};
	}

	/** How many document pixels one screen pixel currently covers. */
	private documentPerScreenPixel(): number {
		const viewport = this.options.getViewport();
		const canvas = this.options.getCanvas();

		if ( ! viewport || viewport.width < 1 || canvas.width < 1 ) {
			return 1;
		}

		return canvas.width / viewport.width;
	}
}

/**
 * How far apart automatic anchors sit, in screen pixels.
 *
 * Inverted, because the setting is a *frequency*: turning it up asks for more anchors,
 * which means less distance between them. The range is deliberately wide -- 4 pixels is
 * one anchor per fingertip of movement, for tracing round a fiddly bit of hair, and 94
 * is one every couple of centimetres, for a long clean edge where anchoring often only
 * bakes in whatever the pointer was doing at the time.
 *
 * @param frequency 0..100 from the options bar.
 */
export function anchorSpacing( frequency: number ): number {
	return 4 + ( 100 - clamp( frequency, 0, 100 ) ) * 0.9;
}

/**
 * Where along a route the next anchor belongs, or -1 when it is still too short.
 *
 * @param route   Wire path.
 * @param spacing How much boundary an anchor covers, in field pixels.
 */
function cutAt( route: WirePoint[], spacing: number ): number {
	let travelled = 0;

	for ( let i = 1; i < route.length; i++ ) {
		travelled += Math.hypot(
			route[ i ].x - route[ i - 1 ].x,
			route[ i ].y - route[ i - 1 ].y
		);

		if ( travelled >= spacing ) {
			return i;
		}
	}

	return -1;
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
