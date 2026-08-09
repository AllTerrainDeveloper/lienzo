<?php
/**
 * The classic-admin editor page.
 *
 * Reachable at `upload.php?page=lienzo&attachment=<id>`, under Media. This is the
 * simplest of the editor's hosts and the one the others are validated against: if
 * mounting works here it works in the media modal, the block editor and a desktop
 * native window, because all four call the same `window.lienzo.mount()`.
 *
 * It exists because desktop mode is a *per-user preference*. OpenStation is installed
 * -- Lienzo requires it -- but a user who has switched it off has no shell on the page
 * to render into, and until now that left them with an editor they had installed and
 * could not open.
 *
 * Everything the editor itself needs survives that: `src/platform.ts` already resolves
 * every control to a plain-DOM equivalent per component, and `src/engine/pixi-loader.ts`
 * loads OpenStation's own PixiJS straight from its directory when the module registry
 * is not on the page. What the shell adds is the window, the icons and the drag bridge,
 * and none of those is the editor.
 *
 * @package Lienzo
 */

defined( 'ABSPATH' ) || exit;

/** The `page` query argument, and the submenu slug. */
define( 'LIENZO_PAGE_SLUG', 'lienzo' );

add_action( 'admin_menu', 'lienzo_register_admin_page' );

/**
 * Registers the editor page under the Media menu.
 *
 * Under `upload.php` rather than as a top-level menu: it edits things that live in
 * the media library, and a top-level entry for a tool most sites use occasionally is
 * how admin menus become unusable.
 *
 * @since 0.1.0
 *
 * @return void
 */
function lienzo_register_admin_page() {
	$hook = add_submenu_page(
		'upload.php',
		__( 'Lienzo Image Editor', 'lienzo' ),
		__( 'Edit Photos', 'lienzo' ),
		'upload_files',
		LIENZO_PAGE_SLUG,
		'lienzo_render_admin_page'
	);

	if ( $hook ) {
		add_action( 'load-' . $hook, 'lienzo_load_admin_page' );
	}
}

/**
 * Prepares the editor page: enqueues assets and collapses the admin chrome.
 *
 * On `load-{$hook}` rather than `admin_enqueue_scripts` with a screen check, so the
 * condition is the hook itself rather than a string comparison that goes stale the
 * moment the slug changes.
 *
 * @since 0.1.0
 *
 * @return void
 */
function lienzo_load_admin_page() {
	lienzo_enqueue_editor();

	add_filter( 'admin_body_class', 'lienzo_admin_body_class' );
}

/**
 * Adds the body class the stylesheet uses to collapse the admin chrome.
 *
 * @since 0.1.0
 *
 * @param string $classes Space-separated body classes.
 * @return string Filtered body classes.
 */
function lienzo_admin_body_class( $classes ) {
	return $classes . ' lienzo-page';
}

/**
 * Returns the URL of the editor page.
 *
 * @since 0.1.0
 *
 * @param int $attachment_id Optional. Image to open. 0 shows the library picker.
 * @return string Admin URL.
 */
function lienzo_editor_page_url( $attachment_id = 0 ) {
	$args = array( 'page' => LIENZO_PAGE_SLUG );

	if ( $attachment_id > 0 ) {
		$args['attachment'] = (int) $attachment_id;
	}

	return add_query_arg( $args, admin_url( 'upload.php' ) );
}

/**
 * Renders the editor page.
 *
 * Emits a mount point and nothing else. The bundle reads the `attachment` query
 * argument and decides whether to open that image or show the library picker.
 *
 * @since 0.1.0
 *
 * @return void
 */
function lienzo_render_admin_page() {
	if ( ! current_user_can( 'upload_files' ) ) {
		wp_die(
			esc_html__( 'You are not allowed to edit images.', 'lienzo' ),
			'',
			array( 'response' => 403 )
		);
	}

	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only navigation argument; the REST layer authorises the actual load.
	$attachment_id = isset( $_GET['attachment'] ) ? absint( $_GET['attachment'] ) : 0;

	printf(
		'<div class="lienzo-root" data-lienzo-root data-attachment="%d" data-host="page"></div>',
		(int) $attachment_id
	);
}
