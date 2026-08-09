/**
 * Keyboard shortcuts.
 *
 * All of them in one table rather than three listeners scattered across the editor.
 * That matters because they compete: `Enter` means different things to the path tool
 * and the polygon marquee, and `Escape` only means "deselect" when there is a selection
 * to lose. Those decisions are easier to get right -- and to read -- side by side.
 */

import { isPlacedShape } from '../model/selection';
import type { SelectionShape } from '../model/selection';
import { hasCommandKey, onEditorKey } from './keys';

/** What the shortcuts act on. */
export interface ShortcutTarget {
	undo: () => void;
	redo: () => void;
	copy: () => void;
	paste: () => void;
	selectAll: () => void;
	/** Clears the marquee and any in-progress path. */
	deselect: () => void;
	/** Puts the marquee back as it was before the last change. */
	stepSelectionBack: () => void;
	/** Whether anything is selected. */
	hasSelection: () => boolean;
	/** Whether a polygon, a pen path or a magnetic trace is half-placed on the canvas. */
	hasPendingPath: () => boolean;
	/** Which tool owns the stage. */
	getTool: () => string;
	/** Which shape the marquee tool is drawing. */
	getSelectionShape: () => SelectionShape;
	/** Closes an in-progress path. True when one was closed. */
	commitPath: () => boolean;
	/** Closes an in-progress polygon marquee or magnetic trace into the selection. */
	closeShape: () => void;
	/** Takes back the last magnetic anchor. True when there was a trace to act on. */
	undoAnchor: () => boolean;
	/** Abandons an in-progress path without drawing it. */
	clearPath: () => void;
	/** Fits the whole picture back on screen. */
	resetView: () => void;
}

/**
 * Binds every editor shortcut.
 *
 * @param target What the shortcuts act on.
 * @return Detach function.
 */
export function attachEditorShortcuts( target: ShortcutTarget ): () => void {
	const detach = [
		onEditorKey( 'keydown', ( event ) => {
			if ( hasCommandKey( event ) ) {
				handleCommand( event, target );

				return;
			}

			handlePlain( event, target );
		} ),
	];

	return () => {
		for ( const off of detach ) {
			off();
		}
	};
}

/**
 * Shortcuts that need Cmd or Ctrl.
 *
 * @param event  Key event.
 * @param target What the shortcuts act on.
 */
function handleCommand( event: KeyboardEvent, target: ShortcutTarget ): void {
	const key = event.key.toLowerCase();

	if ( 'z' === key && ! event.shiftKey ) {
		event.preventDefault();
		target.undo();
	} else if ( ( 'z' === key && event.shiftKey ) || 'y' === key ) {
		event.preventDefault();
		target.redo();
	} else if ( 'a' === key ) {
		event.preventDefault();
		target.selectAll();
	} else if ( 'd' === key && ! event.shiftKey ) {
		event.preventDefault();
		target.deselect();
	} else if ( 'd' === key && event.shiftKey ) {
		// Photoshop's Reselect key, doing rather more: it restores whatever the
		// selection was before the last change, so it takes back a mistaken addition as
		// readily as it undoes a deselect. Beside Cmd+D rather than anywhere else
		// because the two are the same thought in opposite directions.
		event.preventDefault();
		target.stepSelectionBack();
	} else if ( 'c' === key ) {
		event.preventDefault();
		target.copy();
	} else if ( 'v' === key ) {
		event.preventDefault();
		target.paste();
	}
}

/**
 * Shortcuts that are a bare keypress.
 *
 * @param event  Key event.
 * @param target What the shortcuts act on.
 */
function handlePlain( event: KeyboardEvent, target: ShortcutTarget ): void {
	// Escape abandons a half-placed polygon as readily as it drops a finished selection.
	// Those vertices are not selected yet -- they are an outline waiting for Enter --
	// and leaving the only way out of them undocumented would strand anyone who
	// misclicked the first one.
	if ( 'Escape' === event.key && ( target.hasSelection() || target.hasPendingPath() ) ) {
		event.preventDefault();
		target.deselect();

		return;
	}

	// Enter closes whatever is being placed click by click: a polygon selection, a
	// magnetic trace, or a path, which is drawn rather than selected.
	if ( 'Enter' === event.key ) {
		if ( 'path' === target.getTool() ) {
			event.preventDefault();

			if ( target.commitPath() ) {
				target.deselect();
			}

			return;
		}

		// Neither a polygon nor a magnetic trace has a release that finishes it, so
		// Enter is what folds one into the selection -- in whatever mode its first click
		// was made in.
		if ( isPlacedShape( target.getSelectionShape() ) ) {
			event.preventDefault();
			target.closeShape();
		}

		return;
	}

	// Backspace takes back the last magnetic anchor. It is claimed only while a trace is
	// actually open -- `undoAnchor()` says so -- because outside one the key belongs to
	// the browser, and a selection tool that swallowed Backspace on an admin screen
	// would break the back gesture on every trackpad that has one.
	if (
		( 'Backspace' === event.key || 'Delete' === event.key ) &&
		target.undoAnchor()
	) {
		event.preventDefault();

		return;
	}

	// The universal "show me everything again" key.
	if ( '0' === event.key ) {
		target.resetView();
	}
}
