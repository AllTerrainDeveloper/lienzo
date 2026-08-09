/**
 * Copies the PixiJS browser build out of node_modules and into assets/vendor/.
 *
 * Pixi is *vendored*, not bundled, and the distinction is the whole design. Bundling
 * would put a second Pixi 8 instance on every page the desktop shell is running on,
 * and two of them share GPU resource registries through globals -- tearing one down
 * invalidates textures belonging to the other. Vendoring a separate file lets the
 * loader check `window.PIXI` first and inject this one only when there is nothing to
 * reuse, which in practice means only in classic admin.
 *
 * It has to be a file inside the plugin rather than a CDN URL: WordPress.org forbids
 * loading code from anywhere but the site itself, and quite right too.
 *
 * The output is committed, so the plugin is installable straight from a checkout and
 * the release zip needs no npm install.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const vendorDir = resolve( root, 'assets/vendor' );

const files = [
	{
		from: resolve( root, 'node_modules/pixi.js/dist/pixi.min.js' ),
		to: resolve( vendorDir, 'pixi.min.js' ),
	},
	// MIT, and the licence text ships beside the code it covers. A minified bundle
	// with no licence in the tree is exactly what a plugin review asks about.
	{
		from: resolve( root, 'node_modules/pixi.js/LICENSE' ),
		to: resolve( vendorDir, 'pixi-LICENSE.txt' ),
	},
];

mkdirSync( vendorDir, { recursive: true } );

for ( const file of files ) {
	if ( ! existsSync( file.from ) ) {
		console.error(
			`vendor-pixi: ${ relative( root, file.from ) } is missing. Run npm install first.`
		);
		process.exit( 1 );
	}

	copyFileSync( file.from, file.to );

	const size = ( statSync( file.to ).size / 1024 ).toFixed( 0 );

	console.log( `vendor-pixi: ${ relative( root, file.to ) } (${ size }KB)` );
}
