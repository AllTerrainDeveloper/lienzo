/**
 * Options for the tools that select rather than paint.
 *
 * Both of them lead with the same control: what the next region does to the selection
 * already there. It comes first because it is read first -- in every editor that has
 * these modes, the leftmost thing in the selection tool's options is the boolean -- and
 * because it is the setting that changes what the *next* drag means rather than what the
 * current one looks like.
 */

import { __ } from '../../i18n';
import { SELECTION_MODES, SELECTION_SHAPES } from '../../model/selection';
import type { SelectionMode, SelectionShape } from '../../model/selection';
import { createSegmented } from '../controls';
import { selectionButtons, toleranceField } from './fields';
import type { OptionsBuilder } from './builder';

/** What the modifier keys do, said once and shown by both selection tools. */
const MODIFIER_HINT = 'Shift adds, Alt subtracts, Shift+Alt intersects.';

/**
 * New / Add / Subtract / Intersect.
 *
 * Glyphs rather than words: four labelled buttons would be most of the bar, and these
 * are the one set of controls in the editor a user has almost certainly met before. Each
 * carries its full name and its modifier key as a tooltip, which is also the accessible
 * name.
 *
 * @param bar The bar being built.
 */
function modePicker( bar: OptionsBuilder ): void {
	const field = createSegmented( {
		label: __( 'Selection mode' ),
		value: bar.options.getSelectionMode(),
		icons: true,
		options: SELECTION_MODES.map( ( mode ) => ( {
			value: mode.value,
			label: mode.glyph,
			title: __( mode.title ),
		} ) ),
		onChange: ( value ) => bar.options.setSelectionMode( value as SelectionMode ),
	} );

	bar.add( field, () => field.setValue( bar.options.getSelectionMode() ) );
}

/**
 * Mode, shape, and the two selection-wide buttons.
 *
 * @param bar The bar being built.
 */
export function renderSelectOptions( bar: OptionsBuilder ): void {
	modePicker( bar );
	bar.divider();

	// Segmented rather than a dropdown: four choices worth seeing at once, and a
	// shape you can identify without opening anything. Unlabelled, because "Rectangle,
	// Ellipse, Freeform, Polygon" does not need the word "Shape" in front of it.
	bar.add(
		createSegmented( {
			label: __( 'Shape' ),
			hideLabel: true,
			value: bar.options.getSelectionShape(),
			options: SELECTION_SHAPES.map( ( entry ) => ( {
				value: entry.value,
				label: __( entry.label ),
			} ) ),
			onChange: ( value ) => {
				bar.options.setSelectionShape( value as SelectionShape );
				bar.rebuild();
			},
		} )
	);

	bar.divider();
	selectionButtons( bar );

	bar.hint(
		'polygon' === bar.options.getSelectionShape()
			? __( 'Click to add points, Enter to close, Escape to abandon.' )
			: __( MODIFIER_HINT )
	);
}

/**
 * Mode, tolerance, and the same selection buttons.
 *
 * @param bar The bar being built.
 */
export function renderWandOptions( bar: OptionsBuilder ): void {
	modePicker( bar );
	bar.divider();
	toleranceField( bar );
	bar.divider();
	selectionButtons( bar );

	// No tolerance picks out a whole subject on a photograph; a few clicks with Shift
	// held very often do, so that is what the hint spends its one line on.
	bar.hint( __( MODIFIER_HINT ) );
}
