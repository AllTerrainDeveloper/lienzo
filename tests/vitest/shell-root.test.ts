/**
 * What the editor does to the element it is given.
 *
 * Both hosts hand the *same* element to the picker first and to the editor second, so
 * the two have to agree about whose classes are on it. They did not: the picker's
 * `lz-picker` carries a 16px flex gap and 24px of padding, and left behind it applied
 * to the editor -- a strip of background between the top bar and the tool rail, and a
 * margin around the whole editor that nothing in its own stylesheet asks for.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { EditorShell } from '../../src/editor/shell';
import { PICKER_CLASS } from '../../src/ui/picker';

/**
 * Builds a shell over a fresh element.
 *
 * @param root Element to mount into.
 * @param host Which surface is hosting the editor.
 */
function mountShell( root: HTMLElement, host: 'page' | 'modal' | 'window' = 'window' ) {
	return new EditorShell( { root, host, onSidebarToggle: () => {} } );
}

describe( 'EditorShell', () => {
	let root: HTMLElement;

	beforeEach( () => {
		root = document.createElement( 'div' );
		root.className = 'lienzo-root';
		document.body.appendChild( root );
	} );

	it( 'takes the picker class off the element it moves into', () => {
		// Exactly what a window does: show the picker, then open what was chosen.
		root.classList.add( PICKER_CLASS );

		mountShell( root );

		expect( root.classList.contains( PICKER_CLASS ) ).toBe( false );
		expect( root.classList.contains( 'lz-editor' ) ).toBe( true );
	} );

	it( 'leaves the host its own class', () => {
		mountShell( root );

		expect( root.classList.contains( 'lienzo-root' ) ).toBe( true );
	} );

	it( 'marks which surface is hosting it', () => {
		mountShell( root, 'page' );

		expect( root.classList.contains( 'lz-editor--page' ) ).toBe( true );
	} );

	it( 'gives every class back on teardown, host modifier included', () => {
		// The same element goes back to the picker when a window is emptied, and
		// `lz-editor--window` left on it brings `block-size: 100%` and
		// `overflow: hidden` -- a picker that cannot scroll to the photo you wanted.
		const shell = mountShell( root );

		shell.destroy();

		expect( root.classList.contains( 'lz-editor' ) ).toBe( false );
		expect( root.classList.contains( 'lz-editor--window' ) ).toBe( false );
		expect( root.classList.contains( 'lienzo-root' ) ).toBe( true );
		expect( root.children ).toHaveLength( 0 );
	} );

	it( 'survives the picker and the editor trading the element back and forth', () => {
		for ( let round = 0; round < 3; round++ ) {
			root.classList.add( PICKER_CLASS );

			const shell = mountShell( root );

			expect( root.classList.contains( PICKER_CLASS ) ).toBe( false );
			shell.destroy();
		}

		// Nothing accumulated: the only class left is the one the host put there.
		expect( [ ...root.classList ] ).toEqual( [ 'lienzo-root' ] );
	} );
} );
