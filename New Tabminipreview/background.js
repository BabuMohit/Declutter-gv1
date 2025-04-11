/**
 * Background service worker for Declutter! extension
 * Handles extension activation, tab navigation, and message coordination
 */

// Global state
let extensionTabId = null;
let captureData = {
    tabId: null,
    screenshots: [],
    inProgress: false,
    returnTabId: null
};

// Listen for clicks on the extension icon
chrome.action.onClicked.addListener(async () => {
    try {
        // Check if the extension page is already open
        const tabs = await chrome.tabs.query({
            url: chrome.runtime.getURL("html/main.html")
        });

        if (tabs.length > 0) {
            // If the page is already open, focus on it
            await chrome.tabs.update(tabs[0].id, { active: true });
            await chrome.windows.update(tabs[0].windowId, { focused: true });
            extensionTabId = tabs[0].id;
        } else {
            // Open a new tab with the extension page
            const tab = await chrome.tabs.create({
                url: chrome.runtime.getURL("html/main.html")
            });
            extensionTabId = tab.id;
        }
    } catch (error) {
        console.error("Error opening extension page:", error);
    }
});

// Initialize message listeners
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Ensure a response is sent even if errors occur
    let responseWasSent = false;
    const safeResponse = (response) => {
        try {
            if (!responseWasSent) {
                sendResponse(response);
                responseWasSent = true;
                return true;
            }
        } catch (err) {
            console.error('Error sending response:', err);
        }
        return false;
    };

    // Validate message structure
    if (!message || typeof message !== 'object') {
        console.warn('Received invalid message:', message);
        return safeResponse({ success: false, error: 'Invalid message format' });
    }

    // Comprehensive error handling for message processing
    try {
        // Handle different types of messages
        switch (message.action) {
            case 'capture_tab':
                handleCaptureTabRequest(message.tabId, sender.tab?.id || extensionTabId, safeResponse, message.captureParams);
                return true; // Keep the message channel open for async response

            case 'get_capture_progress':
                return safeResponse({
                    inProgress: captureData.inProgress,
                    progress: captureData.progress || 0
                });

            case 'capture_screenshot':
                captureScreenshot(
                    sender.tab.id,
                    message.x,
                    message.y,
                    message.totalWidth,
                    message.totalHeight,
                    message.viewportWidth || 1024,
                    message.viewportHeight || 768,
                    safeResponse,
                    message.scrollPositionError,
                    message.requestedX,
                    message.requestedY
                );
                return true;

            case 'capture_complete':
                handleCaptureComplete(message, safeResponse);
                return true;

            case 'capture_error':
                handleCaptureError(message.error, safeResponse);
                return true;

            case 'scroll_position_issue':
                handleScrollPositionIssue(message, sender.tab.id, safeResponse);
                return true;

            case 'capture_position_failed':
                handleCapturePositionFailed(message, sender.tab.id, safeResponse);
                return true;
                
            case 'capture_progress':
                // Simply acknowledge progress updates, no processing needed
                return safeResponse({ success: true });

            default:
                console.warn('Unhandled message action:', message.action);
                return safeResponse({ success: false, error: 'Unhandled message type' });
        }
    } catch (error) {
        console.error('Critical error processing message:', error);
        return safeResponse({
            success: false,
            error: 'Internal extension error: ' + error.message
        });
    }
});

/**
 * Handle the completion of the capture process
 * @param {Object} message - Message with capture data
 * @param {Function} sendResponse - Function to send response
 */
