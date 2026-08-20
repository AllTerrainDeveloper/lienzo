/**
 * Pointer handling for every tool that acts on the canvas.
 *
 * One controller, because they all share one surface and one coordinate conversion.
 * Screen pixels reach the canvas through a single `toCanvas()`, so a brush stroke, a
 * selection rectangle and a gradient ramp cannot disagree about where the pointer is.
 *
 * The tools fall into five families, and each family is a module of its own:
 *
 * - **Stroking** -- brush, eraser, and the retouching tools. A stroke is interpolated
 *   into evenly spaced dabs, so speed does not change the result.
 * - **Dragging a region** -- select, gradient, shape. A dashed preview follows the
 *   drag, and the pixels are only committed on release.
 * - **Clicking a point** -- fill, wand, eyedropper, text, zoom.
 * - **Placing a shape** -- the polygon marquee, the pen path and the magnetic lasso. No
 *   release finishes any of them, so they outlive the drag lifecycle entirely: they are
 *   built press by press and closed with Enter, a double-click, or a press back on the
 *   first vertex.
 * - **Panning** -- hand, which moves the view rather than the pixels.
 *
 * What is left here is the two lifecycles that need the pointer tracked beyond the
 * stage: the drag, and the magnetic trace. Like the transform handles, both listen on
 * `window` -- a release outside the stage must still end a gesture, and a wire must not
 * be lost to a pointer crossing the marquee overlay.
 */

import type { Point } from '../../model/selection';
import { normalise, toCanvas } from './coords';
import { endGesture, newGesture, previewShape } from './gesture';
import type { Gesture } from './gesture';
import {
	closeMagnetic,
	moveMagnetic,
	undoMagneticAnchor,
} from './magnetic-tools';
import { paintPath } from './path-tool';
import { pickColour } from './point-tools';
import { routePress } from './press';
import { commitRegion } from './region-tools';
import { continueStroke, panBy, strokeDab } from './stroke';
import type { StageToolsOptions } from './types';

/**
 * Routes pointer events on the stage to whichever tool is active.
 */
export class StageTools {
	private options: StageToolsOptions;

	private gesture: Gesture;

	/** Whether the pointer is being followed for a magnetic trace. */
	private tracking = false;

	/**
	 * @param options Tool wiring.
	 */
	constructor( options: StageToolsOptions ) {
		this.options = options;
		this.gesture = newGesture( options );

		options.stage.addEventListener( 'pointerdown', this.onPointerDown );
	}

	/** Begins whatever the active tool does. */
	private onPointerDown = ( event: PointerEvent ): void => {
		const tool = this.options.getTool();

		if ( 'transform' === tool || 'crop' === tool ) {
			return;
		}

		if ( 'hand' === tool ) {
			event.preventDefault();
			this.gesture.last = { x: event.clientX, y: event.clientY };
			this.listen();

			return;
		}

		const point = toCanvas( this.options, event );

		if ( ! point ) {
			return;
		}

		event.preventDefault();

		const outcome = routePress( this.options, this.gesture, tool, point, event );

		// A press is the one thing that can both start and finish a magnetic trace, so
		// the pointer tracking it needs is brought into line straight afterwards.
		this.syncMagnetic();

		if ( 'done' === outcome ) {
			return;
		}

		if ( 'stroke' === outcome ) {
			this.gesture.drawing = true;
			this.gesture.last = point;
			this.gesture.stroke.begin( tool );
			strokeDab( this.options, this.gesture, point, tool );
		}

		this.listen();
	};

	/**
	 * Follows the pointer while a magnetic trace is open, and stops when it closes.
	 *
	 * Called after anything that could have started or finished one. Idempotent, so
	 * every caller can simply say "make this match" rather than knowing which of the two
	 * just happened.
	 *
	 * The listener is on `window` rather than on the stage, because a trace is not a
	 * drag: there is no button held, nothing has pointer capture, and a pointer crossing
	 * the marquee overlay or a ruler would otherwise be lost mid-gesture.
	 */
	private syncMagnetic(): void {
		const wanted = this.gesture.magnetic.isTracing;

		if ( wanted === this.tracking ) {
			return;
		}

		this.tracking = wanted;

		if ( wanted ) {
			window.addEventListener( 'pointermove', this.onTraceMove );
			this.options.stage.addEventListener( 'dblclick', this.onTraceDoubleClick );

			return;
		}

		window.removeEventListener( 'pointermove', this.onTraceMove );
		this.options.stage.removeEventListener( 'dblclick', this.onTraceDoubleClick );
	}

	/**
	 * Extends the magnetic wire towards the pointer, while the pointer is on the stage.
	 *
	 * Off it, the wire freezes where it was. Someone reaching for the options bar to
	 * widen the search is not asking the trace to follow them there -- and because a
	 * pointer that gets far enough ahead of the anchor drags it along in straight steps,
	 * a wire that did follow would lay a line across the picture on the way.
	 */
	private onTraceMove = ( event: PointerEvent ): void => {
		const stage = this.options.stage.getBoundingClientRect();

		if (
			event.clientX < stage.left ||
			event.clientX > stage.right ||
			event.clientY < stage.top ||
			event.clientY > stage.bottom
		) {
			return;
		}

		const point = toCanvas( this.options, event );

		if ( point ) {
			moveMagnetic( this.options, this.gesture, point );
		}
	};

	/** Closes a magnetic trace, the way a double-click closes one anywhere else. */
	private onTraceDoubleClick = (): void => {
		this.closeShape();
	};

	/** Starts tracking a drag on the window, so a release anywhere ends it. */
	private listen(): void {
		window.addEventListener( 'pointermove', this.onPointerMove );
		window.addEventListener( 'pointerup', this.onPointerUp );
		window.addEventListener( 'pointercancel', this.onPointerUp );
		window.addEventListener( 'blur', this.onPointerUp );
	}

