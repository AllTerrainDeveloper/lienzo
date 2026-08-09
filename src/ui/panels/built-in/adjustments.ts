/**
 * The scalar adjustment panels.
 *
 * Adjustments and Effects are the same panel twice over a different slice of the op
 * schema, which is the whole point of keeping ops uniform: a new adjustment is a
 * schema entry and a display rule, not a new panel.
 */

import { __ } from '../../../i18n';
import { EFFECT_OP_ORDER, OP_LABELS, PANEL_OP_ORDER, getOp } from '../../../model/recipe';
import type { OpType, Recipe } from '../../../model/recipe';
import { createSegmented, createSlider } from '../../controls';
import type { SliderHandle } from '../../controls';
import { registerPanel } from '../registry';
import type { PanelContext } from '../types';

/**
 * How each adjustment is presented.
 *
 * Recipes store canonical units (-1..1 for the gain-style adjustments, degrees for
 * hue) because that is what the maths wants. People think in percentages, so the
 * slider multiplies on the way out and divides on the way in.
 */
const OP_DISPLAY: Record< OpType, { scale: number; suffix: string; step: number } > = {
	exposure: { scale: 100, suffix: '', step: 1 },
	contrast: { scale: 100, suffix: '', step: 1 },
	temperature: { scale: 100, suffix: '', step: 1 },
	tint: { scale: 100, suffix: '', step: 1 },
	saturation: { scale: 100, suffix: '', step: 1 },
	vibrance: { scale: 100, suffix: '', step: 1 },
	hue: { scale: 1, suffix: '°', step: 1 },
	sharpen: { scale: 100, suffix: '', step: 1 },
	blur: { scale: 100, suffix: '', step: 1 },
	vignette: { scale: 100, suffix: '', step: 1 },
	grain: { scale: 100, suffix: '', step: 1 },
};

/**
 * Builds the slider row for one adjustment.
 *
 * @param type Op type.
 * @param ctx  Panel context.
 * @return The slider, or null when the server does not offer this op.
 */
function adjustmentSlider( type: OpType, ctx: PanelContext ): SliderHandle | null {
	const spec = ctx.payload.schema[ type ];

	// A filter can remove an op server-side. Offering a slider the server would
	// reject on save would be a trap.
	if ( ! spec ) {
		return null;
	}

	const display = OP_DISPLAY[ type ];

	return createSlider( {
		label: __( OP_LABELS[ type ] ),
		min: Math.round( spec.min * display.scale ),
		max: Math.round( spec.max * display.scale ),
		step: display.step,
		suffix: display.suffix,
		value: getOp( ctx.getRecipe(), type, ctx.payload.schema ) * display.scale,
		resetTo: Math.round( spec.default * display.scale ),
		onInput: ( value ) => ctx.setOp( type, value / display.scale ),
	} );
}

/**
 * Renders a list of scalar adjustments into a panel body.
 *
 * @param host  Panel body.
 * @param ctx   Panel context.
 * @param order Which ops to show, in order.
 * @return Teardown.
 */
export function renderAdjustments(
	host: HTMLElement,
	ctx: PanelContext,
	order: OpType[]
): () => void {
	const sliders = new Map< OpType, SliderHandle >();

	for ( const type of order ) {
		const slider = adjustmentSlider( type, ctx );

		if ( ! slider ) {
			continue;
		}

		sliders.set( type, slider );
		host.appendChild( slider.el );
	}

	// Undo, redo and reset change the recipe without touching the sliders, so the
	// panel follows the model rather than assuming it owns it.
	const off = ctx.onRecipeChange( ( recipe ) => {
		for ( const [ type, slider ] of sliders ) {
			const display = OP_DISPLAY[ type ];

			slider.setValue(
				Math.round( getOp( recipe, type, ctx.payload.schema ) * display.scale )
			);
		}
	} );

	return () => {
		off();

		for ( const slider of sliders.values() ) {
			slider.destroy();
		}
	};
}

/**
 * The working-space picker.
 *
 * At the top of the Adjustments panel rather than in Output, because it is not an
 * encoding setting: it decides what a stop of exposure *means*. In sRGB the gain is
 * applied to the stored values, which is what core WordPress and most browser editors
 * do. In linear light the transfer curve is undone first, so a stop is a doubling of
 * light -- which is what a camera, and a raw developer, mean by one.
 *
 * @param ctx Panel context.
 * @return The control, and its teardown.
 */
function workingSpaceField( ctx: PanelContext ): {
	el: HTMLElement;
	destroy: () => void;
	sync: ( recipe: Recipe ) => void;
} {
	const field = createSegmented( {
		label: __( 'Light' ),
		value: ctx.getRecipe().space,
		options: [
			{ value: 'srgb', label: __( 'sRGB' ) },
			{ value: 'linear', label: __( 'Linear' ) },
		],
		onChange: ( value ) => ctx.setSpace( 'linear' === value ? 'linear' : 'srgb' ),
	} );

	return {
		el: field.el,
		destroy: field.destroy,
		sync: ( recipe ) => field.setValue( recipe.space ),
	};
}

/** Registers the Adjustments and Effects panels. */
export function registerAdjustmentPanels(): void {
	registerPanel( {
		id: 'adjustments',
		title: __( 'Adjustments' ),
		order: 20,
		render: ( host, ctx ) => {
			const space = workingSpaceField( ctx );

			host.appendChild( space.el );

			const off = ctx.onRecipeChange( space.sync );
			const teardown = renderAdjustments( host, ctx, PANEL_OP_ORDER );

			return () => {
				off();
				space.destroy();
				teardown();
			};
		},
	} );

	registerPanel( {
		id: 'effects',
		title: __( 'Detail & effects' ),
		order: 60,
		defaultCollapsed: true,
		render: ( host, ctx ) => renderAdjustments( host, ctx, EFFECT_OP_ORDER ),
	} );
}
