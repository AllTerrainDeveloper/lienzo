/**
 * The interactive tone curve.
 *
 * A 256x256 graph: input level along the x axis, output level up the y axis, with
 * draggable control points. Drawn on a canvas rather than as DOM, because the
 * curve between the points is a sampled polyline and 256 elements would be absurd.
 *
 * The curve maths lives in `src/engine/lut.ts` and is shared with the renderer, so
 * the line drawn here is literally the function the GPU will apply -- not an
 * approximation of it.
 */

import { sampleCurve } from '../engine/lut';
import type { CurvePoint } from '../engine/lut';
import { __ } from '../i18n';

/** How close a click must be to grab an existing point, in graph units. */
const GRAB_RADIUS = 12;

/** Beyond this, a drag out of the graph deletes the point instead. */
const DELETE_DISTANCE = 40;

/**
 * Whether an event is one a pointer sent.
 *
 * By shape rather than by `instanceof PointerEvent`, which is a global that not every
 * environment running this code defines -- and `instanceof` against a missing global
 * throws rather than answering false, so the guard would be worse than no guard.
 *
 * @param event Event to test, if there is one.
 */
function isPointerEvent( event?: Event ): event is PointerEvent {
	return !! event && 'pointerId' in event;
}

export interface CurveEditorOptions {
	/** Current control points. */
	getPoints: () => CurvePoint[];
	/** Fires continuously while dragging. */
	onChange: ( points: CurvePoint[] ) => void;
	/** Fires once a drag finishes. */
	onCommit: () => void;
}

/**
 * A draggable tone curve graph.
 */
export class CurveEditor {
	public readonly el: HTMLElement;

	private canvas: HTMLCanvasElement;

	private ctx: CanvasRenderingContext2D | null;

	private options: CurveEditorOptions;

	private dragIndex = -1;

	/**
	 * Which pointer owns the drag.
	 *
	 * The move and release are tracked on `window`, which hears every pointer on the
	 * page -- so a second finger, or a mouse moving while a pen is down, would otherwise
	 * drive a point it never grabbed.
	 */
	private dragPointer = -1;

	/**
	 * Where the drag last was, in graph units.
	 *
	 * Kept because a drag does not always end with coordinates. A cancelled gesture and
	 * a window losing focus both have to finish the drag, and neither carries a
	 * position -- so the flick-to-delete test reads the last place the pointer actually
	 * was rather than the place the ending event claims it is.
	 */
	private dragAt = { x: 0, y: 0 };

	private resizeObserver: ResizeObserver | null = null;

	constructor( options: CurveEditorOptions ) {
		this.options = options;

		this.el = document.createElement( 'div' );
		this.el.className = 'lz-curve';

		this.canvas = document.createElement( 'canvas' );
		this.canvas.className = 'lz-curve__canvas';
		this.canvas.setAttribute( 'role', 'img' );
		this.canvas.setAttribute(
			'aria-label',
			__( 'Tone curve. Drag to add or move control points.' )
		);
		this.canvas.tabIndex = 0;

		this.el.appendChild( this.canvas );
		this.ctx = this.canvas.getContext( '2d' );

		this.canvas.addEventListener( 'pointerdown', this.onPointerDown );
		this.canvas.addEventListener( 'dblclick', this.onDoubleClick );

		if ( typeof ResizeObserver !== 'undefined' ) {
			this.resizeObserver = new ResizeObserver( () => this.draw() );
			this.resizeObserver.observe( this.el );
		}

		this.draw();
	}

	/** Re-renders from the model. */
	sync = (): void => this.draw();

	/** Converts a pointer event into graph coordinates, 0..255 with y up. */
	private toGraph( event: PointerEvent | MouseEvent ): { x: number; y: number } {
		const rect = this.canvas.getBoundingClientRect();

		return {
			x: ( ( event.clientX - rect.left ) / rect.width ) * 255,
			y: ( 1 - ( event.clientY - rect.top ) / rect.height ) * 255,
		};
	}

