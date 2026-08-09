/**
 * What a press, a move and a close mean while the magnetic lasso is tracing.
 *
 * Separate from `MagneticTrace` because the trace knows about edges and the editor
 * knows about selections, and the two only meet here: these four functions are the
 * whole of that seam, and every one of them is "ask the trace, then tell the overlay".
 */

import { effectiveMode } from '../../model/selection';
import type { Point } from '../../model/selection';
import type { Gesture } from './gesture';
import type { StageToolsOptions } from './types';

/**
 * Starts a trace, pins an anchor, or closes the loop -- whichever the press means.
 *
 * @param options Tool wiring.
 * @param gesture Gesture state, mutated in place.
 * @param point   Canvas coordinates.
 * @param event   Pointer event, for the modifier keys.
 * @return Whether the magnetic lasso took the press. False when there were no pixels to
 *         follow, and the caller should fall back to an ordinary freeform drag.
 */
export function pressMagnetic(
	options: StageToolsOptions,
	gesture: Gesture,
	point: Point,
	event: PointerEvent
): boolean {
	const trace = gesture.magnetic;

	if ( trace.isTracing ) {
		// A press back where the trace started means "close here". Anywhere else pins
		// the wire, which is how you overrule it: click, and the boundary it found up to
		// that point is kept whatever the pointer does next.
		if ( trace.nearStart( point ) ) {
			closeMagnetic( options, gesture );
		} else {
			trace.anchorAt( point );
			show( options, gesture );
		}

		return true;
	}

	// Read once, at the first press, for the same reason every other selection gesture
	// reads it there: the modifier keys are long released by the time a trace is closed.
	gesture.selectionMode = effectiveMode( options.getSelectionMode(), event );

	if ( ! trace.begin( point ) ) {
		return false;
	}

	show( options, gesture );

	return true;
}

/**
 * Draws the trace as it currently stands: the outline, and the anchors under it.
 *
 * One function because the two always change together -- an anchor is pinned by the same
 * move that redraws the wire past it -- and two callers that could forget one of them is
 * how a stale marker ends up left on the canvas.
 *
 * @param options Tool wiring.
 * @param gesture Gesture state.
 */
function show( options: StageToolsOptions, gesture: Gesture ): void {
	options.previewSelection( gesture.magnetic.outline() );
	options.previewAnchors( gesture.magnetic.anchorPoints() );
}

/**
 * Follows the pointer.
 *
 * @param options Tool wiring.
 * @param gesture Gesture state, mutated in place.
 * @param point   Canvas coordinates.
 */
export function moveMagnetic(
	options: StageToolsOptions,
	gesture: Gesture,
	point: Point
): void {
	if ( ! gesture.magnetic.isTracing ) {
		return;
	}

	gesture.magnetic.moveTo( point );
	show( options, gesture );
}

/**
 * Closes the loop and folds it into the selection.
 *
 * @param options Tool wiring.
 * @param gesture Gesture state, mutated in place.
 * @return Whether there was a trace worth closing.
 */
export function closeMagnetic(
	options: StageToolsOptions,
	gesture: Gesture
): boolean {
	if ( ! gesture.magnetic.isTracing ) {
		return false;
	}

	const selection = gesture.magnetic.close();

	gesture.magnetic.clear();
	options.previewSelection( null );
	options.previewAnchors( [] );

	// Even a trace that enclosed nothing is reported as closed: the outline is down and
	// the tool is idle again, which is the thing the caller has to know about.
	if ( selection ) {
		options.commitSelection( selection, gesture.selectionMode );
	}

	return true;
}

/**
 * Takes back the last anchor, or abandons the trace when it was the only one.
 *
 * @param options Tool wiring.
 * @param gesture Gesture state, mutated in place.
 * @return Whether there was a trace to act on.
 */
export function undoMagneticAnchor(
	options: StageToolsOptions,
	gesture: Gesture
): boolean {
	if ( ! gesture.magnetic.isTracing ) {
		return false;
	}

	if ( ! gesture.magnetic.undoAnchor() ) {
		gesture.magnetic.clear();
	}

	show( options, gesture );

	return true;
}
