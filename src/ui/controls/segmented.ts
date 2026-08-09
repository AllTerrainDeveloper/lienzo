/**
 * Segmented pickers.
 */

import { componentTag, onShellEvent } from '../../platform';
import { eventDetail, labelledRow, siblingTag } from './internals';
import type { ControlOption, FieldHandle } from './types';

export interface SegmentedOptions {
	label: string;
	value: string;
	options: ControlOption[];
	/**
	 * Whether the labels are glyphs rather than words.
	 *
	 * Only presentation -- every option still carries a `title`, which is where the
	 * accessible name comes from once the visible text is a symbol.
	 */
	icons?: boolean;
	onChange: ( value: string ) => void;
}

/**
 * Builds a segmented picker, falling back to radio-styled buttons.
 *
 * Used where the choices are few and worth seeing at once -- a shape picker reads
 * far better as pills than as a dropdown you have to open to know what is selected.
 *
 * @param options Picker configuration.
 */
export function createSegmented( options: SegmentedOptions ): FieldHandle {
	// A glyph picker keeps its label for assistive technology and hides it on screen:
	// the four symbols are the control, and "Selection mode" written beside them is a
	// hundred pixels of a one-row bar spent naming what the icons already say.
	const { wrap, text } = labelledRow(
		'div',
		options.label,
		options.icons
			? 'lz-field lz-field--compact lz-field--icons'
			: 'lz-field lz-field--compact'
	);

	const tag = componentTag( 'segmented' );

	if ( tag ) {
		const group = document.createElement( tag );

		group.setAttribute( 'value', options.value );
		group.setAttribute( 'label', options.label );

		for ( const option of options.options ) {
			const segment = document.createElement( siblingTag( tag, 'segment' ) );

			segment.setAttribute( 'value', option.value );
			segment.textContent = option.label;

			if ( option.title ) {
				segment.setAttribute( 'title', option.title );
				segment.setAttribute( 'aria-label', option.title );
			}

			group.appendChild( segment );
		}

		const onPick = ( event: Event ) => {
			const detail = eventDetail< { value: string } >( event );

			if ( detail?.value ) {
				options.onChange( detail.value );
			}
		};

		const off = onShellEvent( group, 'pick', onPick );

		wrap.append( text, group );

		return {
			el: wrap,
			setValue: ( value ) => group.setAttribute( 'value', String( value ) ),
			destroy: off,
		};
	}

	const group = document.createElement( 'div' );
	group.className = options.icons ? 'lz-segmented lz-segmented--icons' : 'lz-segmented';
	group.setAttribute( 'role', 'radiogroup' );
	group.setAttribute( 'aria-label', options.label );

	const buttons: HTMLButtonElement[] = [];
	let current = options.value;

	const paint = () => {
		for ( const button of buttons ) {
			const on = button.dataset.value === current;

			button.classList.toggle( 'is-active', on );
			button.setAttribute( 'aria-checked', String( on ) );
		}
	};

	for ( const option of options.options ) {
		const button = document.createElement( 'button' );

		button.type = 'button';
		button.className = 'lz-segmented__item';
		button.dataset.value = option.value;
		button.textContent = option.label;
		button.setAttribute( 'role', 'radio' );

		if ( option.title ) {
			button.setAttribute( 'title', option.title );
			button.setAttribute( 'aria-label', option.title );
		}

		button.addEventListener( 'click', () => {
			current = option.value;
			paint();
			options.onChange( option.value );
		} );

		buttons.push( button );
		group.appendChild( button );
	}

	paint();
	wrap.append( text, group );

	return {
		el: wrap,
		setValue: ( value ) => {
			current = String( value );
			paint();
		},
		destroy: () => {},
	};
}
