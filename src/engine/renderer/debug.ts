/**
 * What the renderer will tell you when something looks wrong.
 *
 * Reached from the console through `wp.lienzo` -> the editor's `debug()`. The fields
 * are chosen for the failures that actually happen: a layer with no texture, a
 * document that never composed, and a sampling mode that did not follow the zoom.
 */

import type { CanvasSize, Layer } from '../../model/document';
import type { Viewport } from './camera';
import type { GpuTexture } from './gpu';
import type { LayerTextures } from './layer-textures';

/** A snapshot of the renderer's internals. */
export interface DebugSubject {
	canvas: CanvasSize;
	stack: Layer[];
	layers: LayerTextures;
	source: GpuTexture | null;
	document: GpuTexture | null;
	zoom: number;
	spriteScale: number | null;
	/** Where the picture sits on screen, which is what maps a click to a pixel. */
	viewport: Viewport | null;
	/** The backend actually in use, which `auto` makes a question worth asking. */
	backend: string;
	/** Whether intermediate render targets are half-float here. */
	precise: boolean;
}

/**
 * The sampling mode a texture is currently using.
 *
 * @param texture Texture to inspect.
 */
function scaleModeOf( texture: GpuTexture | null ): string | null {
	return texture
		? ( texture.source as unknown as { scaleMode: string } ).scaleMode
		: null;
}

/**
 * Builds the diagnostic dump.
 *
 * @param subject Renderer internals.
 */
export function rendererDebugState(
	subject: DebugSubject
): Record< string, unknown > {
	const { document } = subject;

	return {
		canvas: { ...subject.canvas },
		layerCount: subject.stack.length,
		layers: subject.stack.map( ( layer ) => ( {
			id: layer.id,
			kind: layer.kind,
			visible: layer.visible,
			hasTexture: subject.layers.has( layer.id ),
			isRenderTexture: subject.layers.isTarget( layer.id ),
		} ) ),
		zoom: subject.zoom,
		spriteScale: subject.spriteScale,
		viewport: subject.viewport ? { ...subject.viewport } : null,
		backend: subject.backend,
		preciseIntermediates: subject.precise,
		documentScaleMode: scaleModeOf( document ),
		sourceScaleMode: scaleModeOf( subject.source ),
		hasDocumentTexture: !! document,
		documentSize: document ? { w: document.width, h: document.height } : null,
	};
}
