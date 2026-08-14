<?php
/**
 * Uninstall routine.
 *
 * AllTerrain Photo Editor stores exactly two things outside its own files: the edit recipe and the
 * source pointer, both as post meta on attachments it created. Those attachments are
 * ordinary media items and are deliberately left alone -- deleting a user's photos
 * because they removed an editor would be indefensible. Only the metadata goes.
 *
 * @package AllTerrain_Photo_Editor
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_post_meta_by_key( '_lienzo_recipe' );
delete_post_meta_by_key( '_lienzo_source' );