async function handleCaptureComplete(message, sendResponse) {
    try {
        captureData.inProgress = false;

        // Return to extension tab when capture is complete
        if (captureData.returnTabId) {
            await chrome.tabs.update(captureData.returnTabId, { active: true });

            // Send message to the extension tab with screenshot data
            chrome.tabs.sendMessage(captureData.returnTabId, {
                action: 'show_screenshots',
                screenshots: captureData.screenshots,
                sourceTabId: captureData.tabId,
                sourceUrl: message.url || ''
            });
        }

        sendResponse({ success: true });
    } catch (error) {
        console.error('Error completing capture:', error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * Handle capture errors
 * @param {string} errorMessage - Error message
 * @param {Function} sendResponse - Function to send response
 */
function handleCaptureError(errorMessage, sendResponse) {
    captureData.inProgress = false;

    // Forward error to extension tab
    if (captureData.returnTabId) {
        chrome.tabs.sendMessage(captureData.returnTabId, {
            action: 'capture_error',
            error: errorMessage
        });
    }

    if (sendResponse) {
        sendResponse({ success: false, error: errorMessage });
    }
}

/**
 * Handle request to capture a tab
 * @param {number} tabId - ID of the tab to capture
 * @param {number} returnTabId - Tab to return to after capture
 * @param {function} sendResponse - Function to send response back
 * @param {Object} captureParams - Optional capture parameters
 */
async function handleCaptureTabRequest(tabId, returnTabId, sendResponse, captureParams = null) {
    try {
        // Validate input parameters
        if (!tabId || typeof tabId !== 'number') {
            sendResponse({ success: false, error: 'Invalid tab ID provided' });
            return;
        }

        if (!returnTabId || typeof returnTabId !== 'number') {
            console.warn('No valid return tab ID provided, using current tab as fallback');
            // We'll continue with a potentially invalid returnTabId, it's non-critical
        }

        if (captureData.inProgress) {
            sendResponse({ success: false, error: 'Capture already in progress' });
            return;
        }

        // Log capture parameters if provided
        if (captureParams) {
            console.log('Using custom capture parameters:', captureParams);
        } else {
            captureParams = {}; // Initialize empty object if not provided
        }

        // Verify the tab exists and is accessible
        try {
            let tab;
            try {
                tab = await chrome.tabs.get(tabId);
            } catch (tabError) {
                console.error('Error getting tab:', tabError);
                sendResponse({ success: false, error: 'Tab not accessible: ' + tabError.message });
                return;
            }

            if (!tab) {
                sendResponse({ success: false, error: 'Tab not found' });
                return;
            }

            // Check if the tab URL is supported for capture
            if (!tab.url ||
                tab.url.startsWith('chrome:') ||
                tab.url.startsWith('chrome-extension:') ||
                tab.url.startsWith('about:') ||
                tab.url.startsWith('data:') ||
                tab.url.startsWith('file:')) {
                sendResponse({
                    success: false,
                    error: 'This type of page cannot be captured due to Chrome security restrictions'
                });
                return;
            }

            // Check if tab is in a group and handle potential errors
            if (tab.groupId && tab.groupId !== chrome.tabGroups?.TAB_GROUP_ID_NONE) {
                try {
                    // Try to get group info if available
                    if (chrome.tabGroups && typeof chrome.tabGroups.get === 'function') {
                        const group = await chrome.tabGroups.get(tab.groupId);
                        console.log('Tab is in group:', group);
                    }
                } catch (groupError) {
                    // If we can't get group info, just log and continue
                    console.warn('Tab is in a group but could not get group details:', groupError);
                    // No need to fail the capture, just log the issue
                }
            }
        } catch (error) {
            console.error('Error checking tab:', error);
            sendResponse({ success: false, error: 'Tab not accessible: ' + error.message });
            return;
        }

        // Reset capture data
        captureData = {
            tabId: tabId,
            screenshots: [],
            inProgress: true,
            progress: 0,
            returnTabId: returnTabId,
            captureParams: captureParams // Store capture parameters
        };

        // Navigate to the tab to be captured
        try {
            await chrome.tabs.update(tabId, { active: true });
        } catch (navigationError) {
            console.error('Error navigating to tab:', navigationError);
            sendResponse({ success: false, error: 'Failed to navigate to tab: ' + navigationError.message });
            captureData.inProgress = false;
            return;
        }

        // Wait a moment for the tab to become active
        setTimeout(async () => {
            try {
                // Inject the content script if needed
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        files: ['js/page-capture.js']
                    });
                } catch (scriptError) {
                    console.error('Error injecting content script:', scriptError);
                    sendResponse({
                        success: false,
                        error: 'Failed to inject content script: ' + scriptError.message
                    });
                    captureData.inProgress = false;
                    return;
                }

                // Send message to start capture with adaptive parameters
                try {
                    chrome.tabs.sendMessage(tabId, {
                        action: 'begin_capture',
                        captureParams: captureParams // Pass the capture parameters to the content script
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.error('Error starting capture:', chrome.runtime.lastError);
                            captureData.inProgress = false;
                            sendResponse({ success: false, error: chrome.runtime.lastError.message });
                        } else if (!response || !response.success) {
                            captureData.inProgress = false;
                            sendResponse({
                                success: false,
                                error: response?.error || 'Unknown error starting capture'
                            });
                        } else {
                            sendResponse({ success: true });
                        }
                    });
                } catch (messageError) {
                    console.error('Error sending message to content script:', messageError);
                    captureData.inProgress = false;
                    sendResponse({
                        success: false,
                        error: 'Failed to communicate with content script: ' + messageError.message
                    });
                }
            } catch (error) {
                console.error('Unexpected error in captureTab delayed execution:', error);
                captureData.inProgress = false;
                sendResponse({ success: false, error: 'Unexpected error: ' + error.message });
            }
        }, 500);
    } catch (error) {
        console.error('Critical error in handleCaptureTabRequest:', error);
        captureData.inProgress = false;
        sendResponse({ success: false, error: 'Critical error: ' + error.message });
    }
}

