<?php
/**
 * Capability and source-resolution helpers.
 *
 * @package AllTerrain_Photo_Editor
 */

/**
 * Tests for includes/helpers.php.
 *
 * @group lienzo
 * @group lienzo-helpers
 */
class Tests_Lienzo_Helpers extends WP_UnitTestCase {

	/**
	 * Creates an image attachment from the test suite's sample JPEG.
	 *
	 * @param int $author_id Optional. Attachment author.
	 * @return int Attachment ID.
	 */
	private function make_image( $author_id = 0 ) {
		$file = DIR_TESTDATA . '/images/canola.jpg';
		$id   = self::factory()->attachment->create_upload_object( $file );

		if ( $author_id ) {
			wp_update_post(
				array(
					'ID'          => $id,
					'post_author' => $author_id,
				)
			);
		}

		return $id;
	}

	/**
	 * JPEG, PNG, WebP and AVIF are editable; GIF is not.
	 *
	 * GIF is excluded because rendering it through a canvas silently flattens
	 * animation to one frame, which would be a data-losing surprise.
	 *
	 * @covers ::lienzo_is_supported_mime
	 */
	public function test_supported_mime_types() {
		$this->assertTrue( lienzo_is_supported_mime( 'image/jpeg' ) );
		$this->assertTrue( lienzo_is_supported_mime( 'image/png' ) );
		$this->assertTrue( lienzo_is_supported_mime( 'image/webp' ) );
		$this->assertFalse( lienzo_is_supported_mime( 'image/gif' ) );
		$this->assertFalse( lienzo_is_supported_mime( 'application/pdf' ) );
		$this->assertFalse( lienzo_is_supported_mime( '' ) );
	}

	/**
	 * An administrator can edit an image attachment.
	 *
	 * @covers ::lienzo_can_edit
	 */
	public function test_admin_can_edit_image() {
		$admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$id    = $this->make_image();

		wp_set_current_user( $admin );

		$this->assertTrue( lienzo_can_edit( $id ) );
	}

	/**
	 * A subscriber cannot edit an image attachment.
	 *
	 * @covers ::lienzo_can_edit
	 */
	public function test_subscriber_cannot_edit_image() {
		$subscriber = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		$id         = $this->make_image();

		wp_set_current_user( $subscriber );

		$this->assertFalse( lienzo_can_edit( $id ) );
	}

	/**
	 * An author cannot edit another user's attachment.
	 *
	 * @covers ::lienzo_can_edit
	 */
	public function test_author_cannot_edit_someone_elses_image() {
		$owner = self::factory()->user->create( array( 'role' => 'author' ) );
		$other = self::factory()->user->create( array( 'role' => 'author' ) );
		$id    = $this->make_image( $owner );

		wp_set_current_user( $other );

		$this->assertFalse( lienzo_can_edit( $id ) );
	}

	/**
	 * A non-attachment post is never editable, whatever the capability.
	 *
	 * @covers ::lienzo_can_edit
	 */
	public function test_non_attachment_is_not_editable() {
		$admin   = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create();

		wp_set_current_user( $admin );

		$this->assertFalse( lienzo_can_edit( $post_id ) );
		$this->assertFalse( lienzo_can_edit( 0 ) );
		$this->assertFalse( lienzo_can_edit( 999999 ) );
	}

	/**
	 * The capability check honours an explicit user ID.
	 *
	 * @covers ::lienzo_can_edit
	 */
	public function test_can_edit_accepts_explicit_user_id() {
		$admin      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$subscriber = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		$id         = $this->make_image();

		wp_set_current_user( 0 );

		$this->assertTrue( lienzo_can_edit( $id, $admin ) );
		$this->assertFalse( lienzo_can_edit( $id, $subscriber ) );
	}

	/**
	 * An attachment with no source pointer resolves to itself.
	 *
	 * @covers ::lienzo_resolve_source_id
	 */
	public function test_resolve_source_defaults_to_self() {
		$id = $this->make_image();

		$this->assertSame( $id, lienzo_resolve_source_id( $id ) );
	}

	/**
	 * A rendered attachment resolves back to the original it came from.
	 *
	 * This is what keeps a re-edit first-generation instead of re-rendering
	 * already-baked pixels.
	 *
	 * @covers ::lienzo_resolve_source_id
	 */
	public function test_resolve_source_follows_pointer() {
		$original = $this->make_image();
		$derived  = $this->make_image();

		update_post_meta( $derived, LIENZO_SOURCE_META, $original );

		$this->assertSame( $original, lienzo_resolve_source_id( $derived ) );
	}

	/**
	 * A pointer at a deleted attachment falls back to the attachment itself.
	 *
	 * @covers ::lienzo_resolve_source_id
	 */
	public function test_resolve_source_survives_deleted_original() {
		$original = $this->make_image();
		$derived  = $this->make_image();

		update_post_meta( $derived, LIENZO_SOURCE_META, $original );
		wp_delete_attachment( $original, true );

		$this->assertSame( $derived, lienzo_resolve_source_id( $derived ) );
	}

