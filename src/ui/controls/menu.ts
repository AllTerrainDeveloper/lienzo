/**
 * A button that drops a short list of actions.
 *
 * What an overflow is for: the commands that have to be reachable but do not have to be
 * on screen. Reset, Export and Close are each one click away and none of them costs a
 * permanent slot in a bar that has to leave room for the tool being used.
 *
 * Plain DOM rather than the shell's menu component, for the same reason the tool rail's
 * overflow is: this has to work identically with the shell absent, and a menu is the one
 * control where a half-registered component leaves the user with nothing clickable.
 */

import { __ } from '../../i18n';
import { createIconButton } from './button';
import type { IconButtonHandle } from './button';
import { floatingHost, positionFloating } from './floating';
import type { ControlHandle } from './types';

/** One command in the list. */
export interface MenuItem {
	label: string;
	/** Optional. Tooltip, where the label alone does not say what happens. */
	title?: string;
	onSelect: () => void;
}

export interface MenuButtonOptions {
	/** Glyph on the button. */
	glyph?: string;
	/** Accessible name for the button, and the menu's own label. */
	label: string;
	/** Extra class for sizing and placement. */
	className?: string;
	/** Called each time the menu opens, so the list can reflect the current state. */
	getItems: () => MenuItem[];
}

/** Handle on a menu button, which can disable individual commands by label. */
export interface MenuButtonHandle extends ControlHandle {
	/** Closes the list, if it is open. */
	close: () => void;
}

/**
 * Builds an overflow button and the list it drops.
 *
 * The items are read on every open rather than captured once: whether Reset does
 * anything depends on whether there is anything to reset, and a list built at
 * construction time would still be describing the document as it was when the editor
 * loaded.
 *
 * @param options Menu configuration.
 */
export function createMenuButton( options: MenuButtonOptions ): MenuButtonHandle {
	let el: HTMLElement | null = null;
	let detachAway: ( () => void ) | null = null;

	const close = (): void => {
		detachAway?.();
		detachAway = null;
		el?.remove();
		el = null;
		button.setPressed( false );
	};

	const open = (): void => {
		const menu = document.createElement( 'div' );

		menu.className = 'lz-menu';
		menu.setAttribute( 'role', 'menu' );
		menu.setAttribute( 'aria-label', options.label );

		for ( const entry of options.getItems() ) {
			const item = document.createElement( 'button' );

			item.type = 'button';
			item.className = 'lz-menu__item';
			item.setAttribute( 'role', 'menuitem' );
			item.textContent = entry.label;

			if ( entry.title ) {
				item.setAttribute( 'title', entry.title );
			}

			item.addEventListener( 'click', () => {
				close();
				entry.onSelect();
			} );

			menu.appendChild( item );
		}

		// Parented to the editor root, which is as far out as a popover can go while
		// still inheriting the palette every colour here is declared against.
		floatingHost( button.el ).appendChild( menu );
		positionFloating( menu, button.el, 'block-end' );

		el = menu;
		button.setPressed( true );

		const onAway = ( event: MouseEvent ) => {
			if (
				event.target instanceof Node &&
				! menu.contains( event.target ) &&
				! button.el.contains( event.target )
			) {
				close();
			}
		};

		const onEscape = ( event: KeyboardEvent ) => {
			if ( 'Escape' === event.key ) {
				close();
			}
		};

		// Deferred, or the click that opened the menu closes it again.
		window.setTimeout( () => document.addEventListener( 'click', onAway ), 0 );
		document.addEventListener( 'keydown', onEscape );

		detachAway = () => {
			document.removeEventListener( 'click', onAway );
			document.removeEventListener( 'keydown', onEscape );
		};
	};

	const button: IconButtonHandle = createIconButton( {
		glyph: options.glyph ?? '⋯',
		label: __( options.label ),
		...( options.className ? { className: options.className } : {} ),
		onClick: () => ( el ? close() : open() ),
	} );

	button.el.setAttribute( 'aria-haspopup', 'menu' );

	return {
		el: button.el,
		close,
		destroy: () => {
			close();
			button.destroy();
		},
	};
}
