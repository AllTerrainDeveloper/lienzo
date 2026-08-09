/**
 * What a pointer press means, tool by tool.
 *
 * Three outcomes, and the difference matters: some tools finish on the press itself
 * (fill, wand, zoom, text), some open a drag that has to be tracked (select, gradient,
 * shape, eyedropper), and the rest begin a paint stroke. Returning which one happened
 * keeps the drag lifecycle out of the routing table.
 */

import { normalise } from './coords';
import { previewShape } from './gesture';
import type { Gesture } from './gesture';
import { floodFill, magicWand, pickColour, zoomAtPointer } from './point-tools';
import { effectiveMode } from '../../model/selection';
import type { Point } from '../../model/selection';
import type { ActiveTool } from '../panels';
import type { StageToolsOptions } from './types';

/**
 * What the controller should do after a press.
 *
 * - `done` -- the tool finished; nothing to track.
 * - `drag` -- a gesture opened; track the pointer until it is released.
 * - `stroke` -- begin a paint stroke at this point, then track.
 */
export type PressOutcome = 'done' | 'drag' | 'stroke';

/**
 * Runs whatever the active tool does on a press.
 *
 * @param options Tool wiring.
 * @param gesture Gesture state, mutated in place.
 * @param tool    Active tool.
 * @param point   Canvas coordinates.
 * @param event   Pointer event.
 */
export function routePress(
	options: StageToolsOptions,
	gesture: Gesture,
	tool: ActiveTool,
	point: Point,
	event: PointerEvent
): PressOutcome {
	const norm = () => normalise( options.getCanvas(), point );

	switch ( tool ) {
		case 'zoom':
			zoomAtPointer( options, event );

			return 'done';

		case 'fill':
			floodFill( options, point );

			return 'done';

		case 'wand':
			magicWand( options, point, event );

			return 'done';

		case 'text':
			options.onPlaceText( point );

			return 'done';

		case 'path':
			// Vertices are placed deliberately, one click at a time, and the shape is
			// only drawn once the path is closed -- so no drag lifecycle at all. A pen
			// path is previewed rather than selected: it is a shape on its way to being
			// painted, and letting it stand in for the marquee threw away whatever was
			// selected the moment anyone reached for the tool.
			options.previewSelection( gesture.selection.addVertex( norm() ) );

			return 'done';

		case 'eyedropper':
			pickColour( options, point );
			gesture.last = point;

			return 'drag';

		case 'select':
			return beginSelection( options, gesture, norm(), event );

		case 'gradient':
		case 'shape':
			gesture.dragFrom = point;
			gesture.preview.start( event, previewShape( options, event ) );

			return 'drag';

		case 'clone':
			return routeClonePress( options, gesture, point, event );

		default:
			return 'stroke';
	}
}

/**
 * Opens a marquee, in whichever mode the picker and the modifier keys agree on.
 *
 * A polygon is placed click by click and is only folded in when it closes, so it never
 * enters the drag lifecycle -- but the *first* click still decides its mode, for the same
 * reason a drag's press does: by the time the shape is finished the keys are long
 * released.
 *
 * @param options Tool wiring.
 * @param gesture Gesture state, mutated in place.
 * @param point   Normalised coordinates.
 * @param event   Pointer event, for the modifier keys.
 */
function beginSelection(
	options: StageToolsOptions,
	gesture: Gesture,
	point: Point,
	event: PointerEvent
): PressOutcome {
	const shape = options.getSelectionShape();
	const starting =
		'polygon' !== shape || 0 === gesture.selection.vertices.length;

	if ( starting ) {
		gesture.selectionMode = effectiveMode( options.getSelectionMode(), event );
	}

	gesture.pendingSelection = gesture.selection.begin( point, shape );
	options.previewSelection( gesture.pendingSelection );

	// A polygon is finished with Enter, not with a release, so there is no drag to
	// follow -- every click is a press of its own.
	return 'polygon' === shape ? 'done' : 'drag';
}

/**
 * Sets or uses the clone stamp's sample point.
 *
 * @param options Tool wiring.
 * @param gesture Gesture state, mutated in place.
 * @param point   Canvas coordinates.
 * @param event   Pointer event.
 */
function routeClonePress(
	options: StageToolsOptions,
	gesture: Gesture,
	point: Point,
	event: PointerEvent
): PressOutcome {
	if ( event.altKey ) {
		// Alt-click sets the sample point, exactly as the clone stamp has worked since
		// Photoshop 3. Without it the tool has nothing to copy.
		gesture.cloneSource = point;
		gesture.stroke.setCloneOffset( null );
		options.onToolStateChange?.();

		return 'done';
	}

	if ( ! gesture.cloneSource ) {
		return 'done';
	}

	gesture.stroke.setCloneOffset( {
		x: point.x - gesture.cloneSource.x,
		y: point.y - gesture.cloneSource.y,
	} );

	return 'stroke';
}
