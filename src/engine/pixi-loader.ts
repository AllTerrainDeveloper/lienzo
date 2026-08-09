/**
 * Getting PixiJS, from the shell where there is one.
 *
 * Two sources, in this order:
 *
 * 1. **The shell's copy.** OpenStation vendors Pixi v8 and registers it in its module
 *    registry as `pixijs`. Asking for it there is both smaller and safer than loading
 *    a second one: two Pixi 8 instances on a page share GPU resource registries
 *    through globals, and tearing one down can invalidate textures belonging to the
 *    other.
 * 2. **The copy this plugin ships.** In classic admin there is no shell to borrow
 *    from, and an editor with no Pixi cannot draw a pixel. The build vendors
 *    `assets/vendor/pixi.min.js` -- WordPress.org forbids loading code from a CDN, so
 *    it has to be a file inside the plugin -- and it is injected only when nothing
 *    else has already put Pixi on the page.
 *
 * The order is the whole point. Checking `window.PIXI` and the registry *first* means
 * a page that already has Pixi never gets a second one, and the classic-admin fallback
 * costs nothing on a desktop-shell page because it is never reached.
 *
 * Both spellings of the shell namespace are read, for the reason set out in
 * `platform.ts`: OpenStation 0.9.9 renamed `wp.desktop` to `wp.os` and Lienzo ships to
 * sites running either version. This file used to read only `wp.desktop`, which meant
 * that on a current shell the loader looked exactly like a page with no shell at all.
 */

import type * as PixiNamespace from 'pixi.js';

/** The Pixi module namespace, as exposed on `window.PIXI` by the UMD build. */
export type Pixi = typeof PixiNamespace;

/** The id OpenStation registers its Pixi build under. */
const MODULE_ID = 'pixijs';

/** The narrow part of the shell API this file needs. */
interface DesktopModules {
	loadModules?: ( ids: string[] ) => Promise< void >;
}

/** In-flight or settled injection, so concurrent callers share one script tag. */
let injection: Promise< Pixi > | null = null;

/**
 * Reads the shell's module loader, if the shell is on this page.
 *
 * Deliberately NOT gated on `isActive()` the way `platform.ts` gates its adapters:
 * that flag answers "should this look like a desktop app", and the module registry
 * works whenever the shell bundle is present. Gating here would load a second Pixi
 * onto a page that already has a perfectly good one.
 */
function shell(): DesktopModules | undefined {
	const wp = window.wp as
		| { os?: DesktopModules; desktop?: DesktopModules }
		| undefined;

	return wp?.os ?? wp?.desktop;
}

/**
 * Resolves with a usable Pixi namespace.
 *
 * @return The Pixi namespace.
 * @throws {Error} When neither source can produce one.
 */
export async function loadPixi(): Promise< Pixi > {
	if ( window.PIXI ) {
		return window.PIXI;
	}

	const desktop = shell();

	if ( desktop?.loadModules ) {
		await desktop.loadModules( [ MODULE_ID ] );

		if ( window.PIXI ) {
			return window.PIXI;
		}

		// The shell said it loaded its module and did not define the global. Falling
		// through to our own copy is better than failing: the alternative is an editor
		// that cannot open on a site whose shell is half-upgraded.
	}

	return injectVendored();
}

/**
 * Injects the copy of Pixi this plugin ships.
 *
 * @return The Pixi namespace.
 * @throws {Error} When the file is missing from the config or fails to load.
 */
function injectVendored(): Promise< Pixi > {
	if ( injection ) {
		return injection;
	}

	const url = window.lienzoConfig?.pixiUrl;

	if ( ! url ) {
		return Promise.reject(
			new Error(
				'Lienzo cannot find PixiJS: no desktop shell on this page, and no vendored build in the configuration.'
			)
		);
	}

	injection = new Promise< Pixi >( ( resolve, reject ) => {
		const settle = () => {
			if ( window.PIXI ) {
				resolve( window.PIXI );
			} else {
				reject(
					new Error(
						'PixiJS loaded but did not define window.PIXI. The vendored build may be corrupt.'
					)
				);
			}
		};

		const fail = () => {
			// Cleared so a later attempt can retry rather than replaying the failure
			// forever -- a script that failed on a flaky network usually succeeds next
			// time, and there is a "next time" every time the editor is opened.
			injection = null;
			reject( new Error( `Could not load PixiJS from ${ url }` ) );
		};

		// Another bundle -- a second copy of this one, which is exactly what happens
		// inside the desktop shell -- may already have injected the same script and be
		// waiting on it. Adopt that tag rather than racing a second one.
		const selector = `script[data-lienzo-vendor="${ CSS.escape( url ) }"]`;
		const existing = document.querySelector< HTMLScriptElement >( selector );

		if ( existing ) {
			existing.addEventListener( 'load', settle, { once: true } );
			existing.addEventListener( 'error', fail, { once: true } );

			return;
		}

		const script = document.createElement( 'script' );

		script.src = url;
		script.async = true;
		script.dataset.lienzoVendor = url;
		script.addEventListener( 'load', settle, { once: true } );
		script.addEventListener( 'error', fail, { once: true } );

		document.head.appendChild( script );
	} );

	return injection;
}
