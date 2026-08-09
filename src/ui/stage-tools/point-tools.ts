/**
 * The tools that act on a single click rather than a drag.
 *
 * Eyedropper, paint bucket, magic wand and zoom. All four read the *composed*
 * document rather than the target layer, because that is what the user can see --
 * matching against an invisible layer's contents would look arbitrary.
 */

import { floodFillMask, floodFillRegion } from '../../engine/brush';
import type { FloodRegion } from '../../engine/brush';
import { rgbToHex } from '../../engine/paint-shapes';
import { effectiveMode, traceMask } from '../../model/selection';
import type { Point } from '../../model/selection';
import { toStage } from './coords';
import type { StageToolsOptions } from './types';

/**
 * Samples the colour under the pointer into the foreground.
 *
 * @param options Tool wiring.
 * @param point   Canvas coordinates.
 */
export function pickColour( options: StageToolsOptions, point: Point ): void {
	const source = options.readDocument();

	if ( ! source ) {
		return;
	}

	const x = Math.round( point.x );
	const y = Math.round( point.y );

	if ( x < 0 || y < 0 || x >= source.width || y >= source.height ) {
		return;
	}

	const index = ( y * source.width + x ) * 4;

	options.setBrush( {
		colour: rgbToHex(
			source.pixels[ index ],
			source.pixels[ index + 1 ],
			source.pixels[ index + 2 ]
		),
	} );
}

/**
 * Zooms in, or out with Alt held.
 *
 * @param options Tool wiring.
 * @param event   Pointer event, positioned within the stage.
 */
export function zoomAtPointer(
	options: StageToolsOptions,
	event: PointerEvent
): void {
	const at = toStage( options.stage, event );

	// Alt inverts, as it does in every editor that has this tool.
	options.zoomAt( event.altKey ? 1 / 1.4 : 1.4, at.x, at.y );
}

/**
 * The contiguous region matching the colour under the pointer.
 *
 * @param options Tool wiring.
 * @param point   Canvas coordinates.
 * @return The matched region, or null when nothing matched.
 */
function matchRegion( options: StageToolsOptions, point: Point ): FloodRegion | null {
	const source = options.readDocument();

	if ( ! source ) {
		return null;
	}

	return floodFillRegion(
		source.pixels,
		source.width,
		source.height,
		point.x,
		point.y,
		options.getBrush().tolerance
	);
}

/**
 * Floods the region matching the colour under the pointer.
 *
 * The bitmap covers the pixels the fill reached rather than the whole document, and is
 * placed at its own origin. On a twenty-megapixel photograph, filling one object used
 * to allocate and upload eighty megabytes to carry a few thousand pixels.
 *
 * @param options Tool wiring.
 * @param point   Canvas coordinates.
 */
export function floodFill( options: StageToolsOptions, point: Point ): void {
	const source = options.readDocument();

	if ( ! source ) {
		return;
	}

	const filled = floodFillMask(
		source.pixels,
		source.width,
		source.height,
		point.x,
		point.y,
		options.getBrush().tolerance
	);

	if ( ! filled ) {
		return;
	}

	const brush = options.getBrush();

	options.fillMask(
		options.getTargetLayerId(),
		filled.mask,
		brush.colour,
		brush.opacity,
		filled.region.bounds
	);
	options.onStrokeEnd();
}

/**
 * Selects the contiguous region matching the colour under the pointer.
 *
 * The same flood fill the paint bucket uses, traced into paths -- which is the whole
 * reason the wand was cheap to add. The region is traced directly, without ever being
 * drawn to a canvas and read back: it is already one byte per pixel, and reading a
 * twenty-megapixel canvas back is the most expensive thing this tool could do.
 *
 * The wand is where the boolean modes earn their keep: no single tolerance picks out a
 * whole subject, but three clicks with Shift held very often do.
 *
 * @param options Tool wiring.
 * @param point   Canvas coordinates.
 * @param event   Pointer event, for the modifier keys.
 */
export function magicWand(
	options: StageToolsOptions,
	point: Point,
	event: PointerEvent
): void {
	const region = matchRegion( options, point );

	if ( ! region ) {
		return;
	}

	const traced = traceMask( {
		data: region.state,
		width: region.width,
		height: region.height,
		bounds: region.bounds,
	} );

	options.commitSelection(
		traced.outer.length > 2
			? { shape: 'lasso', points: traced.outer, holes: traced.holes }
			: null,
		effectiveMode( options.getSelectionMode(), event )
	);
}
