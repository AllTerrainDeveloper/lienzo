/**
 * The brush cursor.
 *
 * A ring the size of the brush, following the pointer. Every raster editor has one for
 * the same reason: the brush is measured in *canvas* pixels, so a 200px brush is a
 * quarter of the screen on a thumbnail and a smudge on a 6000px photograph. A crosshair
 * tells you where you are about to paint; only an outline tells you how much.
 *
 * Drawn as a DOM element rather than as a CSS `cursor` image: a custom cursor is capped
 * at 128px in every browser, and silently falls back to the default past that -- so the
 * one case where the preview matters most is the case where it would disappear.
 *
 * The clone stamp gets two extras here, because both are about where the pointer is:
 * a target marker pinned on the sample point, and a picker cursor while Alt is held.
 * The marker starts where Alt-click put it, and once a stroke has fixed the offset it
 * tracks the pointer instead -- showing exactly which pixels the next dab will copy.
 */

import type { BrushShape } from '../engine/brush';
import type { CanvasSize } from '../model/document';
import type { Point } from '../model/selection';
import type { ActiveTool } from './panels';

/** The tools whose size is worth previewing. */
const SIZED_TOOLS: ActiveTool[] = [
	'brush',
	'eraser',
	'retouch',
	'tone',
	'clone',
	'history',
];

/** Smallest ring worth drawing, in CSS pixels. Below this it is just a dot. */
const MIN_RADIUS = 2;

export interface BrushCursorOptions {
	/** The canvas area the cursor lives in. */
	stage: HTMLElement;
	/** Where the canvas sits inside the stage, in CSS pixels. */
	getViewport: () => { x: number; y: number; width: number; height: number } | null;
	/** Canvas size in its own pixels, for converting the brush diameter to screen. */
	getCanvas: () => CanvasSize;
	/** Which tool owns the stage. */
	getTool: () => ActiveTool;
	/** Brush diameter in canvas pixels, its shape, and its edge softness. */
	getBrush: () => { size: number; shape: BrushShape; hardness: number };
	/** Where the clone stamp samples from, in canvas pixels, if a source is set. */
	getCloneSource: () => Point | null;
	/** Offset from the stroke to the clone source, once a stroke has fixed one. */
	getCloneOffset: () => Point | null;
}

/**
 * A ring that tracks the pointer and matches the brush.
 */
export class BrushCursor {
	private options: BrushCursorOptions;

	private el: HTMLElement;

	/** The clone stamp's sample point, marked on the canvas. */
	private source: HTMLElement;

	/** Last known pointer position, so a size change redraws in place. */
	private at: { x: number; y: number } | null = null;

	/** Whether Alt is held, which turns the clone stamp into its sample picker. */
	private altDown = false;

	constructor( options: BrushCursorOptions ) {
		this.options = options;

		this.el = document.createElement( 'div' );
		this.el.className = 'lz-brush-cursor';
		this.el.setAttribute( 'aria-hidden', 'true' );
		this.el.style.display = 'none';

		this.source = document.createElement( 'div' );
		this.source.className = 'lz-clone-source';
		this.source.setAttribute( 'aria-hidden', 'true' );
		this.source.style.display = 'none';

		options.stage.appendChild( this.el );
		options.stage.appendChild( this.source );
		options.stage.addEventListener( 'pointermove', this.onMove );
		options.stage.addEventListener( 'pointerleave', this.onLeave );
		window.addEventListener( 'keydown', this.onKey );
		window.addEventListener( 'keyup', this.onKey );
		window.addEventListener( 'blur', this.onBlur );
	}

	/** Follows the pointer. */
	private onMove = ( event: PointerEvent ): void => {
		const rect = this.options.stage.getBoundingClientRect();

		this.at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		this.draw();
	};

	/** Hides the ring when the pointer leaves the canvas. */
	private onLeave = (): void => {
		this.at = null;
		this.el.style.display = 'none';
		this.draw();
	};

