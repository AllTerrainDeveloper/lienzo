/**
 * What a brush stroke is made of.
 */

export type { BrushShape } from './stamp';
export { BRUSH_SHAPES, brushStamp, clearBrushCache } from './stamp';
export { STAMP_SPACING, interpolateStroke } from './stroke';
export { floodFillMask, floodFillRegion, regionToCanvas } from './flood-fill';
export type { FloodRegion, RegionBounds } from './flood-fill';
