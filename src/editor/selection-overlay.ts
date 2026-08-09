/**
 * The marquee.
 *
 * Owns both halves of a selection: the outline the user sees, and the mask that
 * actually confines painting. Keeping them together is the point -- rasterising the
 * mask on every change means no tool has to remember to rebuild it.
 */

import {
	anchorMarks,
	buildSelectionMask,
	combineSelections,
	isEmptySelection,
	selectionToPath,
} from '../model/selection';
import type {
	Selection,
	SelectionAnchor,
	SelectionMode,
} from '../model/selection';
import type { CanvasSize } from '../model/document';
import type { Viewport } from '../ui/panels';

export interface SelectionOverlayOptions {
	/** The canvas area to draw over. */
	stage: HTMLElement;
	/** Where the canvas sits inside the stage. */
	getViewport: () => Viewport | null;
	/** Current canvas size, which the mask is rasterised at. */
	getCanvas: () => CanvasSize;
	/** Hands the rasterised mask to the renderer. */
	setMask: ( mask: HTMLCanvasElement | null ) => void;
	/** Called after any change, so the options bar can re-render. */
	onChange: () => void;
	/**
	 * Optional. Ceiling on the raster a boolean is worked out on.
	 *
	 * From `lienzo_max_selection_pixels`, by way of the config blob. Left out, the
	 * combiner's own default applies, which is what every test and every caller
	 * outside the editor wants.
	 */
	maxRasterPixels?: number;
}

/**
 * How many earlier selections the marquee keeps.
 *
 * Enough to undo a run of mistaken additions, few enough that a stack of six-hundred
 * point lassos is a few tens of kilobytes rather than a leak. Nobody steps back twenty
 * selections; the number is a bound, not a promise.
 */
const MAX_SELECTION_HISTORY = 20;

/** The whole canvas, as a selection. */
export const SELECT_ALL: Selection = {
	shape: 'rect',
	points: [
		{ x: 0, y: 0 },
		{ x: 1, y: 1 },
	],
};

/**
 * The selection outline and its mask.
 */
export class SelectionOverlay {
	/** The current marquee, or null when nothing is selected. */
	private selection: Selection | null = null;

	/**
	 * The region being drawn right now, drawn but not yet folded in.
	 *
	 * Separate from the selection proper for two reasons. It is what makes the boolean
	 * modes legible -- you can see the shape you are dragging *and* the selection it is
	 * about to be added to or cut out of, which is the only way to aim a subtraction.
	 * And it costs nothing: a pending outline is a path attribute, where replacing the
	 * selection on every pointer move rasterised a canvas-sized mask and handed it to
	 * the GPU sixty times a second.
	 */
	private pending: Selection | null = null;

	/**
	 * The selections this one replaced, oldest first.
	 *
	 * Its own history rather than a place on the document's undo stack, because a
	 * selection is not part of the picture. Undo is for what the image looks like;
	 * this is for the four-way picker's mistakes.
	 */
	private past: Array< Selection | null > = [];

	/**
	 * The points a magnetic trace has committed to.
	 *
	 * Drawn separately from the outline because they answer a different question. The
	 * outline says what would be selected; these say how much of it has stopped moving.
	 * Anything behind the last one is fixed until Backspace takes it back, and the only
	 * way to know that without being told is to see where they landed.
	 */
	private anchors: SelectionAnchor[] = [];

	private svg: SVGSVGElement;

	private options: SelectionOverlayOptions;

