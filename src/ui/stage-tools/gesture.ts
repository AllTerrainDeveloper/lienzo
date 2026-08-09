/**
 * The state of the gesture in progress.
 *
 * A plain mutable record rather than fields on the controller, so the press router and
 * the drag lifecycle can each be read -- and exercised -- without a stage, a pointer or
 * a renderer. Everything here is reset by the end of a gesture except the clone sample
 * point, which deliberately outlives one: it is set once with Alt-click and reused by
 * every stroke after it.
 */

import type { Point, Selection, SelectionMode } from '../../model/selection';
import { DragPreview } from './drag-preview';
import { PixelStroke } from './pixel-stroke';
import { SelectionGesture } from './selection-gesture';
import type { StageToolsOptions } from './types';

/** Everything a gesture carries while it is happening. */
export interface Gesture {
	/** The marquee being drawn, and the vertices placed so far. */
	selection: SelectionGesture;
	/** The dashed outline shown while dragging a region out. */
	preview: DragPreview;
	/** The retouching stroke in progress. */
	stroke: PixelStroke;
	/** Whether a paint stroke is being laid down. */
	drawing: boolean;
	/** Last pointer position, in whichever space the active gesture works in. */
	last: Point | null;
	/** Where a region drag began, in canvas pixels. Null when not dragging one. */
	dragFrom: Point | null;
	/** Where the clone stamp samples from, in canvas pixels. */
	cloneSource: Point | null;
	/**
	 * What the region being drawn will do to the selection already in place.
	 *
	 * Fixed when the gesture starts rather than read when it ends, because the modifier
	 * keys that reach a mode without the picker are usually let go of before the mouse
	 * button is -- and a subtraction that turned into a replacement on release would be
	 * the single most destructive bug this tool could have.
	 */
	selectionMode: SelectionMode;
	/** The region drawn so far, waiting to be folded in on release. */
	pendingSelection: Selection | null;
}

/**
 * Builds an idle gesture.
 *
 * @param options Tool wiring.
 */
export function newGesture( options: StageToolsOptions ): Gesture {
	return {
		selection: new SelectionGesture(),
		preview: new DragPreview( options.stage ),
		stroke: new PixelStroke( options ),
		drawing: false,
		last: null,
		dragFrom: null,
		cloneSource: null,
		selectionMode: 'new',
		pendingSelection: null,
	};
}

/**
 * Clears everything one gesture owned, leaving the clone sample point alone.
 *
 * The region drawn is deliberately *not* cleared here: a marquee is folded into the
 * selection after the drag lifecycle closes, and forgetting it first would commit
 * nothing. `StageTools` reads it and clears it itself.
 *
 * @param gesture Gesture to reset.
 */
export function endGesture( gesture: Gesture ): void {
	gesture.drawing = false;
	gesture.last = null;
	gesture.dragFrom = null;
	gesture.selection.endDrag();
	gesture.stroke.reset();
	gesture.preview.hide();
}

/**
 * What the drag outline should look like right now.
 *
 * @param options Tool wiring.
 * @param event   Pointer event, for the modifier keys.
 */
export function previewShape( options: StageToolsOptions, event: PointerEvent ) {
	return {
		tool: options.getTool(),
		shapeKind: options.getBrush().shapeKind,
		square: event.shiftKey,
	};
}
