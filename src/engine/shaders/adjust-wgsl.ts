/**
 * The adjustment shader again, in WGSL, for WebGPU.
 *
 * A word-for-word twin of `adjust.ts`, and it has to stay one. Pixi picks a program
 * by backend and silently *skips* a filter that has none for the active one -- which
 * shows the unedited image with no error anywhere. That is why the renderer used to
 * pin itself to WebGL: there was no program to pick.
 *
 * The structure here is not free invention. Pixi generates the bind-group layout from
 * this source, so the global uniform block, the input texture and its sampler must sit
 * at exactly `@group(0) @binding(0..2)`, and the filter's own resources follow at
 * `@group(1)`. The uniform struct's fields must appear in the order the `UniformGroup`
 * declares them, and a `size: 20` array of floats is `array<vec4<f32>, 5>` -- a uniform
 * buffer cannot pack floats tighter than sixteen bytes.
 *
 * The `@group(1)` bindings are matched to the filter's `resources` map by *variable*
 * name -- `adjustUniforms`, `uLut`, `uLutSampler` -- not by struct name and not by
 * position. Naming the variable anything else produces a bind group with a hole in it
 * and a `TypeError` from deep inside Pixi's WebGPU backend on the first frame.
 *
 * One source string, two entry points, exactly as Pixi's own filters do it.
 */