	/**
	 * @param options Overlay configuration.
	 */
	constructor( options: SelectionOverlayOptions ) {
		this.options = options;

		// SVG rather than a positioned box: a lasso is not a rectangle, and once the
		// outline has to be a path anyway, one element draws every shape.
		this.svg = document.createElementNS( 'http://www.w3.org/2000/svg', 'svg' );
		this.svg.setAttribute( 'class', 'lz-selection' );
		this.svg.setAttribute( 'aria-hidden', 'true' );

		// Two paths per outline, opposite colours, one dashed and animated: marching
		// ants that stay visible over both light and dark pixels. Two outlines, because
		// a gesture in progress is shown beside the selection it will change.
		// Anchors last, so their marks sit over the ants rather than under them.
		for ( const cls of [
			'lz-selection__under',
			'lz-selection__over',
			'lz-selection__pending-under',
			'lz-selection__pending-over',
			'lz-selection__anchor-auto',
			'lz-selection__anchor-manual',
		] ) {
			const path = document.createElementNS( 'http://www.w3.org/2000/svg', 'path' );
			path.setAttribute( 'class', cls );
			this.svg.appendChild( path );
		}

		options.stage.appendChild( this.svg );
		this.sync();
	}

	/** The current marquee, or null. */
	get current(): Selection | null {
		return this.selection;
	}

	/** Whether anything is selected. */
	get isActive(): boolean {
		return null !== this.selection;
	}

	/** Whether there is an earlier selection to go back to. */
	get canStepBack(): boolean {
		return this.past.length > 0;
	}

	/**
	 * Replaces the marquee and rebuilds the mask.
	 *
	 * @param selection Selection, or null to clear it.
	 */
	set( selection: Selection | null ): void {
		const next = isEmptySelection( selection ) ? null : selection;

		// A change that changes nothing is not worth a step back. Escape over an empty
		// canvas is the common one: without this, pressing it a few times would fill the
		// history with nothing and bury the selection actually worth returning to.
		if ( next !== this.selection ) {
			this.remember( this.selection );
		}

		this.apply( selection );
	}

	/**
	 * Puts the selection back as it was before the last change.
	 *
	 * A selection is not on the undo stack, deliberately: it describes how someone is
	 * working rather than what the picture should look like, and an undo that stepped
	 * through six marquees before reaching the brush stroke you meant would be worse
	 * than no undo at all. But an addition made in the wrong mode is a real and common
	 * mistake, and "draw the whole thing again" is a poor answer to it -- so the
	 * marquee keeps its own short history, reached by its own key.
	 *
	 * It doubles as Reselect: dropping a selection is a change like any other, so
	 * stepping back from nothing restores what was there.
	 *
	 * @return Whether there was anything to go back to.
	 */
	stepBack(): boolean {
		const previous = this.past.pop();

		if ( undefined === previous ) {
			return false;
		}

		// Not remembered. Stepping back is a way out of a mistake, and a step that
		// recorded itself would make the next one a step forwards -- two presses and you
		// are where you started, which is the one behaviour nobody wants from this key.
		this.apply( previous );

		return true;
	}

	/**
	 * Files the selection being replaced, so it can be stepped back to.
	 *
	 * Bounded, because these are paths and a magnetic trace carries six hundred points:
	 * an unbounded ring would hold every selection made in a session for the sake of
	 * the two anyone ever reaches for.
	 *
	 * @param selection Selection about to be replaced.
	 */
	private remember( selection: Selection | null ): void {
		this.past.push( selection );

		if ( this.past.length > MAX_SELECTION_HISTORY ) {
			this.past.shift();
		}
	}

	/**
	 * Puts a selection in place, with no note of what was there before.
	 *
	 * @param selection Selection, or null to clear it.
	 */
	private apply( selection: Selection | null ): void {
		this.selection = isEmptySelection( selection ) ? null : selection;
		this.pending = null;
		this.anchors = [];

		const canvas = this.options.getCanvas();

		this.options.setMask(
			buildSelectionMask( this.selection, canvas.width, canvas.height )
		);

		this.sync();
		this.options.onChange();
	}

	/**
	 * Shows a region being drawn, without committing it.
	 *
	 * No mask is built and no listener is told: this is an outline following a pointer,
	 * and nothing downstream of the selection has changed yet.
	 *
	 * @param selection Region in progress, or null to take the outline down.
	 */
	setPending( selection: Selection | null ): void {
		this.pending = selection;
		this.sync();
	}

