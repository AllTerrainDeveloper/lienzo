<?php
/**
 * Entry points into the editor from the Media Library.
 *
 * A row action in list mode and a button on the attachment edit screen. Both are
 * links, and both carry a `data-lienzo-open` attribute: the bundle intercepts the
 * click and opens the editor without navigating -- a desktop window inside the shell,
 * an overlay in classic admin -- and the `href` is what happens when it cannot, which
 * is the classic editor page.
 *
 * A link that JavaScript upgrades, rather than a button that JavaScript is required
 * for. Linking straight to the page would be wrong inside the shell, where that page
 * loads as an *iframe* window and the editor can reach neither Pixi nor the shell's
 * components; a bare button would be wrong everywhere else, because it does nothing
 * at all if the bundle failed to load.
 *
 * The richer surfaces -- a button inside the grid modal and one on the block editor's
 * image toolbar -- patch Backbone views and register a block filter from JavaScript,
 * and end up in the same place.
 *
 * @package Lienzo
 */

defined( 'ABSPATH' ) || exit;

add_filter( 'media_row_actions', 'lienzo_media_row_action', 10, 2 );
add_action( 'attachment_submitbox_misc_actions', 'lienzo_attachment_edit_button', 20 );
add_action( 'admin_enqueue_scripts', 'lienzo_enqueue_on_media_screens' );
add_action( 'enqueue_block_editor_assets', 'lienzo_enqueue_for_block_editor' );

/**
 * Loads the editor on screens where the media modal can appear.
 *
 * The modal is reachable from the media library, the post editors, and the
 * customizer, but not from most of wp-admin -- loading a 28KB bundle on Settings
 * pages to add a button that can never render would be careless.
 *
 * @since 0.1.0
 *
 * @param string $hook_suffix Current admin page.
 * @return void
 */
function lienzo_enqueue_on_media_screens( $hook_suffix ) {
	if ( ! current_user_can( 'upload_files' ) ) {
		return;
	}

	$screens = array( 'upload.php', 'post.php', 'post-new.php' );

	/**
	 * Filters the admin screens the editor bundle loads on.
	 *
	 * Add a screen here if a plugin surfaces the media modal somewhere unusual.
	 *
	 * @since 0.1.0
	 *
	 * @param string[] $screens     Admin page hook suffixes.
	 * @param string   $hook_suffix Current admin page.
	 */
	$screens = (array) apply_filters( 'lienzo_media_screens', $screens, $hook_suffix );

	if ( ! in_array( $hook_suffix, $screens, true ) ) {
		return;
	}

	lienzo_enqueue_editor();
}

/**
 * Loads the editor in the block editor, for the image block's toolbar button.
 *
 * @since 0.1.0
 *
 * @return void
 */
function lienzo_enqueue_for_block_editor() {
	if ( ! current_user_can( 'upload_files' ) ) {
		return;
	}

	lienzo_enqueue_editor();

	// The toolbar button is built with wp.element rather than JSX, so these are
	// runtime globals rather than bundled imports -- but they still have to be on
	// the page before our bundle runs.
	wp_enqueue_script( 'wp-block-editor' );
	wp_enqueue_script( 'wp-components' );
	wp_enqueue_script( 'wp-hooks' );
	wp_enqueue_script( 'wp-element' );
}

/**
 * Adds "Edit with Lienzo" to the Media Library list-table row actions.
 *
 * Only appears for images Lienzo can actually open, so the link is never a
 * promise the editor cannot keep.
 *
 * @since 0.1.0
 *
 * @param string[] $actions Row action links keyed by action name.
 * @param WP_Post  $post    Attachment being listed.
 * @return string[] Filtered row actions.
 */
function lienzo_media_row_action( $actions, $post ) {
	if ( ! lienzo_can_edit( $post->ID ) ) {
		return $actions;
	}

	$actions['lienzo'] = sprintf(
		'<a href="%1$s" data-lienzo-open="%2$d">%3$s</a>',
		esc_url( lienzo_editor_page_url( $post->ID ) ),
		(int) $post->ID,
		esc_html__( 'Edit with Lienzo', 'lienzo' )
	);

	return $actions;
}

/**
 * Adds an "Edit with Lienzo" button to the attachment edit screen.
 *
 * Sits in the Publish box beside core's own actions, which is where someone
 * already looking at a single attachment expects to find things to do to it.
 *
 * @since 0.1.0
 *
 * @param WP_Post $post Attachment being edited.
 * @return void
 */
function lienzo_attachment_edit_button( $post ) {
	if ( ! lienzo_can_edit( $post->ID ) ) {
		return;
	}

	printf(
		'<div class="misc-pub-section misc-pub-lienzo"><a class="button" href="%1$s" data-lienzo-open="%2$d">%3$s</a></div>',
		esc_url( lienzo_editor_page_url( $post->ID ) ),
		(int) $post->ID,
		esc_html__( 'Edit with Lienzo', 'lienzo' )
	);
}
