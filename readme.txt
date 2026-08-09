=== Lienzo. ===
Contributors: daniellopez
Tags: image editor, media, photo, layers, filters
Requires at least: 6.0
Requires Plugins: desktop-mode
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A small painting studio inside WordPress. Brushes, layers and filters, straight in the Media Library.

== Description ==

WordPress has shipped the same image editor since 2008: rotate, flip, crop, scale. Lienzo adds everything that was missing.

It is a real editor. You can adjust exposure and colour while watching a live histogram, paint with brushes that have shape and softness, select an area and paint only inside it, stack layers, drag a photo in from the Media Library, and type text directly onto the canvas.

= Adjust =

* Exposure, contrast, temperature, tint, saturation, vibrance and hue
* Curves, on RGB and on each channel separately
* Levels, with black point, white point and gamma
* Sharpen, blur, vignette and grain
* A live histogram that follows the slider as you drag it
* Presets, so a look you like can be reused on the next photo

= Paint =

Eighteen tools on a two column rail, grouped the way you would expect:

* Move and transform, with handles that scale, rotate and snap
* Select as a rectangle, an ellipse, a freeform lasso or a polygon
* Build a selection up: add to it, subtract from it, or keep only the overlap, from the options bar or by holding Shift, Alt or both
* Magic wand, which selects the region around the colour you click
* Crop, with aspect presets
* Eyedropper, brush, eraser, paint bucket and gradient
* Retouch: blur, sharpen, smudge and heal
* Clone stamp, with an Alt click to set the sample point
* Dodge, burn, desaturate and saturate
* History brush, which paints the original image back
* Shapes, paths and text
* Hand and zoom, plus a quick mask and a full screen mode

Brushes have a size, a shape and a hardness, and the cursor is a ring the real size of the brush against the image, so you are never guessing at how much a stroke will cover.

= Layers =

Text, pasted pixels and dropped photos each arrive as their own layer, so you can move one without disturbing the others, reorder them, hide them or throw one away. Undo reaches painted pixels too, not only settings.

= Drag a photo in =

Drag an image from the Media Library, from the desktop, or from your computer straight onto the canvas. It lands as a new layer, where you dropped it, scaled to fit.

= Open a product photo without hunting for it =

Drag a WooCommerce product onto the Lienzo icon and its photo opens straight away, skipping the picker. Any post with a picture works the same way, and so does dropping a photo itself.

When you save, Lienzo asks whether the product should start using the edit. Either answer leaves your original where it is: choosing to update writes a new copy and points the product at it, so going back is a matter of pointing it at the old one again.

= Your originals are never touched =

Saving always writes a new attachment and records the edit as a recipe: the list of adjustments, not the pixels. Re-opening a photo restores every slider exactly where you left it and renders again from the original. Editing the same image ten times costs nothing in quality, because every render is a first generation one.

= Fast, because of how it renders =

Adjustments are composed into a single GPU pass rather than chained one after another. That is not only quicker. It also means the image is quantised once instead of once per adjustment, which is the difference between a clean gradient and visible banding in a sky.

== Requires OpenStation ==

Lienzo runs inside the OpenStation plugin (previously called Desktop Mode), which turns wp-admin into a desktop, and needs it installed. That is not decoration: the rendering engine is OpenStation's. Lienzo ships none of its own and borrows the desktop's, which is why this plugin is a few tens of kilobytes rather than the best part of a megabyte, and why your browser only ever downloads one copy.

Install and activate OpenStation first. Without it, Lienzo tells you what it needs and otherwise stays out of the way.

= Where it opens =

With the desktop switched on, Lienzo is a real window: chrome you can move and resize, an icon on the wallpaper, and drag and drop between windows.

The desktop is a per-user preference, and with it switched off Lienzo still opens — under Media → Edit Photos, and over the top of whatever you were doing when you choose "Edit with Lienzo" in the Media Library, in the media picker or on an image block. Every tool is the same one. What you do not get is the window, the wallpaper icon and dragging photos between windows.

== Installation ==

1. Install and activate the OpenStation plugin.
2. Upload the `lienzo` folder to `/wp-content/plugins/`, or install it from the Plugins screen.
3. Activate Lienzo through the Plugins menu.
4. Open Lienzo from the dock or the desktop, or choose "Edit with Lienzo" on any image in the Media Library. With the desktop switched off, use Media → Edit Photos.

== Frequently Asked Questions ==

= Does this change my original images? =

