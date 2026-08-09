/**
 * What a selection is.
 *
 * A closed path in normalised canvas coordinates, whatever shape drew it. Storing
 * every shape as a path rather than as a rectangle-plus-a-kind is what lets one mask
 * builder, one outline renderer and one clipping routine serve all four tools -- and
 * it is the mask that matters, because painting has to be confined to the selected
 * pixels rather than merely started inside them.
 */

/** A point in normalised 0..1 canvas coordinates. */
export interface Point {
	x: number;
	y: number;
}

/** How a selection was drawn. */
export type SelectionShape =
	| 'rect'
	| 'ellipse'
	| 'lasso'
	| 'polygon'
	| 'magnetic';

/** The shapes on offer, in picker order. */
export const SELECTION_SHAPES: Array< { value: SelectionShape; label: string } > = [
	{ value: 'rect', label: 'Rectangle' },
	{ value: 'ellipse', label: 'Ellipse' },
	{ value: 'lasso', label: 'Freeform' },
	{ value: 'polygon', label: 'Polygon' },
	{ value: 'magnetic', label: 'Magnetic' },
];

/**
 * The shapes that are placed and closed rather than dragged out.
 *
 * A polygon is finished with Enter or by clicking its first vertex; so is a magnetic
 * trace. Neither has a pointer release that means "done", which is what separates them
 * from every other shape -- so the shortcut table, the options bar hint and the press
 * router all need the same answer, and get it from here.
 *
 * @param shape Shape the marquee tool is drawing.
 */
export function isPlacedShape( shape: SelectionShape ): boolean {
	return 'polygon' === shape || 'magnetic' === shape;
}

/**
 * What a newly drawn region does to the selection that is already there.
 *
 * The distinction every raster editor makes, and the reason a selection tool is a tool
 * rather than a gesture: the shapes anyone actually wants are almost never one
 * rectangle. A subject is a wand click plus two lasso corrections; a vignette mask is an
 * ellipse minus a smaller one. Without these, each of those is a redraw from scratch.
 */
export type SelectionMode = 'new' | 'add' | 'subtract' | 'intersect';

/** A mode, as the picker presents it. */
export interface SelectionModeDef {
	value: SelectionMode;
	/** Accessible name. */
	label: string;
	/**
	 * The glyph on the button.
	 *
	 * One square family throughout, so the four read as one control: an empty square
	 * replaces, plus and minus add and take away, and the square with a core is the
	 * part two regions share.
	 */
	glyph: string;
	/** Tooltip, naming the modifier that reaches the mode without the picker. */
	title: string;
}

/** The modes on offer, in picker order -- the same order Photoshop has used since 3.0. */
export const SELECTION_MODES: SelectionModeDef[] = [
	{ value: 'new', label: 'New selection', glyph: '◻', title: 'New selection' },
	{ value: 'add', label: 'Add', glyph: '⊞', title: 'Add to selection (Shift)' },
	{
		value: 'subtract',
		label: 'Subtract',
		glyph: '⊟',
		title: 'Subtract from selection (Alt)',
	},
	{
		value: 'intersect',
		label: 'Intersect',
		glyph: '▣',
		title: 'Intersect with selection (Shift+Alt)',
	},
];

/**
 * The mode a gesture actually runs in, once its modifier keys are read.
 *
 * Held modifiers win over the picker, and are forgotten as soon as the gesture ends --
 * that is what makes "one quick subtraction" cost a keypress rather than two trips to
 * the options bar. The combination is the one every editor uses, so the muscle memory
 * transfers.
 *
 * @param mode      Mode chosen in the options bar.
 * @param modifiers Modifier keys held when the gesture began.
 */
export function effectiveMode(
	mode: SelectionMode,
	modifiers: { shiftKey: boolean; altKey: boolean }
): SelectionMode {
	if ( modifiers.shiftKey && modifiers.altKey ) {
		return 'intersect';
	}

	if ( modifiers.shiftKey ) {
		return 'add';
	}

	if ( modifiers.altKey ) {
		return 'subtract';
	}

	return mode;
}

/**
 * A point the magnetic lasso has committed to.
 *
 * Worth showing, and worth distinguishing, because the two kinds mean different things.
 * Everything behind an anchor is fixed for the rest of the trace; only the stretch
 * between the last one and the pointer is still being reconsidered. So an anchor is not
 * decoration -- it is the boundary between the part you can still change by moving your
 * hand and the part you can only change with Backspace.
 */
export interface SelectionAnchor {
	point: Point;
	/** Whether a click put it there, rather than the Frequency setting. */
	manual: boolean;
}

/** A selected region. */
export interface Selection {
	shape: SelectionShape;
	/**
	 * The path.
	 *
	 * For `rect` and `ellipse` these are two opposite corners of the bounding box.
	 * For `lasso` and `polygon` they are the vertices, implicitly closed.
	 */
	points: Point[];
	/**
	 * Inner boundaries cut out of that path.
	 *
	 * Only the magic wand produces them -- a drag has one outline by definition -- and
	 * they are what stops a wand selection of a region with holes from selecting
	 * through them. Each is a closed path like `points`, and they are filled *even-odd*
	 * together with it: a loop inside the outline is a hole, and a loop inside that is
	 * solid again, to any depth. Absent on every hand-drawn selection.
	 */
	holes?: Point[][];
}

/** How many points a lasso keeps; enough for a smooth outline, few enough to stay fast. */
export const MAX_LASSO_POINTS = 600;