	/** Continues a stroke, a selection drag, a region drag or a pan. */
	private onPointerMove = ( event: PointerEvent ): void => {
		const tool = this.options.getTool();

		if ( 'hand' === tool ) {
			panBy( this.options, this.gesture, event );

			return;
		}

		const point = toCanvas( this.options, event );

		if ( ! point ) {
			return;
		}

		if ( 'eyedropper' === tool ) {
			// Dragging keeps sampling, which is how you find the exact shade you meant.
			pickColour( this.options, point );

			return;
		}

		if ( this.gesture.dragFrom ) {
			this.gesture.preview.update( event, previewShape( this.options, event ) );

			return;
		}

		if ( this.gesture.selection.isDragging ) {
			this.gesture.pendingSelection = this.gesture.selection.extend(
				normalise( this.options.getCanvas(), point ),
				this.options.getSelectionShape()
			);
			this.options.previewSelection( this.gesture.pendingSelection );

			return;
		}

		continueStroke( this.options, this.gesture, point, tool );
	};

	/** Ends the gesture, committing anything that was only previewed. */
	private onPointerUp = ( event?: Event ): void => {
		window.removeEventListener( 'pointermove', this.onPointerMove );
		window.removeEventListener( 'pointerup', this.onPointerUp );
		window.removeEventListener( 'pointercancel', this.onPointerUp );
		window.removeEventListener( 'blur', this.onPointerUp );

		const wasDrawing = this.gesture.drawing;
		const dragFrom = this.gesture.dragFrom;
		const wasSelecting = this.gesture.selection.isDragging;

		endGesture( this.gesture );

		// The marquee is folded into the selection here rather than on every pointer
		// move: the boolean is a raster round trip, and running one per frame would
		// stall a large document to show what an outline already showed.
		if ( wasSelecting ) {
			this.options.commitSelection(
				this.gesture.pendingSelection,
				this.gesture.selectionMode
			);
			this.gesture.pendingSelection = null;
		}

		if ( dragFrom && event instanceof PointerEvent ) {
			commitRegion( this.options, dragFrom, event );
		}

		if ( wasDrawing ) {
			this.options.onStrokeEnd();
		}
	};

	/** Whether a polygon, a pen path or a magnetic trace is half-placed on the canvas. */
	get hasPath(): boolean {
		return (
			this.gesture.selection.vertices.length > 0 ||
			this.gesture.magnetic.isTracing
		);
	}

	/** Where the clone stamp is currently sampling from, if anywhere. */
	getCloneSource(): Point | null {
		return this.gesture.cloneSource;
	}

	/** Offset from the stroke to the clone sample point, once a stroke fixed one. */
	getCloneOffset(): Point | null {
		return this.gesture.stroke.getCloneOffset();
	}

	/** Forgets the clone sample point. */
	clearCloneSource(): void {
		this.gesture.cloneSource = null;
		this.gesture.stroke.setCloneOffset( null );
		this.options.onToolStateChange?.();
	}

	/**
	 * Paints the placed path with the current colour and style.
	 *
	 * @return Whether anything was drawn.
	 */
	commitPath(): boolean {
		if ( ! paintPath( this.options, this.gesture.selection.vertices ) ) {
			return false;
		}

		this.clearPath();

		return true;
	}

	/**
	 * Closes whatever is being placed click by click, and folds it into the selection.
	 *
	 * A polygon marquee or a magnetic trace. Both are finished by an explicit "done"
	 * rather than by a pointer release, and one method answers for both because the
	 * keyboard, the options bar and a double-click all mean the same thing by it.
	 *
	 * @return Whether there was a shape worth closing.
	 */
	closeShape(): boolean {
		if ( this.gesture.magnetic.isTracing ) {
			const closed = closeMagnetic( this.options, this.gesture );

			this.syncMagnetic();

			return closed;
		}

		const points = this.gesture.selection.vertices;

		// Two points are a line, and a line encloses nothing. Abandoning is the only
		// honest reading of "close this" when there is no shape yet.
		if ( points.length < 3 ) {
			this.clearPath();

			return false;
		}

		this.options.commitSelection(
			{ shape: 'polygon', points: [ ...points ] },
			this.gesture.selectionMode
		);
		this.clearPath();

		return true;
	}

	/**
	 * Takes back the last anchor of a magnetic trace.
	 *
	 * The trace's own undo, and deliberately not the editor's: nothing has been folded
	 * into the selection yet, so there is no history entry to step back through, and
	 * Backspace here has to mean "that anchor was in the wrong place" rather than "undo
	 * whatever I did before I picked up this tool".
	 *
	 * @return Whether there was a trace to act on.
	 */
	undoAnchor(): boolean {
		const acted = undoMagneticAnchor( this.options, this.gesture );

		this.syncMagnetic();

		return acted;
	}

	/** Abandons a half-placed polygon, pen path or magnetic trace, and takes it down. */
	clearPath(): void {
		this.gesture.selection.clear();
		this.gesture.magnetic.clear();
		this.gesture.pendingSelection = null;
		this.options.previewSelection( null );
		this.syncMagnetic();
	}

	/** Removes the listeners. */
	destroy(): void {
		this.onPointerUp();
		this.gesture.magnetic.clear();
		this.syncMagnetic();
		this.gesture.preview.destroy();
		this.options.stage.removeEventListener( 'pointerdown', this.onPointerDown );
	}
}

export type { BrushSettings } from './brush-settings';
export { defaultBrush } from './brush-settings';
export type { StageToolsOptions } from './types';
