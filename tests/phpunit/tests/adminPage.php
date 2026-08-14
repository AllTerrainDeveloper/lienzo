<?php
/**
 * The classic-admin editor page and its place in the menu.
 *
 * @package AllTerrain_Photo_Editor
 */

/**
 * Tests for includes/admin-page.php.
 *
 * @group lienzo
 * @group lienzo-admin-page
 */
class Tests_Lienzo_Admin_Page extends WP_UnitTestCase {

	/**
	 * Starts each test with an empty admin menu and a user who may upload.
	 */
	public function set_up() {
		parent::set_up();

		require_once ABSPATH . 'wp-admin/includes/plugin.php';

		wp_set_current_user(
			self::factory()->user->create( array( 'role' => 'administrator' ) )
		);

		$GLOBALS['menu']              = array();
		$GLOBALS['submenu']           = array();
		$GLOBALS['_registered_pages'] = array();
		$GLOBALS['_parent_pages']     = array();
	}

	/**
	 * The slugs currently under the Media menu.
	 *
	 * @return string[] Menu slugs.
	 */
	private function media_menu_slugs() {
		$items = isset( $GLOBALS['submenu']['upload.php'] )
			? $GLOBALS['submenu']['upload.php']
			: array();

		return wp_list_pluck( $items, 2 );
	}

	/**
	 * Whether the editor page is reachable by URL, menu item or not.
	 *
	 * @return bool True when the page is registered.
	 */
	private function page_is_registered() {
		$hook = get_plugin_page_hookname( LIENZO_PAGE_SLUG, 'upload.php' );

		return ! empty( $GLOBALS['_registered_pages'][ $hook ] );
	}

	/**
	 * The bootstrap stubs the shell as enabled, which is the desktop's own answer.
	 *
	 * @covers ::lienzo_desktop_owns_the_editor
	 */
	public function test_desktop_owns_the_editor_when_the_shell_says_so() {
		$this->assertTrue( lienzo_desktop_owns_the_editor() );
	}

	/**
	 * A site can keep the classic page in the menu alongside the desktop window.
	 *
	 * @covers ::lienzo_desktop_owns_the_editor
	 */
	public function test_the_filter_can_hand_the_editor_back() {
		add_filter( 'lienzo_desktop_owns_the_editor', '__return_false' );

		$this->assertFalse( lienzo_desktop_owns_the_editor() );
	}

	/**
	 * With the desktop running there is no "Edit Photos" item under Media.
	 *
	 * It could only ever lead to a page saying the editor is somewhere else: the shell
	 * hides the whole admin body behind the desktop.
	 *
	 * @covers ::lienzo_register_admin_page
	 */
	public function test_the_menu_item_is_absent_while_the_desktop_owns_the_editor() {
		lienzo_register_admin_page();

		$this->assertNotContains( LIENZO_PAGE_SLUG, $this->media_menu_slugs() );
	}

	/**
	 * The page itself still answers, so a bookmark and `editorUrl` keep working.
	 *
	 * @covers ::lienzo_register_admin_page
	 */
	public function test_the_page_stays_reachable_by_url() {
		lienzo_register_admin_page();

		$this->assertTrue( $this->page_is_registered() );
	}

	/**
	 * Without the desktop the item is exactly where it always was.
	 *
	 * @covers ::lienzo_register_admin_page
	 */
	public function test_the_menu_item_is_present_without_the_desktop() {
		add_filter( 'lienzo_desktop_owns_the_editor', '__return_false' );

		lienzo_register_admin_page();

		$this->assertContains( LIENZO_PAGE_SLUG, $this->media_menu_slugs() );
		$this->assertTrue( $this->page_is_registered() );
	}

	/**
	 * A user who cannot upload never sees it, desktop or no desktop.
	 *
	 * @covers ::lienzo_register_admin_page
	 */
	public function test_a_subscriber_gets_no_menu_item() {
		add_filter( 'lienzo_desktop_owns_the_editor', '__return_false' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		lienzo_register_admin_page();

		$this->assertNotContains( LIENZO_PAGE_SLUG, $this->media_menu_slugs() );
	}
}