	/**
	 * Marks the points a magnetic trace has committed to.
	 *
	 * @param anchors Anchors to mark. Empty takes the marks down.
	 */
	setAnchors( anchors: SelectionAnchor[] ): void {
		// Nothing to redraw when there were none and there still are none, which is every
		// pointer move made by every other tool in the editor.
		if ( 0 === anchors.length && 0 === this.anchors.length ) {
			return;
		}

		this.anchors = anchors;
		this.sync();
	}

	/**
	 * Folds a finished region into the selection.
	 *
	 * @param selection Region just drawn, or null when the gesture produced nothing.
	 * @param mode      What that region does to the selection already in place.
	 */
	combine( selection: Selection | null, mode: SelectionMode ): void {
		this.set(
			combineSelections(
				this.selection,
				selection,
				mode,
				this.options.getCanvas(),
				this.options.maxRasterPixels
			)
		);
	}

	/** Selects the whole canvas. */
	selectAll(): void {
		this.set( { ...SELECT_ALL } );
	}

	/**
	 * Draws the marquee outline over the canvas.
	 *
	 * Hidden with `style.display`, not the `hidden` property. `hidden` is an
	 * HTMLElement IDL attribute and this is an SVG element -- assigning it sets a
	 * property that reflects to nothing, so the CSS never matches and the outline
	 * stays on screen. That is what made a deselect appear to do nothing.
	 *
	 * The path is also emptied rather than merely hidden, so a stale outline cannot
	 * reappear the moment something else makes the element visible again.
	 */
	readonly sync = (): void => {
		const viewport = this.options.getViewport();

		if ( ( ! this.selection && ! this.pending ) || ! viewport ) {
			this.svg.style.display = 'none';
			this.paint( 'lz-selection__', '' );
			this.paint( 'lz-selection__pending-', '' );
			this.mark( 'auto', '' );
			this.mark( 'manual', '' );

			return;
		}

		this.svg.style.display = '';
		this.svg.style.insetInlineStart = `${ viewport.x }px`;
		this.svg.style.insetBlockStart = `${ viewport.y }px`;
		this.svg.setAttribute( 'width', String( viewport.width ) );
		this.svg.setAttribute( 'height', String( viewport.height ) );

		this.paint( 'lz-selection__', this.outline( this.selection, viewport ) );
		this.paint( 'lz-selection__pending-', this.outline( this.pending, viewport ) );

		// Bigger for the ones a click put there. Two sizes rather than two colours,
		// because the marks sit on a photograph and colour is the one channel the
		// photograph is already using.
		for ( const kind of [ 'auto', 'manual' ] as const ) {
			const of = this.anchors.filter(
				( anchor ) => anchor.manual === ( 'manual' === kind )
			);

			this.mark(
				kind,
				anchorMarks(
					of,
					viewport.width,
					viewport.height,
					'manual' === kind ? 9 : 6
				)
			);
		}
	};

	/**
	 * Writes the anchor marks of one kind.
	 *
	 * @param kind Which set.
	 * @param d    Path data.
	 */
	private mark( kind: 'auto' | 'manual', d: string ): void {
		this.svg
			.querySelector( `.lz-selection__anchor-${ kind }` )
			?.setAttribute( 'd', d );
	}

	/**
	 * One selection as path data, or nothing when there is none.
	 *
	 * @param selection Selection to draw, or null.
	 * @param viewport  Where the canvas sits.
	 */
	private outline(
		selection: Selection | null,
		viewport: { width: number; height: number }
	): string {
		return selection
			? selectionToPath( selection, viewport.width, viewport.height )
			: '';
	}

	/**
	 * Writes one path into both strokes of an outline.
	 *
	 * @param prefix Class prefix identifying which outline.
	 * @param d      Path data.
	 */
	private paint( prefix: string, d: string ): void {
		for ( const suffix of [ 'under', 'over' ] ) {
			this.svg
				.querySelector( `.${ prefix }${ suffix }` )
				?.setAttribute( 'd', d );
		}
	}

	/** Takes the outline off the stage. */
	destroy(): void {
		this.svg.remove();
	}
}
