/**
 * The action end of the top bar.
 *
 * Undo, redo, compare, recentre, export, reset and save -- plus the rule for when each
 * of them is available. Enabling state is derived in one place from one snapshot,
 * because a Save button that is live on an unedited image produces a duplicate and a
 * Save button that is live twice over produces two.
 *
 * Seven commands used to be seven labelled buttons, which was most of the width of the
 * editor for a row that is not what anyone came to look at. Now the four that are used
 * constantly are glyphs, the two that are used rarely are behind an overflow, and only
 * the one that ends the session keeps its words. The commands are the same; what changed
 * is how much of the picture they were standing on.
 */

import { __ } from '../i18n';
import { createButton, createIconButton, createMenuButton } from '../ui/controls';
import type {
	ButtonHandle,
	IconButtonHandle,
	MenuButtonHandle,
	MenuItem,
} from '../ui/controls';
import { createCompareControl } from './compare-control';

export interface ToolbarActions {
	undo: () => void;
	redo: () => void;
	reset: () => void;
	recentre: () => void;
	save: () => void;
	exportToDevice: () => void;
	/** Shows or hides the original, while the compare control is held. */
	setBypass: ( on: boolean ) => void;
	/** Present only when the host wants a close button. */
	close?: () => void;
}

/** What decides which buttons are live. */
export interface ToolbarState {
	canUndo: boolean;
	canRedo: boolean;
	/** True when the edit would produce the original unchanged. */
	identity: boolean;
	/** False while a full-resolution render is in flight, or before one is possible. */
	ready: boolean;
	/** Whether the user may write a new attachment. */
	canSave: boolean;
}

/**
 * The toolbar's buttons and their enabling rules.
 */
export class EditorToolbar {
	private undoButton: IconButtonHandle;

	private redoButton: IconButtonHandle;

	private saveButton: ButtonHandle;

	private overflow: MenuButtonHandle;

	/**
	 * The last state pushed in.
	 *
	 * The overflow's commands are built fresh on every open, so their availability is
	 * read from here rather than pushed into elements that do not exist yet.
	 */
	private state: ToolbarState = {
		canUndo: false,
		canRedo: false,
		identity: true,
		ready: false,
		canSave: false,
	};

	/** Everything to release, including the buttons with no state of their own. */
	private handles: Array< { destroy: () => void } > = [];

	private detach: Array< () => void > = [];

	/**
	 * @param host    Element to append the buttons to.
	 * @param actions What each button does.
	 */
	constructor( host: HTMLElement, actions: ToolbarActions ) {
		// Easy to scroll into empty pasteboard and lose the picture entirely; this is
		// the way back that does not require knowing the shortcut.
		const recentre = createIconButton( {
			glyph: '⊕',
			label: __( 'Recentre the view (0)' ),
			className: 'lz-topbar__icon',
			onClick: actions.recentre,
		} );

		this.undoButton = createIconButton( {
			glyph: '↶',
			label: __( 'Undo (Ctrl+Z)' ),
			className: 'lz-topbar__icon',
			onClick: actions.undo,
		} );

		this.redoButton = createIconButton( {
			glyph: '↷',
			label: __( 'Redo (Ctrl+Shift+Z)' ),
			className: 'lz-topbar__icon',
			onClick: actions.redo,
		} );

		const compare = createCompareControl( actions.setBypass );

		this.detach.push( compare.detach );

		this.saveButton = createButton( {
			label: __( 'Save a copy' ),
			title: __( 'Save as a new image, leaving the original untouched' ),
			variant: 'primary',
			onClick: actions.save,
		} );

		this.overflow = createMenuButton( {
			label: __( 'More actions' ),
			className: 'lz-topbar__icon',
			getItems: () => this.moreActions( actions ),
		} );

		host.append(
			recentre.el,
			this.undoButton.el,
			this.redoButton.el,
			compare.handle.el,
			this.saveButton.el,
			this.overflow.el
		);

		this.handles.push(
			recentre,
			this.undoButton,
			this.redoButton,
			compare.handle,
			this.saveButton,
			this.overflow
		);
	}

	/**
	 * The commands behind the overflow, with the ones that would do nothing left out.
	 *
	 * Omitted rather than greyed out, unlike the buttons on the bar itself: a disabled
	 * control in a row is a placeholder holding its position, but a disabled row in a
	 * menu of three is just a shorter menu with a gap in it.
	 *
	 * @param actions What each command does.
	 */
	private moreActions( actions: ToolbarActions ): MenuItem[] {
		const items: MenuItem[] = [];
		// Exporting an unedited image would download the original, and exporting twice
		// while a render is in flight would render it twice.
		const live = this.state.ready && ! this.state.identity;

		if ( live ) {
			items.push( {
				label: __( 'Export…' ),
				title: __( 'Download the edited image to this device' ),
				onSelect: actions.exportToDevice,
			} );
		}

		if ( ! this.state.identity ) {
			items.push( {
				label: __( 'Reset all edits' ),
				title: __( 'Return every adjustment to zero' ),
				onSelect: actions.reset,
			} );
		}

		if ( actions.close ) {
			items.push( { label: __( 'Close' ), onSelect: actions.close } );
		}

		return items;
	}

	/**
	 * Enables or disables the buttons to match the state.
	 *
	 * @param state Current editor state.
	 */
	sync( state: ToolbarState ): void {
		this.state = state;

		this.undoButton.setDisabled( ! state.canUndo );
		this.redoButton.setDisabled( ! state.canRedo );

		// Saving an unedited image would just duplicate it, and saving twice while a
		// render is in flight would create two copies.
		const live = state.ready && ! state.identity;

		this.saveButton.setDisabled( ! live || ! state.canSave );
	}

	/** Releases every button and key binding. */
	destroy(): void {
		for ( const off of this.detach ) {
			off();
		}

		for ( const handle of this.handles ) {
			handle.destroy();
		}

		this.detach = [];
		this.handles = [];
	}
}
