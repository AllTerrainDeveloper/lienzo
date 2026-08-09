<?php
/**
 * The OpenStation requirement.
 *
 * Lienzo is an OpenStation application, not a standalone plugin that happens to
 * integrate with one. The rendering library is OpenStation's: Lienzo ships no PixiJS
 * and borrows the shell's, which is what keeps it a few tens of kilobytes instead of
 * eight hundred and keeps exactly one Pixi on the page. An editor with no Pixi cannot
 * draw a pixel, on any screen.
 *
 * So the requirement is checked once, early, and the rest of the plugin only loads
 * when it is satisfied. `Requires Plugins` in the plugin header covers installation;
 * this covers the case where OpenStation is installed but deactivated afterwards,
 * which WordPress permits.
 *
 * What it does *not* gate is the editor's surface. OpenStation being active and a user
 * having switched desktop mode on are different questions -- the second is a per-user
 * preference -- and with it off there is still an editor, on its own admin page and in
 * an overlay. See `includes/admin-page.php`.
 *
 * @package Lienzo
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether OpenStation is present and able to host a native window.
 *
 * Tested by capability rather than by plugin slug: what matters is that the functions
 * being called exist, not what the directory holding them is named. A fork, a rename
 * or a bundled copy all work; an OpenStation too old to register native windows
 * correctly does not, and says so.
 *
 * @since 0.1.0
 *
 * @return bool True when the plugin can run.
 */
function lienzo_requirements_met() {
	return lienzo_shell_has( 'register_window' ) && lienzo_shell_has( 'is_enabled' );
}

add_action( 'admin_notices', 'lienzo_requirements_notice' );

/**
 * Explains why nothing happened, on the plugins screen.
 *
 * Only on that screen: a notice on every admin page would be nagging, and the plugins
 * screen is where someone who just activated Lienzo is standing.
 *
 * @since 0.1.0
 *
 * @return void
 */
function lienzo_requirements_notice() {
	$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;

	if ( ! $screen || 'plugins' !== $screen->id || lienzo_requirements_met() ) {
		return;
	}

	if ( ! current_user_can( 'activate_plugins' ) ) {
		return;
	}

	printf(
		'<div class="notice notice-warning"><p><strong>%1$s</strong> %2$s</p></div>',
		esc_html__( 'Lienzo needs OpenStation.', 'lienzo' ),
		esc_html__(
			'The image editor renders with the PixiJS that OpenStation provides, rather than shipping a second copy of it. Activate OpenStation to use Lienzo.',
			'lienzo'
		)
	);
}
