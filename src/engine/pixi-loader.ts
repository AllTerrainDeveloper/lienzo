/**
 * Getting PixiJS from the shell.
 *
 * Lienzo ships no rendering library, and that is a deliberate part of what it *is*:
 * OpenStation already vendors PixiJS v8 (MIT), so borrowing it keeps this plugin a
 * few tens of kilobytes instead of eight hundred, and keeps exactly one Pixi on the
 * page. Two Pixi 8 instances share GPU resource registries through globals, and
 * tearing one down can invalidate textures belonging to the other. There is no version
 * to keep in step and no second copy to go stale.
 *
 * Three ways to reach the same file, in this order:
 *
 * 1. **`window.PIXI`**, if anything has already put it there.
 * 2. **The shell's module registry** — `loadModules( [ 'pixijs' ] )`, which is
 *    idempotent and de-duplicates concurrent callers, so several windows opening at
 *    once still load one script.
 * 3. **The shell's own vendored file**, by URL. The registry lives in the shell's
 *    desktop bundle, so on a *classic* admin screen there is no registry to ask --
 *    but the plugin is installed and its file is right there, and PHP resolves the
 *    URL from the shell's own constant rather than either plugin guessing.
 *
 * The third step is what lets the editor open in classic admin without Lienzo
 * carrying a second copy of Pixi to do it.
 *
 * Both spellings of the namespace are read, for the reason set out in `platform.ts`:
 * OpenStation 0.9.9 renamed `wp.desktop` to `wp.os` and Lienzo ships to sites running
 * either version. This file used to read only `wp.desktop`, which meant that on a
 * current shell the loader looked exactly like a page with no shell at all and every
 * canvas failed to open with "Lienzo needs OpenStation".
 */

import type * as PixiNamespace from 'pixi.js';

/** The Pixi module namespace, as exposed on `window.PIXI` by the UMD build. */
export type Pixi = typeof PixiNamespace;

/** The id the shell registers its Pixi build under. */
const MODULE_ID = 'pixijs';

/** The narrow part of the shell API this file needs. */
interface DesktopModules {
	loadModules?: ( ids: string[] ) => Promise< void >;
}

/** In-flight or settled injection, so concurrent callers share one script tag. */
let injection: Promise< Pixi > | null = null;

/**
 * Reads the shell's module loader, if the shell's bundle is on this page.
 *
 * Deliberately NOT gated on `isActive()` the way `platform.ts` gates its adapters:
 * that flag answers "should this look like a desktop app", and the module registry
 * works whenever the shell bundle is present. Gating here would refuse to reuse a
 * perfectly good Pixi.
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
 * @throws {Error} When the shell cannot be reached at all.
 */
export async function loadPixi(): Promise< Pixi > {
	if ( window.PIXI ) {
		return window.PIXI;
	}

	const desktop = shell();

	if ( desktop?.loadModules ) {
		try {
			await desktop.loadModules( [ MODULE_ID ] );
		} catch {
			// Asking is not the same as the registry having anything to answer with.
			// OpenStation registers `pixijs` while the *desktop* boots, and with desktop
			// mode switched off that never happens even though `wp.os` is on the page for
			// the admin-bar toggle. An unknown id rejects, and letting that reject
			// propagate would fail the whole editor while the file it wanted sat on disk.
		}

		if ( window.PIXI ) {
			return window.PIXI;
		}

		// Either the registry had no such module, or it said it loaded one and did not
		// define the global. Both are reasons to go to the file itself rather than to
		// give up: the alternative is an editor that cannot open on a site whose shell
		// is present but not running.
	}

	return injectFromShell();
}

/**
 * Loads the shell's vendored Pixi by URL.
 *
 * @return The Pixi namespace.
 * @throws {Error} When PHP could not resolve the shell's URL, or the file fails.
 */
function injectFromShell(): Promise< Pixi > {
	if ( injection ) {
		return injection;
	}

	const url = window.lienzoConfig?.pixiUrl;

	if ( ! url ) {
		return Promise.reject(
			new Error(
				'Lienzo needs the desktop shell: PixiJS comes from it, and this page can reach neither its module registry nor its files.'
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
						'PixiJS loaded but did not define window.PIXI. The shell may be mid-upgrade.'
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
		const selector = `script[data-lienzo-pixi="${ CSS.escape( url ) }"]`;
		const existing = document.querySelector< HTMLScriptElement >( selector );

		if ( existing ) {
			existing.addEventListener( 'load', settle, { once: true } );
			existing.addEventListener( 'error', fail, { once: true } );

			return;
		}

		const script = document.createElement( 'script' );

		script.src = url;
		script.async = true;
		script.dataset.lienzoPixi = url;
		script.addEventListener( 'load', settle, { once: true } );
		script.addEventListener( 'error', fail, { once: true } );

		document.head.appendChild( script );
	} );

	return injection;
}
