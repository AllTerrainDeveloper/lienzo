/**
 * What the options bar is given, and what it hands back.
 */

import type { SelectionMode, SelectionShape } from '../../model/selection';
import type { ActiveTool, PanelContext } from '../panels';

export interface OptionsBarOptions {
	ctx: PanelContext;
	getTool: () => ActiveTool;
	getSelectionShape: () => SelectionShape;
	setSelectionShape: ( shape: SelectionShape ) => void;
	/** What a newly drawn region does to the selection already in place. */
	getSelectionMode: () => SelectionMode;
	setSelectionMode: ( mode: SelectionMode ) => void;
	hasSelection: () => boolean;
	deselect: () => void;
	selectAll: () => void;
	/** Whether there is an earlier selection to go back to. */
	canStepSelectionBack: () => boolean;
	/** Puts the marquee back as it was before the last change. */
	stepSelectionBack: () => void;
	/** Whether the clone stamp has a sample point yet. */
	hasCloneSource: () => boolean;
	/** Forgets the clone sample point. */
	clearCloneSource: () => void;
	/** Zooms to a ratio of 1 canvas pixel per screen pixel, or fits the window. */
	setZoom: ( mode: 'fit' | 'actual' ) => void;
	/** Whether a caret is open on the canvas. */
	isTypingText: () => boolean;
}

/** A control this bar can tear down. */
export interface Field {
	el: HTMLElement;
	destroy: () => void;
}
