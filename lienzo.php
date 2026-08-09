<?php
/**
 * Plugin Name:       Lienzo.
 * Plugin URI:        https://github.com/AllTerrainDeveloper/lienzo
 * Description:       A modern, non-destructive image editor for the WordPress media library. Exposure, colour and tone adjustments rendered on the GPU, in the browser.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Daniel Lopez
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       lienzo
 *
 * Lienzo is at its best as an OpenStation application: it runs as a native window
 * inside the desktop shell -- rendering into the shell's own DOM rather than into an
 * iframe -- and takes its PixiJS from the shell's module registry instead of loading a
 * second copy. Two Pixi 8 instances on one page share GPU resource registries through
 * globals, so one is not merely smaller but safer. Running natively is also what gives
 * the editor the shell's components, its drag bridge and its window chrome, none of
 * which is reachable from inside a chromeless iframe.
 *
 * It does not *require* any of that. The editor itself needs a canvas, a mount point
 * and Pixi, so with no shell on the site it opens on its own admin page under Media
 * and in an overlay over the media modal and the block editor. `src/platform.ts`
 * resolves every control to a plain-DOM equivalent component by component, and the
 * loader falls back to the vendored Pixi -- so what is lost without the shell is the
 * window, the desktop icon and the drag bridge, and not the editor.
 *
 * The desktop integration therefore sits behind a capability check while everything
 * else loads unconditionally.
 *
 * @package Lienzo
 */

defined( 'ABSPATH' ) || exit;

define( 'LIENZO_VERSION', '0.1.0' );
define( 'LIENZO_FILE', __FILE__ );
define( 'LIENZO_DIR', plugin_dir_path( __FILE__ ) );
define( 'LIENZO_URL', plugin_dir_url( __FILE__ ) );
define( 'LIENZO_REST_NAMESPACE', 'lienzo/v1' );

/**
 * Id of the base image layer, shared with the TypeScript twin in `model/document.ts`.
 */
define( 'LIENZO_BASE_LAYER_ID', 'base' );

/**
 * Post meta key holding the serialized edit recipe on a rendered attachment.
 */
define( 'LIENZO_RECIPE_META', '_lienzo_recipe' );

/**
 * Post meta key holding the ID of the attachment the pixels originally came from.
 */
define( 'LIENZO_SOURCE_META', '_lienzo_source' );

/**
 * The keys these two were called before the plugin was renamed.
 *
 * Read as a fallback and never written. An image edited under the old name still holds
 * its recipe there, and a rename is no reason for someone's saved edit to stop
 * re-opening -- the pixels would still be theirs, but every slider would be back at
 * zero and the link to the original lost.
 */
define( 'LIENZO_LEGACY_RECIPE_META', '_daguerre_recipe' );
define( 'LIENZO_LEGACY_SOURCE_META', '_daguerre_source' );

require_once LIENZO_DIR . 'includes/shell-api.php';
require_once LIENZO_DIR . 'includes/requirements.php';

add_action( 'plugins_loaded', 'lienzo_boot', 5 );

/**
 * Loads the plugin.
 *
 * On `plugins_loaded` rather than at file scope, and that is not a detail: plugins are
 * loaded in alphabetical order, so `lienzo` runs *before* the shell and none of its
 * functions exist yet when this file is first read. Asking about the shell then would
 * answer "absent" on every site, every time.
 *
 * Priority 5 leaves room for the desktop registrations at 20 to be added by an include
 * loaded here -- WordPress runs callbacks added to a hook that is already firing, as
 * long as they sit at a later priority.
 *
 * Everything here loads whether or not a shell is present. `desktop-mode.php` is the
 * one file that is about the shell, and every registration inside it is behind its own
 * capability check, so on a site without one it simply registers nothing.
 *
 * @since 0.1.0
 *
 * @return void
 */
function lienzo_boot() {
	require_once LIENZO_DIR . 'includes/helpers.php';
	require_once LIENZO_DIR . 'includes/recipe.php';
	require_once LIENZO_DIR . 'includes/post-image.php';
	require_once LIENZO_DIR . 'includes/post-attach.php';
	require_once LIENZO_DIR . 'includes/presets.php';
	require_once LIENZO_DIR . 'includes/render.php';
	require_once LIENZO_DIR . 'includes/rest.php';
	require_once LIENZO_DIR . 'includes/assets.php';
	require_once LIENZO_DIR . 'includes/admin-page.php';
	require_once LIENZO_DIR . 'includes/media-actions.php';
	require_once LIENZO_DIR . 'includes/desktop-mode.php';
}