	/**
	 * Grabs an existing point, or inserts a new one.
	 */
	private onPointerDown = ( event: PointerEvent ): void => {
		const points = [ ...this.options.getPoints() ];
		const at = this.toGraph( event );

		let index = points.findIndex(
			( [ px, py ] ) => Math.hypot( px - at.x, py - at.y ) < GRAB_RADIUS
		);

		if ( index === -1 ) {
			points.push( [ at.x, at.y ] );
			points.sort( ( a, b ) => a[ 0 ] - b[ 0 ] );
			index = points.findIndex( ( p ) => p[ 0 ] === at.x && p[ 1 ] === at.y );
			this.options.onChange( points );
		}

		this.dragIndex = index;
		this.dragPointer = event.pointerId;
		this.dragAt = at;

		// Capture keeps the cursor and the text selection sane while the pointer is
		// outside the graph. It is not what makes the release arrive -- `window` is --
		// because capture can be lost without warning, and every way of losing it ends
		// with a point that follows the mouse forever.
		try {
			this.canvas.setPointerCapture( event.pointerId );
		} catch {
			// A pointer that has already gone. The window listeners still finish the job.
		}

		this.listen();
		event.preventDefault();

		this.draw();
	};

	/**
	 * Tracks the drag on the window, so a release anywhere ends it.
	 *
	 * The same rule the stage tools follow, and for the same reason: these listeners
	 * used to be on the canvas, so letting go outside the graph left the point grabbed
	 * and following the mouse with no button held. `pointercancel` and `blur` are here
	 * too -- a gesture the browser takes over, or a window that loses focus mid-drag,
	 * are both ways a `pointerup` never comes.
	 */
	private listen(): void {
		window.addEventListener( 'pointermove', this.onPointerMove );
		window.addEventListener( 'pointerup', this.onPointerUp );
		window.addEventListener( 'pointercancel', this.onPointerUp );
		window.addEventListener( 'blur', this.onPointerUp );
	}

	/** Stops tracking. Safe to call when nothing is being tracked. */
	private release(): void {
		window.removeEventListener( 'pointermove', this.onPointerMove );
		window.removeEventListener( 'pointerup', this.onPointerUp );
		window.removeEventListener( 'pointercancel', this.onPointerUp );
		window.removeEventListener( 'blur', this.onPointerUp );
	}

	/** Moves the grabbed point. */
	private onPointerMove = ( event: PointerEvent ): void => {
		if ( this.dragIndex < 0 || event.pointerId !== this.dragPointer ) {
			return;
		}

		const points = this.options.getPoints().map( ( p ) => [ ...p ] as CurvePoint );

		if ( ! points[ this.dragIndex ] ) {
			return;
		}

		const at = this.toGraph( event );

		this.dragAt = at;

		// Endpoints keep their x. Letting the black point slide inwards would
		// silently clip the shadows, which is what the Levels control is for.
		const isEndpoint =
			this.dragIndex === 0 || this.dragIndex === points.length - 1;

		points[ this.dragIndex ] = [
			isEndpoint ? points[ this.dragIndex ][ 0 ] : at.x,
			at.y,
		];

		this.options.onChange( points );
		this.draw();
	};