/**
 * Handle scroll position issues
 * @param {Object} message - Message with scroll position data
 * @param {number} tabId - ID of the tab with the issue
 * @param {Function} sendResponse - Function to send response
 */
function handleScrollPositionIssue(message, tabId, sendResponse) {
    // Log the issue for debugging, but only in verbose mode to reduce console noise
    if (message.error) {
        console.warn(`Scroll error in tab ${tabId}: ${message.error}`);
    } else {
        console.log(`Scroll position mismatch in tab ${tabId}: wanted (${message.wanted?.x}, ${message.wanted?.y}), got (${message.actual?.x}, ${message.actual?.y})`);
    }

    // Record issue in capture logs for potential troubleshooting
    if (!captureData.scrollIssues) {
        captureData.scrollIssues = [];
    }

    captureData.scrollIssues.push({
        tabId: tabId,
        timestamp: Date.now(),
        wanted: message.wanted || {},
        actual: message.actual || {},
        methodsTried: message.methods_tried || [],
        error: message.error || null
    });

    // Only keep last 10 issues to prevent memory bloat (reduced from 20)
    if (captureData.scrollIssues.length > 10) {
        captureData.scrollIssues.shift();
    }

    // Send acknowledgement
    if (sendResponse) {
        sendResponse({ received: true });
    }
}

/**
 * Handle capture position failure
 * @param {Object} message - Message with failure data
 * @param {number} tabId - ID of the tab with the issue
 * @param {Function} sendResponse - Function to send response
 */
function handleCapturePositionFailed(message, tabId, sendResponse) {
    // Use console.log instead of warn to reduce console noise
    console.log(`Capture position issue in tab ${tabId}: position [${message.position?.[0] || 0}, ${message.position?.[1] || 0}] failed after ${message.attempts} attempts`);

    // Check if this is a known issue with WindowWidth
    if (message.error && message.error.includes('windowWidth is not defined')) {
        console.log('This is a known issue with viewport dimensions - continuing capture process');
        // Don't need to record these specific errors as they're expected in some browsers
    } else {
        // Record other failures in capture logs
        if (!captureData.captureFailures) {
            captureData.captureFailures = [];
        }

        captureData.captureFailures.push({
            tabId: tabId,
            timestamp: Date.now(),
            position: message.position || [0, 0],
            attempts: message.attempts || 1,
            error: message.error || 'Unknown error'
        });

        // Only keep last 5 failures to prevent memory bloat (reduced from 10)
        if (captureData.captureFailures.length > 5) {
            captureData.captureFailures.shift();
        }
    }

    // Send acknowledgement
    if (sendResponse) {
        sendResponse({ received: true });
    }
}

/**
 * Capture a screenshot of the visible area of a tab
 * @param {number} tabId - ID of the tab to capture
 * @param {number} x - X scroll position
 * @param {number} y - Y scroll position
 * @param {number} totalWidth - Total width of the page
 * @param {number} totalHeight - Total height of the page
 * @param {number} viewportWidth - Width of the viewport
 * @param {number} viewportHeight - Height of the viewport
 * @param {function} sendResponse - Function to send response back
 * @param {boolean} scrollPositionError - Flag indicating scroll position issues
 * @param {number} requestedX - Originally requested X position
 * @param {number} requestedY - Originally requested Y position
 */
