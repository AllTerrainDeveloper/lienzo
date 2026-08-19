/**
 * The options bar builds its own controls.
 *
 * Not a style preference: the shell's field components decide their height inside a
 * shadow root, so a 38px select in a 31px bar could only ever be clipped by it. These
 * pin the rule that keeps the bar's controls reachable by the bar's own stylesheet --
 * `compact` means a plain control, even on a page where the component exists.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createColourField, createNumberField, createSelect } from '../../src/ui/controls';
import { createSwatchGrid } from '../../src/ui/controls/swatch-grid';

/**
 * Pretends a set of custom element tags are registered.
 *
 * @param tags Tags the shell has defined.
 */
function withComponents( tags: string[] ): void {
	vi.spyOn( customElements, 'get' ).mockImplementation( ( tag: string ) =>
		tags.includes( tag ) ? ( class {} as CustomElementConstructor ) : undefined
	);
}

/** Every tag inside a built control, the wrapper included. */
function tagsIn( el: HTMLElement ): string[] {
	return [ el, ...el.querySelectorAll( '*' ) ].map( ( node ) =>
		node.tagName.toLowerCase()
	);
}

afterEach( () => {
	vi.restoreAllMocks();
} );

describe( 'compact controls', () => {
	it( 'builds a number field from a plain input even where the component exists', () => {
		withComponents( [ 'os-number-field', 'os-text-field' ] );

		const field = createNumberField( {
			compact: true,
			label: 'Size',
			value: 72,
			min: 1,
			max: 400,
			onChange: () => {},
		} );

		const tags = tagsIn( field.el );

		expect( tags ).toContain( 'input' );
		expect( tags ).not.toContain( 'os-number-field' );
		expect( tags ).not.toContain( 'os-text-field' );
	} );

	it( 'still prefers the component when the field is not in the bar', () => {
		withComponents( [ 'os-number-field' ] );

		const field = createNumberField( {
			label: 'Size',
			value: 72,
			min: 1,
			max: 400,
			onChange: () => {},
		} );

		expect( tagsIn( field.el ) ).toContain( 'os-number-field' );
	} );

	it( 'keeps the unit the component used to draw for it', () => {
		withComponents( [ 'os-number-field' ] );

		const field = createNumberField( {
			compact: true,
			label: 'Size',
			value: 72,
			min: 1,
			max: 400,
			suffix: 'px',
			onChange: () => {},
		} );

		const suffix = field.el.querySelector( '.lz-field__suffix' );

		expect( suffix?.textContent ).toBe( 'px' );

		// It repeats the field it sits beside; a screen reader reading both interrupts
		// the value with its own unit.
		expect( suffix?.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
	} );

	it( 'leaves the unit out when the value has none', () => {
		withComponents( [] );

		const field = createNumberField( {
			compact: true,
			label: 'Tolerance',
			value: 32,
			min: 0,
			max: 128,
			onChange: () => {},
		} );

		expect( field.el.querySelector( '.lz-field__suffix' ) ).toBeNull();
	} );

	it( 'builds a dropdown from a native select', () => {
		withComponents( [ 'os-select', 'os-option' ] );

		const select = createSelect( {
			compact: true,
			label: 'Font',
			value: 'system',
			options: [ { value: 'system', label: 'System' } ],
			onChange: () => {},
		} );

		const tags = tagsIn( select.el );

		expect( tags ).toContain( 'select' );
		expect( tags ).toContain( 'option' );
		expect( tags ).not.toContain( 'os-select' );
		expect( select.getValue() ).toBe( 'system' );
	} );

	it( 'builds a colour swatch from a native input', () => {
		withComponents( [ 'os-color-field' ] );

		const field = createColourField( {
			compact: true,
			label: 'Colour',
			value: '#00ff00',
			onChange: () => {},
		} );

		const tags = tagsIn( field.el );

		expect( tags ).toContain( 'input' );
		expect( tags ).not.toContain( 'os-color-field' );
	} );
} );

describe( 'palette', () => {
	it( 'asks the shell grid for the row layout its chips are drawn for', () => {
		withComponents( [ 'os-swatch-grid', 'os-swatch' ] );

		const grid = createSwatchGrid( {
			label: 'Palette',
			colours: [ '#000000', '#ffffff' ],
			onChange: () => {},
		} );

		// Its default is a grid of `1fr` tracks, which stretches a circle into an
		// ellipse and overflows the popover at six columns.
		expect( grid.el.getAttribute( 'mode' ) ).toBe( 'row' );
		expect( grid.el.tagName.toLowerCase() ).toBe( 'os-swatch-grid' );
	} );

	it( 'names itself a group when it is building the chips itself', () => {
		withComponents( [] );

		const grid = createSwatchGrid( {
			label: 'Palette',
			colours: [ '#000000', '#ffffff' ],
			onChange: () => {},
		} );

		expect( grid.el.tagName.toLowerCase() ).toBe( 'div' );
		expect( grid.el.getAttribute( 'role' ) ).toBe( 'group' );

		// `mode` is the component's attribute and means nothing on a plain div.
		expect( grid.el.getAttribute( 'mode' ) ).toBeNull();
	} );
} );
