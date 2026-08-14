<?php
/**
 * Media Library entry points.
 *
 * @package AllTerrain_Photo_Editor
 */

/**
 * Tests for includes/media-actions.php.
 *
 * @group lienzo
 * @group lienzo-media-actions
 */
class Tests_Lienzo_Media_Actions extends WP_UnitTestCase {

	/**
	 * Creates an image attachment from the test suite's sample JPEG.
	 *
	 * @return int Attachment ID.
	 */
	private function make_image() {
		return self::factory()->attachment->create_upload_object( DIR_TESTDATA . '/images/canola.jpg' );
	}

	/**
	 * An administrator sees the row action, pointing at the editor.
	 *
	 * @covers ::lienzo_media_row_action
	 */
	public function test_row_action_added_for_editable_image() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$id      = $this->make_image();
		$actions = lienzo_media_row_action( array(), get_post( $id ) );

		$this->assertArrayHasKey( 'lienzo', $actions );
		// A link the bundle upgrades in place: the attribute is what the click handler
		// looks for, and the href is where the click goes if the bundle never ran.
		$this->assertStringContainsString(
			'data-lienzo-open="' . $id . '"',
			$actions['lienzo']
		);
		$this->assertStringContainsString(
			esc_url( lienzo_editor_page_url( $id ) ),
			$actions['lienzo']
		);
	}

	/**
	 * The row action is absent for a user who cannot edit the attachment.
	 *
	 * A link that leads to a permission error is worse than no link at all.
	 *
	 * @covers ::lienzo_media_row_action
	 */
	public function test_row_action_hidden_without_capability() {
		$id = $this->make_image();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->assertSame( array(), lienzo_media_row_action( array(), get_post( $id ) ) );
	}

	/**
	 * The row action is absent for file types the editor cannot open.
	 *
	 * @covers ::lienzo_media_row_action
	 */
	public function test_row_action_hidden_for_unsupported_type() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$id = self::factory()->attachment->create_object(
			array(
				'file'           => 'notes.txt',
				'post_mime_type' => 'text/plain',
			)
		);

		$this->assertSame( array(), lienzo_media_row_action( array(), get_post( $id ) ) );
	}

	/**
	 * Existing row actions are preserved rather than replaced.
	 *
	 * @covers ::lienzo_media_row_action
	 */
	public function test_row_action_preserves_existing() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$id      = $this->make_image();
		$actions = lienzo_media_row_action( array( 'edit' => '<a href="#">Edit</a>' ), get_post( $id ) );

		$this->assertArrayHasKey( 'edit', $actions );
		$this->assertArrayHasKey( 'lienzo', $actions );
	}

	/**
	 * The attachment edit screen gets a button.
	 *
	 * @covers ::lienzo_attachment_edit_button
	 */
	public function test_submitbox_button_rendered() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$id = $this->make_image();

		ob_start();
		lienzo_attachment_edit_button( get_post( $id ) );
		$html = ob_get_clean();

		$this->assertStringContainsString( 'data-lienzo-open="' . $id . '"', $html );
		$this->assertStringContainsString( esc_url( lienzo_editor_page_url( $id ) ), $html );
	}

	/**
	 * The editor page URL carries the image, and stands alone without one.
	 *
	 * @covers ::lienzo_editor_page_url
	 */
	public function test_editor_page_url() {
		$this->assertStringContainsString( 'page=' . LIENZO_PAGE_SLUG, lienzo_editor_page_url() );
		$this->assertStringNotContainsString( 'attachment=', lienzo_editor_page_url() );
		$this->assertStringContainsString( 'attachment=7', lienzo_editor_page_url( 7 ) );
	}

	/**
	 * The config tells the browser where the classic editor and PixiJS live.
	 *
	 * Both are what makes an editor possible with no shell on the page: one is where a
	 * control points when there is no window to open, the other is OpenStation's own
	 * Pixi, which is the only Pixi there is -- AllTerrain Photo Editor ships none.
	 *
	 * @covers ::lienzo_get_config
	 * @covers ::lienzo_pixi_url
	 */
	public function test_config_carries_the_classic_admin_inputs() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		add_filter( 'lienzo_pixi_url', static fn() => 'https://example.org/os/assets/vendor/pixi.min.js' );

		$config = lienzo_get_config();

		remove_all_filters( 'lienzo_pixi_url' );

		$this->assertStringContainsString( 'page=' . LIENZO_PAGE_SLUG, $config['editorUrl'] );
		$this->assertStringContainsString( 'pixi.min.js', $config['pixiUrl'] );
		$this->assertSame( 'webgl', $config['renderer'] );
	}

	/**
	 * With no OpenStation directory to read, the Pixi URL is empty rather than a guess.
	 *
	 * One plugin reaching into another's directory should fail loudly and early or not
	 * at all. The test suite stubs OpenStation's functions but not its constants, so
	 * this is the unresolvable case, exercised honestly.
	 *
	 * @covers ::lienzo_pixi_url
	 */
	public function test_pixi_url_is_empty_when_openstation_cannot_be_located() {
		$this->assertSame( '', lienzo_pixi_url() );
	}

	/**
	 * A site can move the editor onto WebGPU, and cannot move it onto nonsense.
	 *
	 * @covers ::lienzo_renderer_backend
	 */
	public function test_renderer_backend_is_filterable_within_bounds() {
		add_filter( 'lienzo_renderer_backend', static fn() => 'auto' );
		$this->assertSame( 'auto', lienzo_renderer_backend() );
		remove_all_filters( 'lienzo_renderer_backend' );

		add_filter( 'lienzo_renderer_backend', static fn() => 'metal' );
		$this->assertSame( 'webgl', lienzo_renderer_backend() );
		remove_all_filters( 'lienzo_renderer_backend' );
	}

	/**
	 * The button is not rendered without the capability.
	 *
	 * @covers ::lienzo_attachment_edit_button
	 */
	public function test_submitbox_button_hidden_without_capability() {
		$id = $this->make_image();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		ob_start();
		lienzo_attachment_edit_button( get_post( $id ) );

		$this->assertSame( '', ob_get_clean() );
	}

	/**
	 * The config carries what the picker needs to list the library.
	 *
	 * @covers ::lienzo_get_config
	 */
	public function test_config_exposes_picker_inputs() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$config = lienzo_get_config();

		$this->assertStringContainsString( 'wp/v2/media', $config['mediaUrl'] );
		$this->assertContains( 'image/jpeg', $config['supportedMimes'] );
		$this->assertNotContains( 'image/gif', $config['supportedMimes'] );
	}
}
