/**
 * Numeric fields.
 */

import { onShellEvent, pickComponent } from '../../platform';
import { eventDetail, labelledRow, nameControl } from './internals';
import type { FieldHandle } from './types';

export interface NumberFieldOptions {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	suffix?: string;
	/**
	 * Renders the label beside the control rather than inside it, narrows the control
	 * to a few digits, and builds it from a plain `<input>` rather than the shell's
	 * field component.
	 *
	 * For the options bar, where the values are two or three digits and the fields sit
	 * in a row. Letting the component own the label there makes every field a different
	 * width -- the label is inside the same box -- so "Hardness" ends up with a visibly
	 * narrower input than "Size", and all of them far wider than any value they hold.
	 *
	 * The plain input is the same judgement about height. See createNumberField().
	 */
	compact?: boolean;
	onChange: ( value: number ) => void;
}

/**
 * Builds a compact numeric field.
 *
 * Three tiers, best first. The number field clamps on commit and emits an
 * already-parsed number. When it is absent -- which is the common case, since the
 * shell only registers it once a bundle importing it loads -- the text field in
 * numeric mode is used instead: still the shell's own control, still the shell's own
 * styling, and only the parsing has to be done here. A bare `<input type="number">` is
 * the last resort, for a page with no OpenStation at all.
 *
 * Except in `compact`, which is the options bar, and there the plain input is not a
 * last resort but the right control. The shell's fields are panel controls and carry a
 * panel's metrics in a shadow root nothing outside can reach: 7px of padding around a
 * 13px line for the number field, 8px around a 1.5 line-height for the select, which
 * is 32px and 38px of height against a bar built for 24. Setting the host's height did
 * not shrink them, because the height a shadow root's contents take is not the host's
 * to give -- the host obeyed and the input hung out of the bottom of it, which is what
 * the bar was clipping. So the bar keeps its own controls, which it already has rules
 * for, and the shell's components keep the panels they were drawn for.
 *
 * @param options Field configuration.
 */
export function createNumberField( options: NumberFieldOptions ): FieldHandle {
	const tag = options.compact
		? null
		: pickComponent( [ 'number-field', 'text-field' ] );

	return tag ? componentField( tag, options ) : nativeField( options );
}

/**
 * Numeric field backed by one of the shell's components.
 *
 * @param tag     Which component was available.
 * @param options Field configuration.
 */
function componentField( tag: string, options: NumberFieldOptions ): FieldHandle {
	const numeric = tag.endsWith( '-number-field' );
	const field = document.createElement( tag );

	if ( options.compact ) {
		field.setAttribute( 'aria-label', options.label );
	} else {
		field.setAttribute( 'label', options.label );
	}

	field.setAttribute( 'value', String( Math.round( options.value ) ) );
	field.classList.add( 'lz-field--compact' );

	if ( numeric ) {
		field.setAttribute( 'min', String( options.min ) );
		field.setAttribute( 'max', String( options.max ) );
		field.setAttribute( 'step', String( options.step ?? 1 ) );
	} else {
		// The text field passes `type` through to its inner input, so the browser
		// still gives spinners and a numeric keypad; the clamping is ours.
		field.setAttribute( 'type', 'number' );
	}

	if ( options.suffix ) {
		field.setAttribute( 'suffix', options.suffix );
	}

	const onChange = ( event: Event ) => {
		const detail = eventDetail< { value: number | string } >( event );

		if ( ! detail ) {
			return;
		}

		const next = Number( detail.value );

		if ( ! Number.isFinite( next ) ) {
			return;
		}

		// The number field has already clamped; a text field has not.
		options.onChange( numeric ? next : clamp( next, options ) );
	};

	const offs = [
		onShellEvent( field, 'input-change', onChange ),
		onShellEvent( field, 'input-commit', onChange ),
	];

	const handle: FieldHandle = {
		el: field,
		setValue: ( value ) => field.setAttribute( 'value', String( value ) ),
		destroy: () => {
			for ( const off of offs ) {
				off();
			}
		},
	};

	if ( ! options.compact ) {
		return handle;
	}

	// The label goes outside, so every field in the row can share one width no
	// matter how long its name is.
	const { wrap, text } = labelledRow(
		'div',
		options.label,
		'lz-field lz-field--compact lz-field--narrow'
	);

	wrap.append( text, field );

	return { ...handle, el: wrap };
}

/**
 * Numeric field built from a native input, for a page with no OpenStation at all.
 *
 * @param options Field configuration.
 */
function nativeField( options: NumberFieldOptions ): FieldHandle {
	const { wrap, text } = labelledRow(
		'label',
		options.label,
		options.compact
			? 'lz-field lz-field--compact lz-field--narrow'
			: 'lz-field lz-field--compact'
	);

	const input = document.createElement( 'input' );
	input.type = 'number';
	input.className = 'lz-field__control';
	nameControl( input, null, 'number' );
	input.value = String( Math.round( options.value ) );
	input.min = String( options.min );
	input.max = String( options.max );
	input.step = String( options.step ?? 1 );

	const onInput = () => {
		const next = Number( input.value );

		if ( Number.isFinite( next ) ) {
			options.onChange( clamp( next, options ) );
		}
	};

	input.addEventListener( 'input', onInput );
	wrap.append( text, input );

	// The unit, which the component drew inside its own box and this has to draw for
	// itself. Without it the options bar reads "Size 72" and "Opacity 100", and a
	// brush diameter and a percentage stop being tellable apart at a glance.
	if ( options.suffix ) {
		const suffix = document.createElement( 'span' );

		suffix.className = 'lz-field__suffix';
		suffix.textContent = options.suffix;

		// Decoration beside a control that already announces its own value: read aloud
		// it would only ever interrupt the number it belongs to.
		suffix.setAttribute( 'aria-hidden', 'true' );

		wrap.append( suffix );
	}

	return {
		el: wrap,
		setValue: ( value ) => {
			input.value = String( value );
		},
		destroy: () => input.removeEventListener( 'input', onInput ),
	};
}

/**
 * Holds a value inside the field's range.
 *
 * @param value  Value to clamp.
 * @param bounds Field bounds.
 */
function clamp( value: number, bounds: { min: number; max: number } ): number {
	return Math.min( bounds.max, Math.max( bounds.min, value ) );
}
