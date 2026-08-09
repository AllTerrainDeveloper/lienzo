/**
 * The settings every drawing tool shares.
 *
 * Its own module because half the editor reads this type and almost none of it needs
 * the pointer controller that happens to consume it. Importing `BrushSettings` used to
 * drag in Pixi, the paint shapes and the whole selection model with it.
 */

import type { BrushShape } from '../../engine/brush';
import type { GradientKind, ShapeKind, ShapeStyle } from '../../engine/paint-shapes';
import type { PixelOp } from '../../engine/pixel-tools';

/**
 * Everything the drawing tools need to know about themselves.
 *
 * One object rather than one per tool: the settings overlap heavily -- size, opacity
 * and colour belong to almost all of them -- and a single object means the options bar
 * and the sidebar panel are two views of one model rather than nine.
 */
export interface BrushSettings {
	shape: BrushShape;
	/** Diameter in canvas pixels. */
	size: number;
	/** Edge falloff, 0..1. */
	hardness: number;
	/** Stroke opacity, 0..1. */
	opacity: number;
	/** The foreground colour: what brushes, fills, shapes and text paint with. */
	colour: string;
	/** The background colour: the far end of a gradient, and what X swaps to. */
	background: string;
	/** Flood fill match tolerance, 0..255. */
	tolerance: number;
	/**
	 * How far the magnetic lasso looks for an edge, in *screen* pixels.
	 *
	 * Screen rather than document pixels, here and for the frequency below, because both
	 * describe how precisely someone is pointing -- and that is a fact about the picture
	 * on the monitor rather than about the file behind it. The conversion happens once,
	 * when a trace begins.
	 */
	magneticWidth: number;
	/** How strong an edge has to be before the magnetic lasso will follow it, 0..100. */
	magneticContrast: number;
	/**
	 * How often the magnetic lasso pins an anchor, 0..100. Higher means more often.
	 *
	 * Zero does not quite mean never -- the search has to stay near the pointer somehow --
	 * but it is close enough to read as "I will place them myself".
	 */
	magneticFrequency: number;
	/** Which pixel operation the retouch tool performs. */
	retouch: PixelOp;
	/** Which pixel operation the dodge/burn tool performs. */
	tone: PixelOp;
	/** How hard the retouching tools bite, 0..1. */
	strength: number;
	/** Linear or radial, for the gradient tool. */
	gradient: GradientKind;
	/** Whether the gradient ends transparent rather than at the background colour. */
	gradientFade: boolean;
	/** What the shape tool draws. */
	shapeKind: ShapeKind;
	/** Whether shapes are filled or outlined. */
	shapeStyle: ShapeStyle;
	/** Outline width in canvas pixels. */
	strokeWidth: number;
	/** Text size in canvas pixels. */
	fontSize: number;
	fontFamily: string;
	bold: boolean;
	italic: boolean;
}

/**
 * The settings a freshly opened editor starts with.
 *
 * A factory rather than a shared constant, because every editor instance owns its own
 * copy and handing them all the same object would let two windows fight over one brush.
 */
export function defaultBrush(): BrushSettings {
	return {
		shape: 'soft',
		size: 40,
		hardness: 0.6,
		opacity: 1,
		colour: '#000000',
		background: '#ffffff',
		tolerance: 32,
		magneticWidth: 20,
		magneticContrast: 10,
		// Below Photoshop's 57, deliberately. An anchor is permanent, and the stretch
		// between the last one and the pointer is the part still being reconsidered --
		// so the default errs towards leaving more of the trace live and letting a click
		// be what commits it.
		magneticFrequency: 40,
		retouch: 'blur',
		tone: 'dodge',
		strength: 0.5,
		gradient: 'linear',
		gradientFade: false,
		shapeKind: 'rect',
		shapeStyle: 'fill',
		strokeWidth: 4,
		fontSize: 72,
		fontFamily: 'system-ui, sans-serif',
		bold: false,
		italic: false,
	};
}