	/**
	 * Tracks the Alt key, which swaps the clone stamp for its sample picker.
	 *
	 * On the stage element via a class rather than in a mousemove branch, because the
	 * swap has to happen the moment the key goes down, under a stationary pointer.
	 */
	private onKey = ( event: KeyboardEvent ): void => {
		if ( 'Alt' !== event.key ) {
			return;
		}

		const down = 'keydown' === event.type;

		if ( down === this.altDown ) {
			return;
		}

		this.altDown = down;
		this.draw();
	};

	/** Lets go of Alt when the window does -- Alt-Tab must not wedge the picker on. */
	private onBlur = (): void => {
		if ( ! this.altDown ) {
			return;
		}

		this.altDown = false;
		this.draw();
	};

	/**
	 * Redraws at the current size.
	 *
	 * Called on pointer moves and whenever the brush or the zoom changes, so the ring
	 * resizes under a stationary pointer rather than waiting for the next movement.
	 */
	draw = (): void => {
		const tool = this.options.getTool();
		const viewport = this.options.getViewport();
		const canvas = this.options.getCanvas();

		// Alt over the clone stamp means "pick a source", and the cursor says so. The
		// class carries it to CSS, where the picker glyph replaces the hidden cursor.
		const sampling = this.altDown && 'clone' === tool;

		this.options.stage.classList.toggle( 'is-sampling', sampling );
		this.drawSource( tool, viewport, canvas );

		if (
			! this.at ||
			! viewport ||
			sampling ||
			! SIZED_TOOLS.includes( tool ) ||
			canvas.width < 1 ||
			viewport.width < 1
		) {
			this.el.style.display = 'none';

			return;
		}

		const brush = this.options.getBrush();
		// Canvas pixels to CSS pixels: the brush is defined against the image, so the
		// ring has to grow and shrink with the zoom.
		const scale = viewport.width / canvas.width;
		const size = Math.max( MIN_RADIUS * 2, brush.size * scale );

		this.el.style.display = '';
		this.el.style.inlineSize = `${ size }px`;
		this.el.style.blockSize = `${ size }px`;
		this.el.style.insetInlineStart = `${ this.at.x }px`;
		this.el.style.insetBlockStart = `${ this.at.y }px`;
		this.el.dataset.shape = brush.shape;

		// A soft brush is drawn dashed: its edge is a gradient, so a hard ring would
		// promise a crispness the stroke does not have.
		this.el.classList.toggle( 'is-soft', brush.hardness < 0.5 );
	};

	/**
	 * Marks where the clone stamp is copying from.
	 *
	 * Pinned on the Alt-clicked point until the first stroke, then moving with the
	 * pointer at the stroke's fixed offset -- which is where every dab after that
	 * actually reads. Off the stage the pointer says nothing, so the marker falls back
	 * to the picked point rather than jumping around.
	 *
	 * @param tool     Active tool.
	 * @param viewport Where the canvas sits inside the stage, or null before layout.
	 * @param canvas   Canvas size in its own pixels.
	 */
	private drawSource(
		tool: ActiveTool,
		viewport: { x: number; y: number; width: number; height: number } | null,
		canvas: CanvasSize
	): void {
		const source = this.options.getCloneSource();

		if (
			'clone' !== tool ||
			! source ||
			! viewport ||
			canvas.width < 1 ||
			viewport.width < 1
		) {
			this.source.style.display = 'none';

			return;
		}

		const scale = viewport.width / canvas.width;
		const offset = this.options.getCloneOffset();

		const x =
			offset && this.at ? this.at.x - offset.x * scale : viewport.x + source.x * scale;
		const y =
			offset && this.at ? this.at.y - offset.y * scale : viewport.y + source.y * scale;

		this.source.style.display = '';
		this.source.style.insetInlineStart = `${ x }px`;
		this.source.style.insetBlockStart = `${ y }px`;
	}

	/** Removes the cursor. */
	destroy(): void {
		this.options.stage.removeEventListener( 'pointermove', this.onMove );
		this.options.stage.removeEventListener( 'pointerleave', this.onLeave );
		window.removeEventListener( 'keydown', this.onKey );
		window.removeEventListener( 'keyup', this.onKey );
		window.removeEventListener( 'blur', this.onBlur );
		this.options.stage.classList.remove( 'is-sampling' );
		this.el.remove();
		this.source.remove();
	}
}
