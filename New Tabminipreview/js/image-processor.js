/**
 * Image Processor Module
 * Handles stitching and processing of screenshots
 */

class ImageProcessor {
    // Constants for image processing
    static MAX_CANVAS_DIMENSION = 16384; // Maximum canvas dimension most browsers support
    static MAX_CANVAS_AREA = 16384 * 16384; // Maximum area for canvas

    /**
     * Stitch screenshots together into a single image
     * @param {Array<Object>} screenshots - Array of screenshot objects with dataUrl, x, y properties
     * @returns {Promise<Blob>} - Promise resolving to a Blob of the stitched image
     */
    static async stitchScreenshots(screenshots) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!screenshots || screenshots.length === 0) {
                    reject(new Error('No screenshots to stitch'));
                    return;
                }

                // Load all images first
                const loadedImages = [];
                for (const screenshot of screenshots) {
                    try {
                        const image = await this.loadImage(screenshot.dataUrl);
                        loadedImages.push({
                            image,
                            x: screenshot.x,
                            y: screenshot.y
                        });
                    } catch (error) {
                        console.warn('Failed to load image, skipping:', error);
                        // Continue with other screenshots
                    }
                }

                if (loadedImages.length === 0) {
                    reject(new Error('Failed to load any images'));
                    return;
                }

                // Determine the canvas dimensions
                const dimensions = this.calculateCanvasDimensions(loadedImages);

                // Check if dimensions are too large
                if (dimensions.width > this.MAX_CANVAS_DIMENSION ||
                    dimensions.height > this.MAX_CANVAS_DIMENSION ||
                    dimensions.width * dimensions.height > this.MAX_CANVAS_AREA) {

                    // Use tiling approach for very large images
                    const blob = await this.stitchLargeImage(loadedImages, dimensions);
                    resolve(blob);
                    return;
                }

                // Create a canvas to hold the full-page screenshot
                const canvas = document.createElement('canvas');
                canvas.width = dimensions.width;
                canvas.height = dimensions.height;

                // Get the drawing context
                const ctx = canvas.getContext('2d');

                // Fill with white background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw each screenshot in its position
                for (const item of loadedImages) {
                    try {
                        ctx.drawImage(item.image, item.x, item.y);
                    } catch (error) {
                        console.warn('Error drawing image at', item.x, item.y, error);
                        // Continue with other images
                    }
                }

                // Convert to blob with memory handling
                try {
                    canvas.toBlob(blob => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error('Failed to create image blob'));
                        }

                        // Clean up to help garbage collection
                        setTimeout(() => {
                            ctx.clearRect(0, 0, canvas.width, canvas.height);
                            canvas.width = 1;
                            canvas.height = 1;
                        }, 100);

                    }, 'image/png', 1.0);
                } catch (error) {
                    // Handle canvas.toBlob security exceptions (can happen on some secure pages)
                    reject(new Error('Security restriction: Cannot create image from this page'));
                }
            } catch (error) {
                console.error('Error stitching screenshots:', error);
                reject(error);
            }
        });
    }

    /**
     * Handle stitching for extremely large images by tiling
     * @param {Array<Object>} loadedImages - Array of loaded images with positions
     * @param {Object} dimensions - Full dimensions object
     * @returns {Promise<Blob>} - Promise resolving to a Blob
     */
    static async stitchLargeImage(loadedImages, dimensions) {
        return new Promise(async (resolve, reject) => {
            try {
                console.log('Using tiled approach for large image:', dimensions);

                // Calculate how many tiles we need
                const tileSize = 8000; // Size of each tile
                const tilesX = Math.ceil(dimensions.width / tileSize);
                const tilesY = Math.ceil(dimensions.height / tileSize);
                const totalTiles = tilesX * tilesY;

                console.log(`Creating ${totalTiles} tiles (${tilesX}x${tilesY})`);

                // Create a canvas for the final image (with restricted dimensions)
                const maxWidth = Math.min(dimensions.width, this.MAX_CANVAS_DIMENSION);
                const maxHeight = Math.min(dimensions.height, this.MAX_CANVAS_DIMENSION);
                const scaleFactor = Math.min(
                    maxWidth / dimensions.width,
                    maxHeight / dimensions.height
                );

                const finalCanvas = document.createElement('canvas');
                finalCanvas.width = dimensions.width * scaleFactor;
                finalCanvas.height = dimensions.height * scaleFactor;
                const finalCtx = finalCanvas.getContext('2d');

                // Fill with white background
                finalCtx.fillStyle = '#ffffff';
                finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

                if (scaleFactor < 1) {
                    console.log(`Scaling down image by factor ${scaleFactor} due to size constraints`);
                    finalCtx.scale(scaleFactor, scaleFactor);
                }

                // Create a temporary canvas for each tile
                const tileCanvas = document.createElement('canvas');
                tileCanvas.width = tileSize;
                tileCanvas.height = tileSize;
                const tileCtx = tileCanvas.getContext('2d');

                // Process each tile
                for (let tileY = 0; tileY < tilesY; tileY++) {
                    for (let tileX = 0; tileX < tilesX; tileX++) {
                        // Clear the tile canvas
                        tileCtx.clearRect(0, 0, tileSize, tileSize);
                        tileCtx.fillStyle = '#ffffff';
                        tileCtx.fillRect(0, 0, tileSize, tileSize);

                        // Calculate tile boundaries
                        const tileLeft = tileX * tileSize;
                        const tileTop = tileY * tileSize;
                        const tileRight = Math.min(tileLeft + tileSize, dimensions.width);
                        const tileBottom = Math.min(tileTop + tileSize, dimensions.height);

                        // Draw relevant screenshots onto this tile
                        for (const item of loadedImages) {
                            // Check if this image intersects with the current tile
                            const imgRight = item.x + item.image.width;
                            const imgBottom = item.y + item.image.height;

                            if (item.x < tileRight && imgRight > tileLeft &&
                                item.y < tileBottom && imgBottom > tileTop) {

                                // Calculate source and destination coordinates
                                const sx = Math.max(0, tileLeft - item.x);
                                const sy = Math.max(0, tileTop - item.y);
                                const sWidth = Math.min(item.image.width - sx, tileRight - Math.max(tileLeft, item.x));
                                const sHeight = Math.min(item.image.height - sy, tileBottom - Math.max(tileTop, item.y));
                                const dx = Math.max(0, item.x - tileLeft);
                                const dy = Math.max(0, item.y - tileTop);

                                if (sWidth > 0 && sHeight > 0) {
                                    try {
                                        tileCtx.drawImage(
                                            item.image,
                                            sx, sy, sWidth, sHeight,
                                            dx, dy, sWidth, sHeight
                                        );
                                    } catch (error) {
                                        console.warn('Error drawing image in tile:', error);
                                    }
                                }
                            }
                        }

                        // Draw tile to the final canvas
                        finalCtx.drawImage(tileCanvas, tileLeft, tileTop);

                        // Yield to the main thread occasionally to prevent UI freezing
                        if ((tileY * tilesX + tileX) % 4 === 3) {
                            await new Promise(resolve => setTimeout(resolve, 0));
                        }
                    }
                }

                // Convert the final canvas to a blob
                finalCanvas.toBlob(blob => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to create image blob from tiles'));
                    }

                    // Clean up to help garbage collection
                    setTimeout(() => {
                        finalCtx.clearRect(0, 0, finalCanvas.width, finalCanvas.height);
                        finalCanvas.width = 1;
                        finalCanvas.height = 1;
                        tileCtx.clearRect(0, 0, tileCanvas.width, tileCanvas.height);
                        tileCanvas.width = 1;
                        tileCanvas.height = 1;
                    }, 100);

                }, 'image/png', 0.9);

            } catch (error) {
                console.error('Error in tiled stitching:', error);
                reject(error);
            }
        });
    }

    /**
     * Load an image from a data URL asynchronously
     * @param {string} dataUrl - Data URL to load
     * @returns {Promise<HTMLImageElement>} - Promise resolving to a loaded image
     */
    static loadImage(dataUrl) {
        return new Promise((resolve, reject) => {
            try {
                // Validate dataUrl
                if (!dataUrl || typeof dataUrl !== 'string') {
                    reject(new Error('Invalid data URL provided to loadImage'));
                    return;
                }

                if (!dataUrl.startsWith('data:image/')) {
                    reject(new Error('Data URL does not appear to be an image'));
                    return;
                }

                const img = new Image();

                // Set crossOrigin to anonymous to avoid tainted canvas issues
                img.crossOrigin = 'anonymous';

                // Set a timeout to reject the promise if the image takes too long to load
                const timeout = setTimeout(() => {
                    const error = new Error('Image loading timed out');
                    img.onload = null;
                    img.onerror = null;
                    reject(error);
                }, 30000); // 30 second timeout

                img.onload = () => {
                    clearTimeout(timeout);

                    // Check if image dimensions are valid
                    if (img.width === 0 || img.height === 0) {
                        reject(new Error('Image loaded but has invalid dimensions'));
                        return;
                    }

                    // Successfully loaded with valid dimensions
                    resolve(img);
                };

                img.onerror = (error) => {
                    clearTimeout(timeout);
                    reject(new Error('Error loading image: ' + (error ? error.message : 'unknown error')));
                };

                // Try loading the image
                img.src = dataUrl;

                // For older browsers, force loading to start if it hasn't already
                if (img.complete && img.naturalWidth > 0) {
                    clearTimeout(timeout);
                    resolve(img);
                }
            } catch (error) {
                reject(new Error('Error setting up image load: ' + error.message));
            }
        });
    }

    /**
     * Calculate dimensions for the stitched canvas
     * @param {Array<Object>} loadedImages - Array of loaded image objects with image, x, y properties
     * @returns {Object} - Object with width and height properties
     */
    static calculateCanvasDimensions(loadedImages) {
        // Find the right-most and bottom-most points
        let maxX = 0;
        let maxY = 0;

        for (const item of loadedImages) {
            const rightEdge = item.x + item.image.width;
            const bottomEdge = item.y + item.image.height;

            maxX = Math.max(maxX, rightEdge);
            maxY = Math.max(maxY, bottomEdge);
        }

        return {
            width: maxX,
            height: maxY
        };
    }

    /**
     * Create a downloadable URL from a screenshot blob
     * @param {Blob} blob - Screenshot blob
     * @returns {string} - Object URL for the blob
     */
    static createImageUrl(blob) {
        return URL.createObjectURL(blob);
    }

    /**
     * Compress a screenshot for better performance
     * @param {Blob} blob - Original screenshot blob
     * @param {number} quality - Quality factor (0-1)
     * @returns {Promise<Blob>} - Compressed image blob
     */
    static async compressImage(blob, quality = 0.8) {
        return new Promise(async (resolve, reject) => {
            try {
                // First check if blob is too large (>100MB)
                if (blob.size > 100 * 1024 * 1024) {
                    console.warn('Image is very large, applying higher compression');
                    quality = Math.min(quality, 0.7); // Use stronger compression for large images
                }

                // Load the image
                const img = await this.loadImage(URL.createObjectURL(blob));

                // Create a canvas with the same dimensions
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;

                // Draw the image to the canvas
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                // Convert to compressed blob
                canvas.toBlob(
                    compressedBlob => {
                        // Release resources
                        URL.revokeObjectURL(img.src);
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        canvas.width = 1;
                        canvas.height = 1;

                        resolve(compressedBlob);
                    },
                    'image/jpeg',
                    quality
                );
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Generate a thumbnail of a screenshot
     * @param {Blob} blob - Screenshot blob
     * @param {number} maxDimension - Maximum width or height
     * @returns {Promise<Blob>} - Thumbnail blob
     */
    static async generateThumbnail(blob, maxDimension = 400) {
        return new Promise(async (resolve, reject) => {
            try {
                // Load the image
                const img = await this.loadImage(URL.createObjectURL(blob));

                // Calculate thumbnail dimensions
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxDimension) {
                        height = Math.round(height * (maxDimension / width));
                        width = maxDimension;
                    }
                } else {
                    if (height > maxDimension) {
                        width = Math.round(width * (maxDimension / height));
                        height = maxDimension;
                    }
                }

                // Create a canvas with the thumbnail dimensions
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                // Draw the image to the canvas
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to blob
                canvas.toBlob(
                    thumbnailBlob => {
                        // Release resources
                        URL.revokeObjectURL(img.src);
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        canvas.width = 1;
                        canvas.height = 1;

                        resolve(thumbnailBlob);
                    },
                    'image/jpeg',
                    0.7
                );
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Check if this browser supports the necessary canvas operations
     * @returns {boolean} - Whether the browser supports the necessary operations
     */
    static checkBrowserSupport() {
        try {
            // Check if we can create a canvas
            const canvas = document.createElement('canvas');
            canvas.width = 100;
            canvas.height = 100;

            // Check if we can get a context
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                console.error('Canvas 2D context not supported');
                return false;
            }

            // Check if we can draw to the canvas
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 100, 100);

            // Check if toBlob is supported
            if (!canvas.toBlob) {
                console.error('Canvas toBlob not supported');
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error checking browser support:', error);
            return false;
        }
    }
}

// Export the module
export default ImageProcessor; 