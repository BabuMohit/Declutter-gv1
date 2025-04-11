/**
 * Page Capture Content Script
 * Handles the screenshot capture process on target pages
 * Based on the GoFullPage extension methodology
 */

(function () {
    // Configuration constants with defaults that can be overridden
    let CAPTURE_DELAY = 300; // Increased default delay between scroll positions in ms
    let INITIAL_CAPTURE_DELAY = 800; // Extra delay for first capture to let page settle
    const MAX_PRIMARY_DIMENSION = 15000 * 2;
    const MAX_SECONDARY_DIMENSION = 4000 * 2;
    const MAX_AREA = MAX_PRIMARY_DIMENSION * MAX_SECONDARY_DIMENSION;
    const MAX_CAPTURE_ATTEMPTS = 3; // Maximum number of retry attempts for failed captures
    const INFINITE_SCROLL_THRESHOLD = 2000; // If page grows by this much during capture, suspect infinite scroll
    let MAX_CAPTURE_HEIGHT = 30000; // Maximum height to capture for infinite scrolling pages (30,000px)
    let MAX_SCROLLS = 500; // Maximum number of scrolls for safety
    let RETRY_BACKOFF_MULTIPLIER = 1.5; // Exponential backoff multiplier for retries
    let currentRetryDelay = 500; // Starting retry delay

    // Track if we've already added the listener to avoid duplicate initialization
    if (window.hasScreenCapturePage) {
        return;
    }
    window.hasScreenCapturePage = true;

    // Set up message listener
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'begin_capture') {
            // Apply custom capture parameters if provided
            if (request.captureParams) {
                applyCustomCaptureParameters(request.captureParams);
            }

            // Begin the capture process
            beginCapture(sendResponse);
            return true; // Keep the message channel open for async response
        }
        return false;
    });

    /**
     * Apply custom capture parameters passed from the extension
     * @param {Object} params - Custom capture parameters
     */
    function applyCustomCaptureParameters(params) {
        console.log('Applying custom capture parameters:', params);

        // Apply scroll delay if specified
        if (params.scrollDelay && typeof params.scrollDelay === 'number' && params.scrollDelay > 0) {
            CAPTURE_DELAY = params.scrollDelay;
            INITIAL_CAPTURE_DELAY = CAPTURE_DELAY * 2; // Initial delay twice as long
            console.log(`Using custom scroll delay: ${CAPTURE_DELAY}ms, initial delay: ${INITIAL_CAPTURE_DELAY}ms`);
        }

        // Apply maximum height if specified
        if (params.maxCaptureHeight && typeof params.maxCaptureHeight === 'number' && params.maxCaptureHeight > 0) {
            MAX_CAPTURE_HEIGHT = params.maxCaptureHeight;
            console.log(`Using custom max capture height: ${MAX_CAPTURE_HEIGHT}px`);
        }

        // Apply maximum scrolls if specified
        if (params.maxScrolls && typeof params.maxScrolls === 'number' && params.maxScrolls > 0) {
            MAX_SCROLLS = params.maxScrolls;
            console.log(`Using custom max scrolls: ${MAX_SCROLLS}`);
        }
    }

    /**
     * Get maximum value from an array of numbers, filtering out falsy values
     * @param {number[]} nums - Array of numbers
     * @returns {number} - Maximum value
     */
    function max(nums) {
        return Math.max.apply(Math, nums.filter(x => x));
    }

    /**
     * Begin the capture process
     * @param {function} sendResponse - Function to send response back
     */
    function beginCapture(sendResponse) {
        try {
            // Wait for any pending UI updates to complete
            setTimeout(() => {
                // Show visual feedback that capture is starting
                showCaptureOverlay('Starting capture...');

                // Delay to give the overlay time to appear and page to stabilize
                setTimeout(() => {
                    try {
                        // Calculate page dimensions and scroll positions
                        calculatePageInfo();
                        // Acknowledge successful start
                        sendResponse({ success: true });
                    } catch (error) {
                        console.error('Error starting capture:', error);
                        removeOverlay();
                        sendResponse({ success: false, error: error.message });
                        reportError(error.message);
                    }
                }, 250); // Increased delay for stability
            }, 150);
        } catch (error) {
            console.error('Error in beginCapture:', error);
            sendResponse({ success: false, error: error.message });
            reportError(error.message);
        }
    }

    /**
     * Report an error to the background script
     * @param {string} errorMessage - Error message
     */
    function reportError(errorMessage) {
        chrome.runtime.sendMessage({
            action: 'capture_error',
            error: errorMessage
        });
    }

    /**
     * Calculate page dimensions and prepare for capture
     */
    function calculatePageInfo() {
        // Save original scroll position to restore later
        const originalX = window.scrollX;
        const originalY = window.scrollY;

        // Get the body and document elements
        const body = document.body;
        const originalBodyOverflowYStyle = body ? body.style.overflowY : '';
        const originalOverflowStyle = document.documentElement.style.overflow;

        // Detect and store fixed elements before capture starts
        const fixedElements = getFixedElements();
        const fixedElementsData = fixedElements.map(el => ({
            element: el,
            originalPosition: el.style.position || '',
            originalVisibility: el.style.visibility || '',
            originalDisplay: el.style.display || ''
        }));

        // Make sure the whole page is visible for accurate measurements
        if (body) {
            body.style.overflowY = 'visible';
        }

        // Get various measures of page width
        const widths = [
            document.documentElement.clientWidth,
            body ? body.scrollWidth : 0,
            document.documentElement.scrollWidth,
            body ? body.offsetWidth : 0,
            document.documentElement.offsetWidth
        ];

        // Get various measures of page height
        const heights = [
            document.documentElement.clientHeight,
            body ? body.scrollHeight : 0,
            document.documentElement.scrollHeight,
            body ? body.offsetHeight : 0,
            document.documentElement.offsetHeight
        ];

        // Use the maximum values for full dimensions
        const fullWidth = max(widths);
        const fullHeight = max(heights);

        // Store initial height for infinite scroll detection
        const initialHeight = fullHeight;

        // Get viewport dimensions
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        // Handle extreme dimensions
        // Limit height to prevent issues with infinite scrolling pages
        const usableHeight = Math.min(fullHeight, MAX_CAPTURE_HEIGHT);
        const usableWidth = Math.min(fullWidth,
            fullHeight > MAX_PRIMARY_DIMENSION ? MAX_SECONDARY_DIMENSION : MAX_PRIMARY_DIMENSION);

        // Calculate scroll positions grid
        const scrollPad = 200; // Padding to ensure we don't miss content
        const yDelta = windowHeight - (windowHeight > scrollPad ? scrollPad : 0);
        const xDelta = windowWidth;

        // Create an array of scroll positions
        const arrangements = [];

        // Match original GoFullPage behavior: start from bottom and scroll up
        let yPos = usableHeight - windowHeight;

        // Hide scrollbars during capture
        document.documentElement.style.overflow = 'hidden';

        // Generate the grid of scroll positions (matching original GoFullPage approach)
        while (yPos > -yDelta) {
            let xPos = 0;
            while (xPos < usableWidth) {
                arrangements.push([xPos, yPos]);
                xPos += xDelta;
            }
            yPos -= yDelta;
        }

        // Log capture parameters
        console.log('Capture parameters:');
        console.log('Full dimensions:', fullWidth, 'x', fullHeight);
        console.log('Viewport:', windowWidth, 'x', windowHeight);
        console.log('Total screenshots to take:', arrangements.length);
        console.log('Fixed elements found:', fixedElements.length);

        // Create cleanup function to restore original state
        function cleanUp(heightGrowthDetected = false, currentMaxHeight = initialHeight) {
            // Restore scrollability
            document.documentElement.style.overflow = originalOverflowStyle;

            if (body) {
                body.style.overflowY = originalBodyOverflowYStyle;

                // Ensure scrolling is fully restored
                if (originalBodyOverflowYStyle === '' || originalBodyOverflowYStyle === 'auto') {
                    body.style.overflowY = 'auto';
                }
            }

            // Restore fixed elements to their original state
            fixedElementsData.forEach(data => {
                data.element.style.position = data.originalPosition;
                data.element.style.visibility = data.originalVisibility;
                data.element.style.display = data.originalDisplay;
            });

            // Ensure HTML and BODY can be scrolled
            document.documentElement.style.height = '';
            if (body) {
                body.style.height = '';
            }

            // Return to the original scroll position
            window.scrollTo(originalX, originalY);

            // Force a reflow to ensure scrolling works
            document.body.getBoundingClientRect();

            removeOverlay();

            // If we detected height growth and truncated capture, inform user
            if (heightGrowthDetected && currentMaxHeight > MAX_CAPTURE_HEIGHT) {
                // Send message to inform UI about truncation
                chrome.runtime.sendMessage({
                    action: 'capture_truncated',
                    maximumHeight: MAX_CAPTURE_HEIGHT,
                    actualHeight: currentMaxHeight
                });
            }

            console.log('Page state restored, scrolling behavior should be normal');
        }

        // Process all scroll positions and capture screenshots
        processArrangements(arrangements, fullWidth, fullHeight, windowWidth, windowHeight,
            cleanUp, initialHeight, fixedElementsData);
    }

    /**
     * Process scroll positions and capture screenshots
     * @param {Array<Array<number>>} arrangements - Array of [x,y] scroll positions
     * @param {number} fullWidth - Full width of the page
     * @param {number} fullHeight - Full height of the page
     * @param {number} viewportWidth - Width of the viewport
     * @param {number} viewportHeight - Height of the viewport
     * @param {function} cleanUpCallback - Function to call when done
     * @param {number} initialHeight - Initial height of the page
     * @param {Array} fixedElementsData - Data about fixed elements
     */
    function processArrangements(arrangements, fullWidth, fullHeight, viewportWidth, viewportHeight,
        cleanUpCallback, initialHeight, fixedElementsData) {
        // Track total arrangements for progress calculation
        const totalArrangements = arrangements.length;

        // Limit the number of scroll positions based on MAX_SCROLLS
        if (arrangements.length > MAX_SCROLLS) {
            console.log(`Limiting capture to ${MAX_SCROLLS} scroll positions (originally ${arrangements.length})`);

            // Keep first positions in each row to ensure coverage
            const limitedArrangements = [];
            const rows = new Set();

            // First add one position from each row to ensure full page coverage
            for (const arrangement of arrangements) {
                const y = arrangement[1];
                if (!rows.has(y) && limitedArrangements.length < MAX_SCROLLS) {
                    rows.add(y);
                    limitedArrangements.push(arrangement);
                }
            }

            // If we still have room, add more positions
            if (limitedArrangements.length < MAX_SCROLLS) {
                for (const arrangement of arrangements) {
                    if (!limitedArrangements.includes(arrangement) && limitedArrangements.length < MAX_SCROLLS) {
                        limitedArrangements.push(arrangement);
                    }
                }
            }

            arrangements = limitedArrangements;

            // Send a message about the limitation
            chrome.runtime.sendMessage({
                action: 'capture_truncated',
                maximumHeight: MAX_CAPTURE_HEIGHT,
                actualHeight: fullHeight,
                reason: 'Too many scroll positions required. The screenshot may have gaps.'
            });
        }

        let processedCount = 0;
        let captureAttempts = 0;
        let isFirstPosition = true;
        let currentMaxHeight = initialHeight;
        let heightGrowthDetected = false;

        function captureAtPosition() {
            // Check for infinite scroll detection
            const currentDocHeight = Math.max(
                document.documentElement.scrollHeight,
                document.body ? document.body.scrollHeight : 0
            );

            // If height has grown significantly during capture, it might be infinite scroll
            if (currentDocHeight > currentMaxHeight + INFINITE_SCROLL_THRESHOLD) {
                currentMaxHeight = currentDocHeight;
                heightGrowthDetected = true;

                // Update the overlay to inform user
                updateCaptureOverlay(`Capturing (height limit: ${MAX_CAPTURE_HEIGHT}px)...`);

                // Check if we've reached maximum height
                if (currentDocHeight > MAX_CAPTURE_HEIGHT) {
                    // Filter remaining positions to stay within limit
                    arrangements = arrangements.filter(pos => pos[1] < MAX_CAPTURE_HEIGHT);
                    console.log('Infinite scroll detected, limiting capture height to', MAX_CAPTURE_HEIGHT);
                }
            }

            // If all positions are processed, we're done
            if (arrangements.length === 0) {
                // Send completion message to background script
                chrome.runtime.sendMessage({
                    action: 'capture_complete',
                    url: window.location.href
                });

                // Clean up
                cleanUpCallback(heightGrowthDetected, currentMaxHeight);
                return;
            }

            // Get next position
            const next = arrangements.shift();
            const x = next[0];
            const y = next[1];

            // Update progress overlay
            processedCount++;
            updateCaptureOverlay(`Capturing screenshot ${processedCount} of ${totalArrangements}...`);

            // Calculate percentage complete
            const progress = Math.round((processedCount / totalArrangements) * 100);
            chrome.runtime.sendMessage({
                action: 'capture_progress',
                percent: progress,
                status: `Capturing screenshot ${processedCount} of ${totalArrangements}`
            });

            // Handle fixed elements for this position - FIXED ELEMENT HANDLING
            // Only hide duplicated fixed elements (not on first screenshot or elements in viewport)
            // This ensures side components are visible in the final result
            if (!isFirstPosition) {
                // Only hide fixed elements that would appear multiple times
                // Use different approach - only hide fixed elements outside current viewport
                fixedElementsData.forEach(data => {
                    const element = data.element;
                    const rect = element.getBoundingClientRect();

                    // If element is not in the current viewport, hide it
                    if (rect.bottom < 0 || rect.top > viewportHeight ||
                        rect.right < 0 || rect.left > viewportWidth) {
                        element.style.visibility = 'hidden';
                    } else {
                        // Keep visible if in viewport
                        element.style.visibility = '';
                    }
                });
            } else {
                isFirstPosition = false;
            }

            // First, validate that the target position is even possible
            const maxScrollX = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
            const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

            // Normalize the target position to valid values (can't be negative, can't exceed max)
            const validX = Math.max(0, Math.min(x, maxScrollX));
            const validY = Math.max(0, Math.min(y, maxScrollY));

            // Only warn if we couldn't achieve a valid position
            if ((validX !== x || validY !== y) && (x !== 0 && y !== 0)) {
                console.log(`Normalizing invalid scroll target from (${x}, ${y}) to (${validX}, ${validY})`);
            }

            // Implement more robust scrolling approach
            const scrollWithVerification = () => {
                // Initial scroll
                window.scrollTo(validX, validY);

                // Check if we achieved our position within tolerance
                const xDiff = Math.abs(window.scrollX - validX);
                const yDiff = Math.abs(window.scrollY - validY);

                if (xDiff <= 10 && yDiff <= 10) {
                    // Position achieved within acceptable tolerance
                    return true;
                }

                // Try secondary approach with behavior option
                try {
                    window.scrollTo({
                        left: validX,
                        top: validY,
                        behavior: 'auto'
                    });

                    // Small delay to let the scroll complete
                    return new Promise(resolve => {
                        setTimeout(() => {
                            // Check if scroll was successful
                            const newXDiff = Math.abs(window.scrollX - validX);
                            const newYDiff = Math.abs(window.scrollY - validY);

                            if (newXDiff <= 10 && newYDiff <= 10) {
                                resolve(true);
                            } else {
                                // Try one more precise adjustment
                                window.scrollBy(validX - window.scrollX, validY - window.scrollY);

                                setTimeout(() => {
                                    const finalXDiff = Math.abs(window.scrollX - validX);
                                    const finalYDiff = Math.abs(window.scrollY - validY);
                                    resolve(finalXDiff <= 15 && finalYDiff <= 15);
                                }, 50);
                            }
                        }, 50);
                    });
                } catch (error) {
                    console.warn('Error in advanced scrolling:', error);
                    return false;
                }
            };

            // Execute the scroll function and continue processing
            Promise.resolve(scrollWithVerification()).then(scrollSucceeded => {
                if (!scrollSucceeded) {
                    console.warn(`Scroll position not achieved exactly: wanted (${validX}, ${validY}), got (${window.scrollX}, ${window.scrollY})`);

                    // Send a message about the scroll issue but continue
                    chrome.runtime.sendMessage({
                        action: 'scroll_position_issue',
                        wanted: { x: validX, y: validY },
                        actual: { x: window.scrollX, y: window.scrollY },
                        methods_tried: ['scrollTo', 'scrollTo with options', 'scrollBy adjustment']
                    });
                }

                // Give page time to settle after scrolling - use adaptive CAPTURE_DELAY
                // For first scroll, allow more time as page may need to load images
                const scrollDelay = processedCount === 1 ? INITIAL_CAPTURE_DELAY : CAPTURE_DELAY;

                setTimeout(() => {
                    // Get the actual position right before capture
                    const actualX = window.scrollX;
                    const actualY = window.scrollY;
                    const scrollPositionError = Math.abs(actualX - validX) > 15 || Math.abs(actualY - validY) > 15;

                    // Store current position for potential retries
                    const currentPosition = [validX, validY];
                    const actualPosition = [actualX, actualY];

                    // Request screenshot from background script using ACTUAL scroll position
                    chrome.runtime.sendMessage({
                        action: 'capture_screenshot',
                        x: actualX,
                        y: actualY,
                        requestedX: validX,
                        requestedY: validY,
                        scrollPositionError: scrollPositionError,
                        totalWidth: fullWidth,
                        totalHeight: fullHeight,
                        viewportWidth: viewportWidth,
                        viewportHeight: viewportHeight
                    }, (response) => {
                        if (!response || !response.success) {
                            console.error('Error capturing screenshot:', response?.error || 'Unknown error');

                            // Apply exponential backoff for rate limiting errors
                            if (response?.error && response.error.includes('Exceeded screenshot capture rate')) {
                                // Use exponential backoff for rate limiting
                                currentRetryDelay = Math.min(currentRetryDelay * RETRY_BACKOFF_MULTIPLIER, 3000);
                                console.log(`Rate limit hit. Using increased delay: ${currentRetryDelay}ms`);

                                // Put the position back in the queue and retry with longer delay
                                arrangements.unshift(currentPosition);
                                setTimeout(captureAtPosition, currentRetryDelay);
                                return;
                            }

                            // Check if error is related to scrolling issues
                            if (scrollPositionError && (response?.error?.includes('scroll') || !response?.error)) {
                                console.warn('Scroll position error may have caused capture failure');

                                // Try a different approach: capture at actual position instead of requested
                                if (captureAttempts === 0) {
                                    console.log('Adapting to use actual scroll position instead of requested position');
                                    // Use actual position for the next attempt
                                    arrangements.unshift(actualPosition);
                                    setTimeout(captureAtPosition, CAPTURE_DELAY);
                                    captureAttempts++;
                                    return;
                                }
                            }

                            // Retry logic for other types of failures
                            captureAttempts++;
                            if (captureAttempts < MAX_CAPTURE_ATTEMPTS) {
                                console.log(`Retrying capture (attempt ${captureAttempts + 1})...`);
                                // Put the position back in the queue and retry
                                arrangements.unshift(currentPosition);
                                setTimeout(captureAtPosition, CAPTURE_DELAY * 2); // Double delay for retry
                                return;
                            } else {
                                // Enough retries, report error and continue
                                console.error('Max capture attempts reached, continuing with next position');
                                captureAttempts = 0;

                                // Notify about this failure
                                chrome.runtime.sendMessage({
                                    action: 'capture_position_failed',
                                    position: currentPosition,
                                    attempts: MAX_CAPTURE_ATTEMPTS,
                                    error: response?.error || 'Unknown error'
                                });
                            }
                        } else {
                            // Reset attempts counter on successful capture
                            captureAttempts = 0;
                            // Gradually reduce delay after successful captures to optimize speed
                            currentRetryDelay = Math.max(currentRetryDelay / 1.2, 500);
                        }

                        // Continue with next position after a delay to avoid rate limiting
                        setTimeout(captureAtPosition, scrollDelay);
                    });
                }, scrollDelay);
            });
        }

        // Start the capture process
        captureAtPosition();
    }

    /**
     * Create and show a visual overlay during capture
     * @param {string} message - Message to display
     */
    function showCaptureOverlay(message) {
        // Remove any existing overlay
        removeOverlay();

        // Create overlay element
        const overlay = document.createElement('div');
        overlay.id = 'gfp-capture-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 15px;
            border-radius: 4px;
            z-index: 2147483647;
            font-family: Arial, sans-serif;
            font-size: 14px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            transition: opacity 0.3s ease;
            pointer-events: none; /* Make sure it doesn't interfere with page */
        `;
        overlay.textContent = message;

        // Add to page
        if (document.body) {
            document.body.appendChild(overlay);
        }
    }

    /**
     * Update the capture overlay message
     * @param {string} message - New message to display
     */
    function updateCaptureOverlay(message) {
        const overlay = document.getElementById('gfp-capture-overlay');
        if (overlay) {
            overlay.textContent = message;
        } else {
            showCaptureOverlay(message);
        }
    }

    /**
     * Remove the capture overlay
     */
    function removeOverlay() {
        const overlay = document.getElementById('gfp-capture-overlay');
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
    }

    /**
     * Get all fixed position elements that might interfere with screenshots
     * @returns {Array} Array of fixed position elements
     */
    function getFixedElements() {
        return Array.from(document.querySelectorAll('*')).filter(el => {
            const style = window.getComputedStyle(el);
            return style.position === 'fixed' &&
                style.display !== 'none' &&
                el.offsetWidth > 0 &&
                el.offsetHeight > 0;
        });
    }

    /**
     * Detect fixed position elements (for backward compatibility)
     * @returns {boolean} Whether fixed elements exist
     */
    function detectFixedElements() {
        return getFixedElements().length > 0;
    }
})(); 