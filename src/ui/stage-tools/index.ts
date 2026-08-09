/**
 * Pointer handling for every tool that acts on the canvas.
 *
 * One controller, because they all share one surface and one coordinate conversion.
 * Screen pixels reach the canvas through a single `toCanvas()`, so a brush stroke, a
 * selection rectangle and a gradient ramp cannot disagree about where the pointer is.
 *
 * The tools fall into four families, and each family is a module of its own:
 *
 * - **Stroking** -- brush, eraser, and the retouching tools. A stroke is interpolated
 *   into evenly spaced dabs, so speed does not change the result.
 * - **Dragging a region** -- select, gradient, shape. A dashed preview follows the
 *   drag, and the pixels are only committed on release.
 * - **Clicking a point** -- fill, wand, eyedropper, text, zoom.
 * - **Panning** -- hand, which moves the view rather than the pixels.
 *
 * What is left here is the drag lifecycle: opening one, following it, and closing it.
 * Like the transform handles, drags are tracked on `window` -- a release outside the
 * stage must still end the gesture.
 */

import type { Point } from '../../model/selection';
import { normalise, toCanvas } from './coords';
import { endGesture, newGesture, previewShape } from './gesture';
import type { Gesture } from './gesture';
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

	/** Whether a polygon or a pen path is half-placed on the canvas. */
	get hasPath(): boolean {
		return this.gesture.selection.vertices.length > 0;
	}

	/** Where the clone stamp is currently sampling from, if anywhere. */
	getCloneSource(): Point | null {
		return this.gesture.cloneSource;
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
	 * Closes a polygon marquee and folds it into the selection.
	 *
	 * @return Whether there was a polygon worth closing.
	 */
	closePolygon(): boolean {
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

	/** Abandons a half-placed polygon or pen path, and takes its outline down. */
	clearPath(): void {
		this.gesture.selection.clear();
		this.gesture.pendingSelection = null;
		this.options.previewSelection( null );
	}

	/** Removes the listeners. */
	destroy(): void {
		this.onPointerUp();
		this.gesture.preview.destroy();
		this.options.stage.removeEventListener( 'pointerdown', this.onPointerDown );
	}
}

export type { BrushSettings } from './brush-settings';
export { defaultBrush } from './brush-settings';
export type { StageToolsOptions } from './types';
