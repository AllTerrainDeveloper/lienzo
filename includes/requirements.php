<?php
/**
 * What the desktop shell adds, and what happens without it.
 *
 * Lienzo used to *require* OpenStation and register nothing at all without it. It no
 * longer does: the editor opens on its own admin page and in an overlay, so a site
 * with no shell gets the editor and loses only the parts that are the shell's --
 * the native window, the desktop icon, the file opener and the drag bridge.
 *
 * What is left here is the capability test the desktop integration gates itself on.
 * It is by *capability*, not by plugin slug: what matters is that the functions being
 * called exist, not what the directory holding them is named, so a fork, a rename or a
 * bundled copy all work.
 *
 * @package Lienzo
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether a desktop shell is present and able to host a native window.
 *
 * Never called before `plugins_loaded`: plugins load alphabetically, so at file scope
 * the shell's functions do not exist yet and this would answer "no" on every site.
 *
 * @since 0.1.0
 *
 * @return bool True when the shell can host the editor as a native window.
 */
function lienzo_requirements_met() {
	return lienzo_shell_has( 'register_window' ) && lienzo_shell_has( 'is_enabled' );
}
