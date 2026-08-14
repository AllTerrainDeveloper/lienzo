<?php
/**
 * Tests for resolving a post to the image it is about.
 *
 * @package AllTerrain_Photo_Editor
 */

/**
 * Tests for includes/post-image.php.
 *
 * @group lienzo
 * @group lienzo-post-image
 */
class Tests_Lienzo_Post_Image extends WP_UnitTestCase {

	/**
	 * Makes an attachment of a given type.
	 *
	 * @param string $mime      MIME type.
	 * @param int    $parent_id Optional. Post to attach it to.
	 * @return int Attachment ID.
	 */
	private function make_attachment( $mime = 'image/jpeg', $parent_id = 0 ) {
		return self::factory()->attachment->create_object(
			array(
				'file'           => 'lienzo-' . wp_generate_password( 6, false ) . '.jpg',
				'post_parent'    => $parent_id,
				'post_mime_type' => $mime,
				'post_type'      => 'attachment',
			)
		);
	}

	/**
	 * The featured image comes first in the chain.
	 *
	 * @covers ::lienzo_post_image_id
	 */
	public function test_prefers_the_featured_image() {
		$post  = self::factory()->post->create();
		$image = $this->make_attachment();

		set_post_thumbnail( $post, $image );

		$this->assertSame( $image, lienzo_post_image_id( $post ) );
	}

	/**
	 * Then the product gallery, in its own order.
	 *
	 * @covers ::lienzo_post_image_id
	 */
	public function test_falls_back_to_the_product_gallery() {
		$post   = self::factory()->post->create();
		$first  = $this->make_attachment();
		$second = $this->make_attachment();

		update_post_meta( $post, '_product_image_gallery', "$first,$second" );

		$this->assertSame( $first, lienzo_post_image_id( $post ) );
	}

	/**
	 * Then anything attached to the post at all.
	 *
	 * @covers ::lienzo_post_image_id
	 */
	public function test_falls_back_to_an_attached_image() {
		$post  = self::factory()->post->create();
		$image = $this->make_attachment( 'image/jpeg', $post );

		$this->assertSame( $image, lienzo_post_image_id( $post ) );
	}

	/**
	 * A featured image AllTerrain Photo Editor cannot open should not stop the gallery being tried.
	 *
	 * @covers ::lienzo_post_image_id
	 */
	public function test_skips_an_unsupported_featured_image() {
		$post     = self::factory()->post->create();
		$gif      = $this->make_attachment( 'image/gif' );
		$editable = $this->make_attachment();

		set_post_thumbnail( $post, $gif );
		update_post_meta( $post, '_product_image_gallery', (string) $editable );

		$this->assertSame( $editable, lienzo_post_image_id( $post ) );
	}

	/**
	 * A post with no picture says so rather than guessing.
	 *
	 * @covers ::lienzo_post_image_id
	 */
	public function test_reports_nothing_for_a_post_with_no_image() {
		$this->assertSame( 0, lienzo_post_image_id( self::factory()->post->create() ) );
	}

	/**
	 * So does a post that is not there.
	 *
	 * @covers ::lienzo_post_image_id
	 */
	public function test_reports_nothing_for_a_post_that_does_not_exist() {
		$this->assertSame( 0, lienzo_post_image_id( 999999 ) );
	}

	/**
	 * The chain is filterable, which is how an unusual post type joins it.
	 *
	 * @covers ::lienzo_post_image_id
	 */
	public function test_a_filter_can_answer_for_a_post_type_lienzo_cannot_read() {
		$post  = self::factory()->post->create();
		$image = $this->make_attachment();

		add_filter(
			'lienzo_post_image_id',
			static function () use ( $image ) {
				return $image;
			}
		);

		$this->assertSame( $image, lienzo_post_image_id( $post ) );
	}

	/**
	 * A filter must not be able to hand back something unopenable.
	 *
	 * @covers ::lienzo_post_image_id
	 */
	public function test_a_filter_cannot_force_an_unsupported_image() {
		$post = self::factory()->post->create();
		$gif  = $this->make_attachment( 'image/gif' );

		add_filter(
			'lienzo_post_image_id',
			static function () use ( $gif ) {
				return $gif;
			}
		);

		$this->assertSame( 0, lienzo_post_image_id( $post ) );
	}

	/**
	 * Saving needs to know which slot the image came from to put it back.
	 *
	 * @covers ::lienzo_post_image_slot
	 */
	public function test_names_the_slot_an_image_occupies() {
		$post      = self::factory()->post->create();
		$featured  = $this->make_attachment();
		$galleried = $this->make_attachment();
		$stranger  = $this->make_attachment();

		set_post_thumbnail( $post, $featured );
		update_post_meta( $post, '_product_image_gallery', (string) $galleried );

		$this->assertSame( 'thumbnail', lienzo_post_image_slot( $post, $featured ) );
		$this->assertSame( 'gallery', lienzo_post_image_slot( $post, $galleried ) );
		$this->assertSame( '', lienzo_post_image_slot( $post, $stranger ) );
	}
}