	/**
	 * A self-referential pointer does not loop.
	 *
	 * @covers ::lienzo_resolve_source_id
	 */
	public function test_resolve_source_ignores_self_pointer() {
		$id = $this->make_image();
		update_post_meta( $id, LIENZO_SOURCE_META, $id );

		$this->assertSame( $id, lienzo_resolve_source_id( $id ) );
	}

	/**
	 * A real attachment yields a readable path on disk.
	 *
	 * @covers ::lienzo_get_source_path
	 */
	public function test_source_path_resolves() {
		$id   = $this->make_image();
		$path = lienzo_get_source_path( $id );

		$this->assertNotWPError( $path );
		$this->assertFileExists( $path );
	}

	/**
	 * A missing attachment yields an error rather than a bare false.
	 *
	 * @covers ::lienzo_get_source_path
	 */
	public function test_source_path_errors_for_missing_attachment() {
		$result = lienzo_get_source_path( 999999 );

		$this->assertWPError( $result );
		$this->assertSame( 'lienzo_no_source_file', $result->get_error_code() );
	}

	/**
	 * The desktop integration is gated on the functions it is about to call.
	 *
	 * By capability rather than by plugin slug, so a fork, a rename or a bundled copy
	 * all satisfy it. The bootstrap stubs the two functions, which is how a test
	 * satisfies it honestly.
	 *
	 * Nothing else is gated on this any more: the editor itself loads either way.
	 *
	 * @covers ::lienzo_requirements_met
	 */
	public function test_requirements_track_the_functions_being_called() {
		$this->assertTrue( function_exists( 'desktop_mode_register_window' ) );
		$this->assertTrue( function_exists( 'desktop_mode_is_enabled' ) );
		$this->assertTrue( lienzo_requirements_met() );
	}

	/**
	 * The editor page exists whether or not a desktop shell does.
	 *
	 * The classic-admin surface is the point: a site with no shell still has a media
	 * library, and everything the editor itself needs -- a mount point, a canvas and
	 * PixiJS -- is reachable without one.
	 *
	 * @covers ::lienzo_register_admin_page
	 * @covers ::lienzo_render_admin_page
	 */
	public function test_classic_admin_page_renders_a_mount_point() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$_GET['attachment'] = 12;

		ob_start();
		lienzo_render_admin_page();
		$html = ob_get_clean();

		unset( $_GET['attachment'] );

		$this->assertStringContainsString( 'data-lienzo-root', $html );
		$this->assertStringContainsString( 'data-host="page"', $html );
		$this->assertStringContainsString( 'data-attachment="12"', $html );
	}

	/**
	 * The page adds the body class the stylesheet collapses the admin chrome with.
	 *
	 * @covers ::lienzo_admin_body_class
	 */
	public function test_admin_body_class_added() {
		$this->assertStringContainsString( 'lienzo-page', lienzo_admin_body_class( 'wp-admin' ) );
	}

	/**
	 * The boolean selection raster defaults to four megapixels and is filterable.
	 *
	 * @covers ::lienzo_max_selection_pixels
	 */
	public function test_selection_pixels_are_filterable() {
		$this->assertSame( 4000000, lienzo_max_selection_pixels() );

		add_filter( 'lienzo_max_selection_pixels', array( $this, 'return_sixteen_megapixels' ) );

		$this->assertSame( 16000000, lienzo_max_selection_pixels() );

		remove_filter( 'lienzo_max_selection_pixels', array( $this, 'return_sixteen_megapixels' ) );
	}

	/**
	 * The magnetic lasso's edge field defaults to two megapixels and is filterable.
	 *
	 * @covers ::lienzo_max_edge_pixels
	 */
	public function test_edge_pixels_are_filterable() {
		$this->assertSame( 2000000, lienzo_max_edge_pixels() );

		add_filter( 'lienzo_max_edge_pixels', array( $this, 'return_sixteen_megapixels' ) );

		$this->assertSame( 16000000, lienzo_max_edge_pixels() );

		remove_filter( 'lienzo_max_edge_pixels', array( $this, 'return_sixteen_megapixels' ) );
	}

	/**
	 * Both ceilings reach the browser, which is the only place they are read.
	 *
	 * @covers ::lienzo_get_config
	 */
	public function test_config_carries_both_ceilings() {
		$this->assertGreaterThan( 0, lienzo_get_config()['maxSelectionPixels'] );
		$this->assertGreaterThan( 0, lienzo_get_config()['maxEdgePixels'] );
	}

	/**
	 * A filter's answer, not the default.
	 *
	 * @return int Sixteen megapixels.
	 */
	public function return_sixteen_megapixels() {
		return 16000000;
	}
}