No. Every save creates a new attachment and links it back to the original. Your original file is never rewritten.

= Do I need ImageMagick or GD? =

Not for the editing. All of it happens in your browser using WebGL. WordPress still uses its normal image library to generate the thumbnail sizes of whatever you save.

= Which browsers are supported? =

Any browser with WebGL 2, which is every current version of Chrome, Firefox, Safari and Edge.

= My images are served from a CDN. Will it work? =

Yes. When a CDN does not send the CORS headers a GPU canvas requires, Lienzo streams the original through your own site instead.

= Why is GIF not supported? =

Rendering an animated GIF through a canvas silently flattens it to a single frame. Rather than quietly destroy the animation, Lienzo does not offer to edit them.

= Are brush strokes stored in the recipe? =

No, and the difference decides what re-opening does. Adjustments, crops and transforms are instructions: they are stored in the recipe, replayed over your original, and come back as sliders you can still move. Painted, pasted and dropped pixels are not instructions, so they are baked into the file you save.

That makes a painted save its own original. Re-open it and you see exactly the pixels you saved, with the sliders back at zero, ready to be edited again from there. The editor says so when you save, rather than letting you find out later.

= Can I use it with the desktop switched off? =

Yes. It opens under Media → Edit Photos, and as an overlay when you choose "Edit with Lienzo" from the Media Library, the media picker or an image block. Every tool is the same one; what you do not get is the movable window, the wallpaper icon and dragging photos between windows. OpenStation still has to be installed, because the rendering engine comes from it.

= Does it edit in real colour? =

There is a Light switch at the top of the Adjustments panel. Left on sRGB it behaves like WordPress and like most browser editors: the maths is done on the stored values. Switched to Linear, exposure is applied to *light* instead, so a stop up or down lands where a camera would have put it rather than where the file's encoding does. Existing edits are unaffected; the setting is saved with each one.

== Screenshots ==

1. The editor open as a desktop window, with the tool rail, the layer stack and a live histogram.
2. Adjusting exposure and colour while the histogram follows.
3. Painting inside a selection, with the brush cursor showing the real size of the brush.
4. Text typed directly onto the canvas, as a layer of its own.

== Third-party libraries ==

This plugin bundles no third-party libraries and makes no external or CDN requests.

Rendering uses PixiJS (MIT), which is bundled by the OpenStation plugin and served from your own server. Lienzo asks OpenStation for it rather than shipping a second copy: that keeps this plugin small, and two instances of the same rendering library on one page share GPU resources through globals, where tearing one down can break the other.

== Changelog ==

= 0.1.0 =
* First release.
* Opens with the desktop switched off as well as in a window: an editor page under Media, and an overlay from the Media Library, the media picker and the image block.
* Magic wand and paint bucket rewritten to walk runs rather than pixels — a twenty-megapixel photo answers in a fifth of a second instead of a few seconds.
* The wand traces the holes in a region instead of selecting through them.
* Optional linear-light exposure, where a stop is a doubling of light rather than of a stored value.
* Sixteen bits per channel through the layer composite where the browser allows it.
* Renders on WebGPU where a site asks for it, as well as WebGL.
* Exposure, contrast, temperature, tint, saturation, vibrance and hue, composed into a single GPU pass.
* Curves and levels, baked into one lookup table.
* Sharpen, blur, vignette and grain.
* Live RGB and luma histogram.
* Crop, straighten, rotate and flip, with the canvas independent of the image sitting on it.
* Layers, with reorder, hide and delete.
* Selections as a rectangle, an ellipse, a lasso or a polygon, plus a magic wand.
* Selection modes: new, add, subtract and intersect, from the options bar or with Shift, Alt and Shift+Alt.
* One top bar instead of two, and a third the height: 31 pixels where the chrome used to take about 90.
* The picture no longer flickers while a window is being resized.
* The tool rail and the sidebar meet the top bar, instead of sitting below a strip of background.
* Brushes, eraser, paint bucket, gradient, shapes, paths and text typed on the canvas.
* Retouching: blur, sharpen, smudge, heal and clone stamp.
* Dodge, burn, desaturate and saturate.
* History brush, quick mask and full screen.
* Copy and paste that respects the shape you selected rather than its bounding box.
* Drag and drop from the Media Library, the desktop or your computer.
* Undo and redo that reach painted pixels, not only settings.
* Presets.
* Non-destructive saving, with the edit stored as a re-openable recipe.