/** The WGSL program: `mainVertex` and `mainFragment`. */
export const ADJUST_WGSL = /* wgsl */ `
struct GlobalFilterUniforms {
	uInputSize: vec4<f32>,
	uInputPixel: vec4<f32>,
	uInputClamp: vec4<f32>,
	uOutputFrame: vec4<f32>,
	uGlobalFrame: vec4<f32>,
	uOutputTexture: vec4<f32>,
};

struct AdjustUniforms {
	uColorMatrix: array<vec4<f32>, 5>,
	uVibrance: f32,
	uLutMix: f32,
	uSharpen: f32,
	uVignette: f32,
	uGrain: f32,
	uSeed: f32,
	uExposure: f32,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;

@group(1) @binding(0) var<uniform> adjustUniforms: AdjustUniforms;
@group(1) @binding(1) var uLut: texture_2d<f32>;
@group(1) @binding(2) var uLutSampler: sampler;

const LUMA = vec3<f32>( 0.2126, 0.7152, 0.0722 );

struct VSOutput {
	@builtin(position) position: vec4<f32>,
	@location(0) uv: vec2<f32>,
};

fn filterVertexPosition( aPosition: vec2<f32> ) -> vec4<f32>
{
	var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;

	position.x = position.x * ( 2.0 / gfu.uOutputTexture.x ) - 1.0;
	position.y = position.y * ( 2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y ) - gfu.uOutputTexture.z;

	return vec4<f32>( position, 0.0, 1.0 );
}

fn filterTextureCoord( aPosition: vec2<f32> ) -> vec2<f32>
{
	return aPosition * ( gfu.uOutputFrame.zw * gfu.uInputSize.zw );
}

@vertex
fn mainVertex( @location(0) aPosition: vec2<f32> ) -> VSOutput
{
	return VSOutput(
		filterVertexPosition( aPosition ),
		filterTextureCoord( aPosition ),
	);
}

/** The sRGB transfer curve, and its inverse. See the GLSL twin for why it is piecewise. */
fn toLinear( c: vec3<f32> ) -> vec3<f32>
{
	return mix(
		c / 12.92,
		pow( ( c + 0.055 ) / 1.055, vec3<f32>( 2.4 ) ),
		step( vec3<f32>( 0.04045 ), c )
	);
}

fn toSrgb( c: vec3<f32> ) -> vec3<f32>
{
	return mix(
		c * 12.92,
		1.055 * pow( c, vec3<f32>( 1.0 / 2.4 ) ) - 0.055,
		step( vec3<f32>( 0.0031308 ), c )
	);
}

/** Scales saturation by how unsaturated a pixel already is. */
fn applyVibrance( color: vec3<f32>, amount: f32 ) -> vec3<f32>
{
	let mx = max( color.r, max( color.g, color.b ) );
	let mn = min( color.r, min( color.g, color.b ) );
	let chroma = mx - mn;
	let luma = dot( color, LUMA );
	let scale = 1.0 + amount * ( 1.0 - chroma );

	return mix( vec3<f32>( luma ), color, vec3<f32>( scale ) );
}

/** Cheap hash for film grain. */
fn hash( p: vec2<f32> ) -> f32
{
	return fract( sin( dot( p, vec2<f32>( 12.9898, 78.233 ) ) ) * 43758.5453 );
}

@fragment
fn mainFragment(
	@builtin(position) position: vec4<f32>,
	@location(0) uv: vec2<f32>,
) -> @location(0) vec4<f32> {
	var color = textureSample( uTexture, uSampler, uv );

	if ( adjustUniforms.uSharpen > 0.0 ) {
		// Unsharp mask, at one texel of the render target -- which is what keeps a
		// sharpen previewed at 900px looking the same saved at 6000px.
		let texel = gfu.uInputSize.zw;

		var blurred =
			textureSample( uTexture, uSampler, uv + vec2<f32>( texel.x, 0.0 ) ) +
			textureSample( uTexture, uSampler, uv - vec2<f32>( texel.x, 0.0 ) ) +
			textureSample( uTexture, uSampler, uv + vec2<f32>( 0.0, texel.y ) ) +
			textureSample( uTexture, uSampler, uv - vec2<f32>( 0.0, texel.y ) );

		blurred *= 0.25;

		color += ( color - blurred ) * adjustUniforms.uSharpen * 1.5;
	}

	if ( color.a > 0.0 ) {
		color = vec4<f32>( color.rgb / color.a, color.a );
	}

	if ( adjustUniforms.uExposure != 1.0 ) {
		// Exposure in linear light; 1.0 in an sRGB working space, where it rides in
		// the colour matrix instead.
		color = vec4<f32>(
			clamp( toSrgb( toLinear( clamp( color.rgb, vec3<f32>( 0.0 ), vec3<f32>( 1.0 ) ) ) * adjustUniforms.uExposure ), vec3<f32>( 0.0 ), vec3<f32>( 1.0 ) ),
			color.a
		);
	}

	let cm = adjustUniforms.uColorMatrix;
	var result = vec4<f32>( 0.0 );

	result.r = cm[0][0] * color.r + cm[0][1] * color.g + cm[0][2] * color.b
		+ cm[0][3] * color.a + cm[1][0];
	result.g = cm[1][1] * color.r + cm[1][2] * color.g + cm[1][3] * color.b
		+ cm[2][0] * color.a + cm[2][1];
	result.b = cm[2][2] * color.r + cm[2][3] * color.g + cm[3][0] * color.b
		+ cm[3][1] * color.a + cm[3][2];
	result.a = cm[3][3] * color.r + cm[4][0] * color.g + cm[4][1] * color.b
		+ cm[4][2] * color.a + cm[4][3];

	if ( adjustUniforms.uVibrance != 0.0 ) {
		result = vec4<f32>(
			applyVibrance( clamp( result.rgb, vec3<f32>( 0.0 ), vec3<f32>( 1.0 ) ), adjustUniforms.uVibrance ),
			result.a
		);
	}

	result = vec4<f32>( clamp( result.rgb, vec3<f32>( 0.0 ), vec3<f32>( 1.0 ) ), result.a );

	if ( adjustUniforms.uVignette != 0.0 || adjustUniforms.uGrain > 0.0 ) {
		let span = max( gfu.uInputClamp.zw - gfu.uInputClamp.xy, vec2<f32>( 1e-6 ) );
		let local = ( uv - gfu.uInputClamp.xy ) / span;

		if ( adjustUniforms.uVignette != 0.0 ) {
			let d = length( local - 0.5 ) / 0.7071;
			let falloff = smoothstep( 0.35, 1.0, d );

			result = vec4<f32>( result.rgb * ( 1.0 - falloff * adjustUniforms.uVignette ), result.a );
		}

		if ( adjustUniforms.uGrain > 0.0 ) {
			let noise = hash( position.xy + adjustUniforms.uSeed ) - 0.5;
			let luma = dot( result.rgb, LUMA );
			let weight = 1.0 - abs( luma - 0.5 ) * 2.0;

			result = vec4<f32>(
				result.rgb + noise * adjustUniforms.uGrain * 0.25 * weight,
				result.a
			);
		}

		result = vec4<f32>( clamp( result.rgb, vec3<f32>( 0.0 ), vec3<f32>( 1.0 ) ), result.a );
	}

	if ( adjustUniforms.uLutMix > 0.0 ) {
		// Sampled at texel centres, so a hard step in a curve stays hard.
		let coord = ( result.rgb * 255.0 + 0.5 ) / 256.0;

		result = vec4<f32>(
			textureSample( uLut, uLutSampler, vec2<f32>( coord.r, 0.5 ) ).r,
			textureSample( uLut, uLutSampler, vec2<f32>( coord.g, 0.5 ) ).g,
			textureSample( uLut, uLutSampler, vec2<f32>( coord.b, 0.5 ) ).b,
			result.a
		);
	}

	return vec4<f32>( result.rgb * result.a, result.a );
}
`;