	/**
	 * Drops the point, deleting it if it was dragged well outside the graph.
	 *
	 * Takes any event, or none: a release, a cancelled gesture and a lost window focus
	 * all end the drag, and only the first of them is a `PointerEvent`. Idempotent, so
	 * two of them arriving cannot delete a second point.
	 *
	 * @param event The event that ended the drag, if there was one.
	 */
	private onPointerUp = ( event?: Event ): void => {
		if ( this.dragIndex < 0 ) {
			return;
		}

		if (
			isPointerEvent( event ) &&
			-1 !== this.dragPointer &&
			event.pointerId !== this.dragPointer
		) {
			return;
		}

		const points = this.options.getPoints().map( ( p ) => [ ...p ] as CurvePoint );
		const index = this.dragIndex;

		this.dragIndex = -1;
		this.release();

		if ( isPointerEvent( event ) ) {
			try {
				this.canvas.releasePointerCapture?.( event.pointerId );
			} catch {
				// Never captured, or already let go. Nothing to release either way.
			}
		}

		this.dragPointer = -1;

		// The last place the pointer actually was, not wherever the ending event says
		// it is -- a cancel or a blur says nothing at all.
		const at = this.dragAt;
		const outside =
			at.x < -DELETE_DISTANCE ||
			at.x > 255 + DELETE_DISTANCE ||
			at.y < -DELETE_DISTANCE ||
			at.y > 255 + DELETE_DISTANCE;

		// Flicking a point away is how every curve editor deletes one -- but the two
		// endpoints define the curve's domain and cannot go.
		if ( outside && index > 0 && index < points.length - 1 ) {
			points.splice( index, 1 );
			this.options.onChange( points );
		}

		this.options.onCommit();
		this.draw();
	};

	/** Resets the curve to a straight line. */
	private onDoubleClick = ( event: MouseEvent ): void => {
		event.preventDefault();

		this.options.onChange( [
			[ 0, 0 ],
			[ 255, 255 ],
		] );
		this.options.onCommit();
		this.draw();
	};

	/** Paints the grid, the curve and its control points. */
	private draw(): void {
		if ( ! this.ctx ) {
			return;
		}

		const dpr = window.devicePixelRatio || 1;
		const rect = this.el.getBoundingClientRect();
		const size = Math.max( 1, Math.round( Math.min( rect.width, rect.width ) ) );

		if ( this.canvas.width !== size * dpr ) {
			this.canvas.width = size * dpr;
			this.canvas.height = size * dpr;
			this.canvas.style.width = `${ size }px`;
			this.canvas.style.height = `${ size }px`;
		}

		const ctx = this.ctx;
		ctx.setTransform( dpr, 0, 0, dpr, 0, 0 );
		ctx.clearRect( 0, 0, size, size );

		const toCanvas = ( x: number, y: number ) => ( {
			cx: ( x / 255 ) * size,
			cy: ( 1 - y / 255 ) * size,
		} );

		ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
		ctx.lineWidth = 1;

		for ( let i = 1; i < 4; i++ ) {
			const at = ( i / 4 ) * size;

			ctx.beginPath();
			ctx.moveTo( at, 0 );
			ctx.lineTo( at, size );
			ctx.moveTo( 0, at );
			ctx.lineTo( size, at );
			ctx.stroke();
		}

		// The no-op diagonal, for reference.
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
		ctx.beginPath();
		ctx.moveTo( 0, size );
		ctx.lineTo( size, 0 );
		ctx.stroke();

		const points = this.options.getPoints();
		const sampled = sampleCurve( points );

		ctx.strokeStyle = '#f0f0f1';
		ctx.lineWidth = 1.5;
		ctx.beginPath();

		for ( let x = 0; x < 256; x++ ) {
			const { cx, cy } = toCanvas( x, sampled[ x ] );

			if ( x === 0 ) {
				ctx.moveTo( cx, cy );
			} else {
				ctx.lineTo( cx, cy );
			}
		}

		ctx.stroke();

		points.forEach( ( [ x, y ], index ) => {
			const { cx, cy } = toCanvas( x, y );

			ctx.beginPath();
			ctx.arc( cx, cy, index === this.dragIndex ? 5 : 3.5, 0, Math.PI * 2 );
			ctx.fillStyle = index === this.dragIndex ? '#3582c4' : '#f0f0f1';
			ctx.fill();
		} );
	}

	/** Releases listeners, including a drag still in progress. */
	destroy(): void {
		this.dragIndex = -1;
		this.dragPointer = -1;
		this.release();
		this.resizeObserver?.disconnect();
		this.canvas.removeEventListener( 'pointerdown', this.onPointerDown );
		this.canvas.removeEventListener( 'dblclick', this.onDoubleClick );
	}
}
