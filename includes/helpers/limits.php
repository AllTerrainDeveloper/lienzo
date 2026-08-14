<?php
/**
 * What this site will let the editor allocate and upload.
 *
 * @package AllTerrain_Photo_Editor
 */

defined( 'ABSPATH' ) || exit;

/**
 * Returns the maximum size, in bytes, AllTerrain Photo Editor will accept for a rendered upload.
 *
 * Defaults to the smaller of the PHP upload limit and 64MB. A full-resolution PNG
 * render of a 6000x4000 photograph can legitimately exceed 40MB, so this ceiling
 * needs headroom, but it must still bound what an authenticated user can push
 * through the render endpoint in a single request.
 *
 * @since 0.1.0
 *
 * @return int Maximum upload size in bytes.
 */
function lienzo_max_upload_bytes() {
	$limit = min( (int) wp_max_upload_size(), 64 * MB_IN_BYTES );

	/**
	 * Filters the maximum accepted size of a rendered image upload.
	 *
	 * @since 0.1.0
	 *
	 * @param int $limit Maximum size in bytes.
	 */
	return (int) apply_filters( 'lienzo_max_upload_bytes', $limit );
}

/**
 * Returns the largest image, in total pixels, the browser will try to render.
 *
 * Saving renders the edit at full resolution into a GPU render target, which costs
 * four bytes per pixel. A 100 megapixel image therefore wants a single 400MB
 * allocation and takes the browser tab down with it. The editor refuses past this
 * ceiling and says so, which is a great deal better than a crash after the user has
 * already done the work.
 *
 * The default of 80 megapixels comfortably covers any current full-frame camera.
 *
 * @since 0.1.0
 *
 * @return int Maximum pixels per render.
 */
function lienzo_max_render_pixels() {
	/**
	 * Filters the largest image the browser will try to render.
	 *
	 * Lower this on sites whose users are on memory-constrained devices; raise it
	 * only if you know the clients have the GPU memory to match.
	 *
	 * @since 0.1.0
	 *
	 * @param int $pixels Maximum pixels per render.
	 */
	return (int) apply_filters( 'lienzo_max_render_pixels', 80000000 );
}

/**
 * Returns the largest raster, in pixels, a boolean selection is worked out on.
 *
 * Adding, subtracting and intersecting selections are done by rasterising both
 * outlines, compositing them, and tracing the result back into paths. That round
 * trip is exact to the raster it runs on, so this is the precision of every combined
 * outline on a document larger than it.
 *
 * The default of four megapixels is a 2000-square working canvas, which is far more
 * boundary than the six hundred vertices a traced outline keeps can carry -- so on any
 * ordinary photograph the vertex budget, not this, is the limiting term. Uncapped, one
 * intersection on a fifty-megapixel scan would allocate two hundred megabytes.
 *
 * Raise it on a site that works with very large scans and cares more about the last
 * half pixel of a combined edge than about the allocation.
 *
 * @since 0.1.0
 *
 * @return int Maximum pixels in the boolean working raster.
 */
function lienzo_max_selection_pixels() {
	/**
	 * Filters the working raster size for boolean selections.
	 *
	 * @since 0.1.0
	 *
	 * @param int $pixels Maximum pixels in the boolean working raster.
	 */
	return (int) apply_filters( 'lienzo_max_selection_pixels', 4000000 );
}

/**
 * Returns the largest edge field, in pixels, the magnetic lasso will build.
 *
 * The magnetic lasso convolves the document once when a trace begins, and follows the
 * boundaries that pass finds. Past this ceiling the field is built at a stride -- one
 * field pixel per two, three or four document pixels -- so the boundary is still found,
 * a little more coarsely, without the read-back and the convolution costing a second
 * and 150MB before the first anchor.
 *
 * The default of two megapixels builds in about 34ms on a 20-megapixel photograph. On
 * a 50-megapixel scan it is a stride of five, which is the one size where raising this
 * buys visible precision -- at the cost of the pause before the trace starts.
 *
 * @since 0.1.0
 *
 * @return int Maximum pixels in the magnetic lasso's edge field.
 */
function lienzo_max_edge_pixels() {
	/**
	 * Filters the size of the magnetic lasso's edge field.
	 *
	 * @since 0.1.0
	 *
	 * @param int $pixels Maximum pixels in the edge field.
	 */
	return (int) apply_filters( 'lienzo_max_edge_pixels', 2000000 );
}