async function captureScreenshot(tabId, x, y, totalWidth, totalHeight, viewportWidth, viewportHeight, sendResponse, scrollPositionError, requestedX, requestedY) {
    // Implement robust error handling and rate limiting
    try {
        // Check if we've hit Chrome's screenshot capture rate limit
        if (captureData.screenshots.length >= 50) {
            throw new Error('Maximum screenshot capture limit reached');
        }

        // Update progress percentage based on position in page
        const progress = calculateProgress(x, y, totalWidth, totalHeight, viewportWidth, viewportHeight);
        captureData.progress = progress;

        // For scroll position errors, use adjusted delay to allow page to settle
        const baseDelay = captureData.screenshots.length > 0 ? 300 : 100;
        const delay = scrollPositionError ? baseDelay + 200 : baseDelay;
        await new Promise(resolve => setTimeout(resolve, delay));

        // Keep track of capture attempts
        let attempts = 0;
        const maxAttempts = scrollPositionError ? 4 : 3; // More attempts for scroll errors
        let dataUrl = null;

        // Try multiple times with increasing delay if rate-limited
        while (attempts < maxAttempts && !dataUrl) {
            try {
                // Capture the visible area with error protection
                dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png', quality: 100 });
                break; // Successful capture, exit the loop
            } catch (captureError) {
                attempts++;

                // Specific handling for different capture errors
                if (captureError.message.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
                    console.warn(`Rate limit hit, attempt ${attempts}/${maxAttempts}. Waiting longer...`);

                    // Wait longer for each retry
                    await new Promise(resolve => setTimeout(resolve, attempts * 500));

                    if (attempts >= maxAttempts) {
                        throw new Error('Exceeded screenshot capture rate. Please slow down.');
                    }
                } else {
                    // Other error - rethrow
                    throw captureError;
                }
            }
        }

        // Validate captured screenshot
        if (!dataUrl || dataUrl.length < 1000) {
            throw new Error('Captured screenshot is invalid or too small');
        }

        // Store the screenshot with position data - also record requested position if different
        captureData.screenshots.push({
            dataUrl: dataUrl,
            x: x,
            y: y,
            requestedX: requestedX !== undefined ? requestedX : x,
            requestedY: requestedY !== undefined ? requestedY : y,
            scrollPositionError: scrollPositionError || false
        });

        // Send success response with progress
        sendResponse({
            success: true,
            progress: progress,
            screenshotCount: captureData.screenshots.length
        });

    } catch (error) {
        console.error('Error capturing screenshot:', error);

        // Reset capture state on critical errors
        captureData.inProgress = false;

        // Send detailed error to extension tab
        if (captureData.returnTabId) {
            try {
                chrome.tabs.sendMessage(captureData.returnTabId, {
                    action: 'capture_error',
                    error: `Screenshot capture failed: ${error.message}`,
                    details: {
                        x, y,
                        requestedX, requestedY,
                        scrollPositionError,
                        totalWidth,
                        totalHeight,
                        viewportWidth,
                        viewportHeight
                    }
                });
            } catch (messagingError) {
                console.error('Failed to send error message:', messagingError);
            }
        }

        // Send error response
        sendResponse({
            success: false,
            error: error.message,
            details: error.toString()
        });
    }
}

/**
 * Calculate capture progress based on position
 * @param {number} x - Current X position
 * @param {number} y - Current Y position
 * @param {number} totalWidth - Total width of the page
 * @param {number} totalHeight - Total height of the page
 * @param {number} viewportWidth - Width of the viewport
 * @param {number} viewportHeight - Height of the viewport
 * @returns {number} - Progress percentage (0-100)
 */
function calculateProgress(x, y, totalWidth, totalHeight, viewportWidth, viewportHeight) {
    // Don't use window.innerWidth since it's not available in background context
    const totalArea = totalWidth * totalHeight;
    if (totalArea <= 0) return 0;

    // Calculate area covered so far using viewport dimensions passed from content script
    const capturedArea = (x + viewportWidth) * (totalHeight - y);
    const progress = Math.min(Math.round((capturedArea / totalArea) * 100), 100);
    return progress;
} 