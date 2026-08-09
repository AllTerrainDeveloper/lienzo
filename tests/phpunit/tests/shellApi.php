<?php
/**
 * Tests for resolving the shell's renamed API.
 *
 * @package Lienzo
 */

/**
 * Tests for includes/shell-api.php.
 *
 * @group lienzo
 * @group lienzo-shell-api
 */
class Tests_Lienzo_Shell_Api extends WP_UnitTestCase {

	/**
	 * Both spellings are offered, the current one first.
	 *
	 * @covers ::lienzo_shell_hooks
	 */
	public function test_offers_both_hook_spellings_current_first() {
		$this->assertSame(
			array( 'openstation_mode_init', 'desktop_mode_mode_init' ),
			lienzo_shell_hooks( 'mode_init' )
		);
	}

	/**
	 * With no shell on the site, nothing resolves and nothing pretends to.
	 *
	 * @covers ::lienzo_shell_function
	 */
	public function test_reports_nothing_when_no_shell_is_present() {
		$this->assertSame( '', lienzo_shell_function( 'no_shell_defines_this' ) );
		$this->assertFalse( lienzo_shell_has( 'no_shell_defines_this' ) );
	}

	/**
	 * Calling into an absent shell does nothing rather than fataling.
	 *
	 * @covers ::lienzo_shell_call
	 */
	public function test_calling_an_absent_function_is_a_no_op_rather_than_fatal() {
		$this->assertNull( lienzo_shell_call( 'no_shell_defines_this', 1, 2 ) );
	}

	/**
	 * The whole point: a real function is found under whichever name exists.
	 *
	 * `strlen` stands in for a shell function -- the resolver only cares that some
	 * prefix + name combination is callable.
	 *
	 * @covers ::lienzo_shell_function
	 */
	public function test_finds_a_function_that_exists() {
		// Defined by the test bootstrap below, standing in for a shell that shipped
		// only the older spelling.
		$this->assertSame(
			'desktop_mode_lienzo_probe',
			lienzo_shell_function( 'lienzo_probe' )
		);
		$this->assertTrue( lienzo_shell_has( 'lienzo_probe' ) );
		$this->assertSame( 'called:7', lienzo_shell_call( 'lienzo_probe', 7 ) );
	}

	/**
	 * A site running both -- mid-upgrade, with a cached bundle -- gets the current one.
	 *
	 * @covers ::lienzo_shell_function
	 */
	public function test_prefers_the_current_spelling_when_both_exist() {
		$this->assertSame(
			'openstation_lienzo_both',
			lienzo_shell_function( 'lienzo_both' )
		);
	}
}

/*
 * Stand-ins for a shell, declared at file scope so they exist before the run.
 *
 * Deliberately unprefixed and deliberately in the same file as the test case: they
 * impersonate another plugin's public API, which is the whole point of a resolver that
 * looks functions up by name, and prefixing them would defeat it.
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedFunctionFound
 * phpcs:disable Universal.Files.SeparateFunctionsFromOO.Mixed
 */
if ( ! function_exists( 'desktop_mode_lienzo_probe' ) ) {
	/**
	 * A shell function that only ships under the older name.
	 *
	 * @param int $n Anything.
	 * @return string Marker.
	 */
	function desktop_mode_lienzo_probe( $n ) {
		return 'called:' . (int) $n;
	}
}

if ( ! function_exists( 'openstation_lienzo_both' ) ) {
	/** A shell function shipping under the current name. */
	function openstation_lienzo_both() {}
}

if ( ! function_exists( 'desktop_mode_lienzo_both' ) ) {
	/** The same function under the older name. */
	function desktop_mode_lienzo_both() {}
}
