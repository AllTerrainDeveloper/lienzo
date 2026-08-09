/**
 * The magnetic lasso's engine.
 *
 * Two halves, and the split is the design: `edge-field.ts` decides once, per document,
 * where the boundaries are, and `live-wire.ts` answers, thousands of times per gesture,
 * how to get from an anchor to the pointer along them. The first is a convolution and
 * costs what a convolution costs; the second has to run inside a frame, and can, only
 * because the first one already happened.
 *
 * Neither knows anything about pointers, selections or the editor. They are given
 * pixels and asked for a route.
 */

export { buildEdgeField, MAX_FIELD_PIXELS } from './edge-field';
export type { EdgeField } from './edge-field';
export { LiveWire } from './live-wire';
export type { WirePoint } from './live-wire';
