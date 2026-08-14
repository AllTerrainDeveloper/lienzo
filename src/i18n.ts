/**
 * Translation helper.
 *
 * The bundle declares `wp-i18n` as a dependency, but the editor can also be mounted
 * by code paths that loaded it directly, so the global is feature-detected rather
 * than assumed. Falling back to the untranslated string keeps the UI working in
 * English instead of throwing.
 */

/**
 * Translates a string in the `allterrain-photo-editor` text domain.
 *
 * @param text Untranslated string.
 */
export function __( text: string ): string {
	return window.wp?.i18n?.__?.( text, 'allterrain-photo-editor' ) ?? text;
}

/**
 * Picks the singular or the plural in the `allterrain-photo-editor` text domain.
 *
 * Both forms are passed to `wp.i18n` rather than chosen here, because which of them a
 * language wants is a property of the language: English has two forms and picks on
 * `1`, and several languages have three or more and pick on something else entirely.
 * The fallback is the English rule, which is the right answer for untranslated text.
 *
 * @param single Untranslated singular.
 * @param plural Untranslated plural.
 * @param count  How many.
 */
export function _n( single: string, plural: string, count: number ): string {
	return (
		window.wp?.i18n?._n?.( single, plural, count, 'allterrain-photo-editor' ) ??
		( 1 === count ? single : plural )
	);
}

/**
 * Translates and interpolates.
 *
 * @param text Untranslated string containing printf placeholders.
 * @param args Values to interpolate.
 */
export function sprintf( text: string, ...args: unknown[] ): string {
	const translated = __( text );
	const impl = window.wp?.i18n?.sprintf;

	if ( impl ) {
		return impl( translated, ...args );
	}

	// Minimal fallback covering the %s and %d this plugin actually uses.
	let index = 0;

	return translated.replace( /%[sd]/g, () => String( args[ index++ ] ?? '' ) );
}
