/**
 * The marquee.
 *
 * Pure geometry plus one canvas rasteriser, so most of it is unit-testable.
 */

export type {
	Point,
	Selection,
	SelectionAnchor,
	SelectionMode,
	SelectionModeDef,
	SelectionShape,
} from './types';
export {
	effectiveMode,
	isPlacedShape,
	MAX_LASSO_POINTS,
	SELECTION_MODES,
	SELECTION_SHAPES,
} from './types';

export { combineSelections } from './combine';
export { isEmptySelection, selectionBounds } from './bounds';
export {
	anchorMarks,
	appendPathPoint,
	selectionFromDrag,
	selectionToPath,
	simplifyPath,
} from './path';
export { buildSelectionMask, clipToSelection } from './mask';
export { traceMask } from './trace';
export type { TraceableMask, TracedRegion } from './trace';
