<?php
/**
 * Tests for putting an edited image back onto its post.
 *
 * @package AllTerrain_Photo_Editor
 */

/**
 * Tests for includes/post-attach.php.
 *
 * @group lienzo
 * @group lienzo-post-attach
 */
class Tests_Lienzo_Post_Attach extends WP_UnitTestCase {

	/**
	 * Makes an attachment of a given type.
	 *
	 * @param string $mime MIME type.
	 * @return int Attachment ID.
	 */
	private function make_attachment( $mime = 'image/jpeg' ) {
		return self::factory()->attachment->create_object(
			array(
				'file'           => 'lienzo-' . wp_generate_password( 6, false ) . '.jpg',
				'post_mime_type' => $mime,
				'post_type'      => 'attachment',
			)
		);
	}

	/**
	 * A featured image is swapped for the edit.
	 *
	 * @covers ::lienzo_attach_to_post
	 */
	public function test_repoints_the_featured_image() {
		$post = self::factory()->post->create();
		$was  = $this->make_attachment();
		$now  = $this->make_attachment();

		set_post_thumbnail( $post, $was );

		$this->assertTrue( lienzo_attach_to_post( $post, $now, 'thumbnail' ) );
		$this->assertSame( $now, (int) get_post_thumbnail_id( $post ) );
	}

	/**
	 * The whole promise: the image that was replaced is still in the library.
	 *
	 * @covers ::lienzo_attach_to_post
	 */
	public function test_leaves_the_previous_image_in_the_library() {
		$post = self::factory()->post->create();
		$was  = $this->make_attachment();
		$now  = $this->make_attachment();

		set_post_thumbnail( $post, $was );
		lienzo_attach_to_post( $post, $now, 'thumbnail' );

		$this->assertSame( 'attachment', get_post_type( $was ) );
	}

	/**
	 * A gallery swap keeps the image where it was in the order.
	 *
	 * @covers ::lienzo_replace_in_gallery
	 */
	public function test_keeps_a_gallery_images_position() {
		$post   = self::factory()->post->create();
		$first  = $this->make_attachment();
		$second = $this->make_attachment();
		$third  = $this->make_attachment();
		$now    = $this->make_attachment();

		update_post_meta( $post, '_product_image_gallery', "$first,$second,$third" );

		$this->assertTrue( lienzo_attach_to_post( $post, $now, 'gallery', $second ) );
		$this->assertSame(
			"$first,$now,$third",
			get_post_meta( $post, '_product_image_gallery', true )
		);
	}

	/**
	 * Swapping an image the gallery no longer holds is refused, not appended.
	 *
	 * @covers ::lienzo_replace_in_gallery
	 */
	public function test_refuses_a_gallery_swap_for_an_image_that_left() {
		$post   = self::factory()->post->create();
		$inside = $this->make_attachment();
		$gone   = $this->make_attachment();
		$now    = $this->make_attachment();

		update_post_meta( $post, '_product_image_gallery', (string) $inside );

		$result = lienzo_attach_to_post( $post, $now, 'gallery', $gone );

		$this->assertWPError( $result );
		$this->assertSame( 'lienzo_attach_not_in_gallery', $result->get_error_code() );
	}

	/**
	 * A post cannot be pointed at a file the editor could not have produced.
	 *
	 * @covers ::lienzo_attach_to_post
	 */
	public function test_refuses_an_unsupported_image() {
		$post = self::factory()->post->create();
		$gif  = $this->make_attachment( 'image/gif' );

		$result = lienzo_attach_to_post( $post, $gif, 'thumbnail' );

		$this->assertWPError( $result );
		$this->assertSame( 'lienzo_attach_bad_image', $result->get_error_code() );
	}

	/**
	 * A missing post is an error rather than a silent no-op.
	 *
	 * @covers ::lienzo_attach_to_post
	 */
	public function test_refuses_a_post_that_does_not_exist() {
		$result = lienzo_attach_to_post( 999999, $this->make_attachment(), 'thumbnail' );

		$this->assertWPError( $result );
		$this->assertSame( 'lienzo_attach_no_post', $result->get_error_code() );
	}

	/**
	 * The capability is the post's own, not the attachment's.
	 *
	 * @covers ::lienzo_can_attach_to_post
	 */
	public function test_a_subscriber_may_not_repoint_someone_elses_post() {
		$post = self::factory()->post->create();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->assertFalse( lienzo_can_attach_to_post( $post ) );
	}

	/**
	 * Someone who can edit the post can repoint it.
	 *
	 * @covers ::lienzo_can_attach_to_post
	 */
	public function test_an_editor_may_repoint_a_post() {
		$post = self::factory()->post->create();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$this->assertTrue( lienzo_can_attach_to_post( $post ) );
	}

	/**
	 * The change fires an action, so a plugin can follow it.
	 *
	 * @covers ::lienzo_attach_to_post
	 */
	public function test_announces_the_change() {
		$post = self::factory()->post->create();
		$now  = $this->make_attachment();
		$seen = array();

		add_action(
			'lienzo_post_image_updated',
			static function ( $post_id, $attachment_id, $slot ) use ( &$seen ) {
				$seen = array( $post_id, $attachment_id, $slot );
			},
			10,
			3
		);

		lienzo_attach_to_post( $post, $now, 'thumbnail' );

		$this->assertSame( array( $post, $now, 'thumbnail' ), $seen );
	}
}
