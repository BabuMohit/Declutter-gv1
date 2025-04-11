/**
 * Main Extension Controller
 * Coordinates all modules and handles the main extension flow
 */

import TabManager from './tab-manager.js';
import UIController from './ui-controller.js';
import ImageProcessor from './image-processor.js';
import SmartCacheManager from './smart-cache-manager.js';
import ActivityTracker from './activity-tracker.js';
import TabGroupManager from './tab-group-manager.js';
import WorkspaceIndexedDBManager from './workspace-indexeddb-manager.js';
import Sidebar from './sidebar.js';

/**
 * Main application controller
 */
class App {
    constructor() {
        // Ensure critical components are initialized safely
        this.tabManager = null;
        this.ui = null;
        this.cacheManager = null;
        this.activityTracker = null;
        this.tabGroupManager = null;
        this.workspaceManager = null;
        this.sidebar = null;
        this.currentScreenshot = null;
        this.currentTabInfo = null;
        this.captureInProgress = false;
        this.captureRetryCount = 0;
        this.MAX_RETRY_COUNT = 3;
        this.loadAllQueue = [];
        this.isLoadingAll = false;
        this.cancelLoadAll = false;
        this.loadAllInProgress = false;
        this.loadAllTotal = 0;
        this.loadAllProcessed = 0;

        // Bind critical methods to ensure correct context
        this.init = this.init.bind(this);
        this.setupMessageListeners = this.setupMessageListeners.bind(this);
    }

    /**
     * Initialize the application with comprehensive error handling
     */
    async init() {
        try {
            console.log('Initializing Declutter! extension...');

            // Validate browser environment before initialization
            if (!this.checkBrowserCompatibility()) {
                throw new Error('Browser does not meet extension requirements');
            }

            // Initialize modules with error protection
            this.ui = new UIController();
            
            // Initialize activity tracker for smart caching
            this.activityTracker = new ActivityTracker();
            await this.activityTracker.init();
            
            // Initialize smart cache manager with activity tracking
            this.cacheManager = new SmartCacheManager();
            await this.cacheManager.init(this.activityTracker);
            
            // Initialize tab manager with activity tracker reference
            this.tabManager = new TabManager();
            await this.tabManager.init(document.getElementById('tab-list'), this.handleTabSelect.bind(this), this.activityTracker);

            // Initialize tab group manager if available
            if (chrome.tabGroups) {
                this.tabGroupManager = new TabGroupManager();
                await this.tabGroupManager.init();
            }

            // Initialize workspace manager
            this.workspaceManager = new WorkspaceIndexedDBManager();
            await this.workspaceManager.init();

            // Initialize sidebar
            this.sidebar = new Sidebar(this.workspaceManager);
            this.sidebar.init();

            // Initialize UI 
            this.ui.init({
                previewContainer: '#preview-container',
                progressContainer: '#progress-container',
                progressBar: '#progress-bar',
                progressText: '#progress-text',
                errorContainer: '#error-container'
            });

            // Initialize tab manager
            await this.tabManager.init(
                document.getElementById('tab-list'),
                this.handleTabSelect.bind(this)
            );

            // Initialize cache manager with robust error handling
            try {
                const cacheInitResult = await this.cacheManager.init();
                if (!cacheInitResult) {
                    console.warn('Cache manager initialization was not fully successful');
                    // Show warning in UI but continue
                    this.ui.showMessage(
                        'Warning: Screenshot caching system may be limited. Some functionality might be affected.',
                        'warning',
                        5000
                    );
                }
            } catch (cacheError) {
                console.error('Cache manager initialization error:', cacheError);
                // Still continue with the app, just show a warning
                this.ui.showMessage(
                    'Cache system error. Some features may be limited.',
                    'warning',
                    5000
                );
            }

            // Show storage info in UI
            this.showStorageInfo();

            // Update the list of cached tabs
            try {
                await this.updateCachedTabsList();
            } catch (cacheListError) {
                console.error('Error updating cached tabs list:', cacheListError);
                // Non-fatal error, continue
            }

            // Set up event listeners
            this.setupEventListeners();

            // Set up message listeners for communication with background script
            this.setupMessageListeners();

            console.log('Extension initialized successfully');

            // Display info message about tab persistence feature
            this.ui.showMessage(
                'Tab persistence is enabled. Closed tabs will remain in the list until manually removed.',
                'info',
                5000
            );
        } catch (error) {
            console.error('Fatal error during initialization:', error);
            this.ui?.showError('Failed to initialize extension: ' + error.message);
        }
    }

    /**
     * Display a fatal error that prevents extension from functioning
     * @param {string} message - Error message to display
     */
    displayFatalError(message) {
        // Ensure error is visible even if UI is not fully initialized
        const errorContainer = document.createElement('div');
        errorContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            background-color: #ff4444;
            color: white;
            padding: 15px;
            text-align: center;
            z-index: 1000;
        `;
        errorContainer.innerHTML = `
            <h2>Extension Initialization Failed</h2>
                    <p>${message}</p>
            <button onclick="window.location.reload()">Retry</button>
        `;
        document.body.insertBefore(errorContainer, document.body.firstChild);
    }

    /**
     * Set up listeners for messages from background script with enhanced error handling
     */
    setupMessageListeners() {
        // Comprehensive validation of messaging environment
        if (typeof chrome === 'undefined') {
            throw new Error('Chrome APIs are not available');
        }

        if (!chrome.runtime || !chrome.runtime.onMessage) {
            throw new Error('chrome.runtime.onMessage is undefined');
        }

        // Validate message listener method
        if (typeof chrome.runtime.onMessage.addListener !== 'function') {
            throw new Error('chrome.runtime.onMessage.addListener is not a valid function');
        }

        // Create a robust message handler
        const messageHandler = (message, sender, sendResponse) => {
            // Validate message structure
            if (!message || typeof message !== 'object') {
                console.warn('Received invalid message:', message);
                return false;
            }

            // Validate message action
            if (!message.action || typeof message.action !== 'string') {
                console.warn('Message missing valid action:', message);
                return false;
            }

            try {
                // Comprehensive message type handling
                switch (message.action) {
                    case 'show_screenshots':
                        if (this.handleScreenshotsReceived) {
                            this.handleScreenshotsReceived(message);
                        }
                        break;
                    case 'capture_progress':
                        if (this.updateCaptureProgress) {
                            this.updateCaptureProgress(
                                message.percent || 0,
                                message.status || 'Capturing'
                            );
                        }
                        break;
                    case 'capture_error':
                        if (this.handleCaptureError) {
                            this.handleCaptureError(message.error || 'Unknown capture error');
                        }
                        break;
                    case 'capture_truncated':
                        if (this.handleCaptureTruncated) {
                            this.handleCaptureTruncated(
                                message.maximumHeight || 0,
                                message.actualHeight || 0
                            );
                        }
                        break;
                    case 'capture_screenshot':
                        // Log or handle capture_screenshot message if needed
                        console.log('Capture screenshot message received', message);
                        break;
                    case 'capture_complete':
                        // Log or handle capture_complete message if needed
                        console.log('Capture complete message received', message);
                        break;
                    default:
                        console.warn('Unhandled message action:', message.action);
                }
            } catch (processingError) {
                console.error('Error processing message:', processingError);
            }

            return false;
        };

        // Safe listener addition
        try {
            chrome.runtime.onMessage.addListener(messageHandler);
            console.log('Message listener successfully added');
        } catch (listenerError) {
            console.error('Failed to add message listener:', listenerError);
            throw new Error('Could not establish message communication');
        }
    }

    /**
     * Check browser compatibility for required features
     * @returns {boolean} - Whether browser is compatible
     */
    checkBrowserCompatibility() {
        // Check for Chrome APIs
        if (!chrome || !chrome.tabs || !chrome.runtime) {
            console.error('Chrome extension APIs not available');
            return false;
        }

        // Check for required DOM APIs
        if (!document.createElement || !document.querySelector) {
            console.error('Required DOM APIs not available');
            return false;
        }

        // Check for canvas support
        return ImageProcessor.checkBrowserSupport();
    }

    /**
     * Show compatibility error message
     */
    showCompatibilityError() {
        // Create error manually since UI might not be initialized
        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            appContainer.innerHTML = `
                <div style="padding: 40px; text-align: center; color: #d32f2f;">
                    <h2>Browser Compatibility Error</h2>
                    <p>Your browser does not support all the features required by this extension.</p>
                    <p>Please make sure you're using the latest version of Chrome.</p>
                </div>
            `;
        }
    }

    /**
     * Handle tab selection event
     * @param {Object} tab - Selected tab object
     */
    async handleTabSelect(tab) {
        if (!tab) return;
        
        // Update activity timestamp when user interacts with the UI
        if (this.activityTracker) {
            this.activityTracker.updateActivity();
        }

        try {
            // Clear any existing errors - check if method exists first
            if (this.ui && typeof this.ui.hideError === 'function') {
                this.ui.hideError();
            } else if (this.ui && typeof this.ui.clearError === 'function') {
                this.ui.clearError();
            }

            // Safety check for tab object
            if (!tab || typeof tab !== 'object') {
                console.error('Invalid tab object passed to handleTabSelect');
                if (this.ui) this.ui.showError('Error selecting tab: Invalid tab data');
                return;
            }

            // Check if this is the same tab as currently displayed
            const isReselectedTab = this.currentTabInfo && this.currentTabInfo.id === tab.id;

            // If this is the same tab and we have a screenshot displayed, show a prominent refresh button
            if (isReselectedTab && document.querySelector('#preview-container img')) {
                console.log('Tab reselected, showing prominent refresh button');
                this.showProminentRefreshButton(tab);
                return;
            }

            // Check if tab is capturable
            if (!this.isCapturableUrl(tab.url)) {
                this.ui.showError(
                    'This type of page cannot be captured due to Chrome security restrictions. ' +
                    'Chrome does not allow extensions to access certain URLs ' +
                    '(chrome:// pages, Web Store, and other restricted domains).'
                );
                return;
            }

            // Highlight selected tab in the UI
            if (this.tabManager && typeof this.tabManager.highlightSelectedTab === 'function') {
                this.tabManager.highlightSelectedTab(tab.id);
            }

            // Store the current tab info
            this.currentTabInfo = tab;

            // Check if selected tab is still open in Chrome
            let tabStillExists = true;
            if (!tab.isOpenInChrome) {
                // Show notice that tab is closed but we can still show its preview if cached
                this.ui.showMessage(
                    'This tab is closed. Hover over the tab and click "Open this tab" button to generate a preview.',
                    'warning',
                    10000
                );
                tabStillExists = false;
            }

            // Check if cacheManager is properly initialized
            if (!this.cacheManager) {
                console.error('Cache manager not initialized');
                this.ui.showLoading('Capturing screenshot...');
                if (tabStillExists) {
                    await this.startCapture(tab);
                } else {
                    this.ui.showMessage(
                        'This tab is closed. Hover over the tab and click "Open this tab" button to generate a preview.',
                        'warning',
                        10000
                    );
                }
                return;
            }

            // Check if we already have a cached screenshot for this tab
            try {
                const cachedScreenshots = await this.cacheManager.getScreenshots(tab.id);
                if (cachedScreenshots && cachedScreenshots.length > 0) {
                    // Use cached screenshots
                    console.log('Using cached screenshots for tab:', tab.id);
                    this.handleScreenshotsReceived({
                        screenshots: cachedScreenshots,
                        sourceTabId: tab.id,
                        sourceUrl: tab.url,
                        fromCache: true
                    });

                    // If tab still exists, add a refresh button to get a fresh capture
                    if (tabStillExists) {
                        const refreshCallback = async () => {
                            try {
                                // Remove existing refresh button if present
                                const existingButton = document.getElementById('refresh-capture-btn');
                                if (existingButton) {
                                    existingButton.remove();
                                }

                                // Show message
                                this.ui.showMessage('Refreshing preview...', 'info', 2000);

                                // Start new capture
                                await this.startCapture(tab);
                            } catch (refreshError) {
                                console.error('Error refreshing capture:', refreshError);
                                this.ui.showError('Failed to refresh capture: ' + refreshError.message);
                            }
                        };

                        // Add refresh button to preview container
                        const refreshButton = document.createElement('button');
                        refreshButton.id = 'refresh-capture-btn';
                        refreshButton.className = 'btn btn-secondary';
                        refreshButton.innerHTML = '<span class="icon-refresh"></span> Refresh Preview';
                        refreshButton.addEventListener('click', refreshCallback);

                        // Find preview header or create one
                        let previewHeader = document.querySelector('.preview-header');
                        if (!previewHeader) {
                            previewHeader = document.createElement('div');
                            previewHeader.className = 'preview-header';
                            const previewContainer = document.getElementById('preview-container');
                            if (previewContainer) {
                                previewContainer.prepend(previewHeader);
                            }
                        }

                        // Add button to header
                        if (previewHeader) {
                            previewHeader.appendChild(refreshButton);
                        }
                    }
                } else {
                    console.log('No cached screenshot found for tab:', tab.id);

                    // If the tab is no longer open, we can't capture it
                    if (!tabStillExists) {
                        this.ui.showMessage(
                            'This tab is closed. Hover over the tab and click "Open this tab" button to generate a preview.',
                            'warning',
                            10000
                        );
                        return;
                    }

                    // Start fresh capture for open tab
                    this.ui.showLoading('Capturing screenshot...');
                    await this.startCapture(tab);
                }
            } catch (cacheError) {
                console.error('Error accessing screenshot cache:', cacheError);

                // If the tab is no longer open, we can't capture it
                if (!tabStillExists) {
                    this.ui.showMessage(
                        'This tab is closed. Hover over the tab and click "Open this tab" button to generate a preview.',
                        'warning',
                        10000
                    );
                    return;
                }

                // Fallback to fresh capture
                this.ui.showLoading('Capturing screenshot...');
                await this.startCapture(tab);
            }
        } catch (error) {
            console.error('Error selecting tab:', error);
            if (this.ui) {
                this.ui.showError('Error selecting tab: ' + error.message);
            }
        }
    }

    /**
     * Show a prominent refresh button when reselecting the current tab
     * @param {Object} tab - The tab to refresh
     */
    showProminentRefreshButton(tab) {
        // Remove any existing refresh button first
        const existingButton = document.getElementById('refresh-capture-btn');
        if (existingButton) {
            existingButton.remove();
        }

        // Create refresh callback
        const refreshCallback = async () => {
            try {
                // Show message
                this.ui.showMessage('Refreshing preview...', 'info', 2000);

                // Remove the button during refresh
                const btnToRemove = document.getElementById('refresh-capture-btn');
                if (btnToRemove) {
                    btnToRemove.remove();
                }

                // Start new capture
                await this.startCapture(tab);
            } catch (refreshError) {
                console.error('Error refreshing capture:', refreshError);
                this.ui.showError('Failed to refresh capture: ' + refreshError.message);
            }
        };

        // Create a prominent refresh button
        const refreshButton = document.createElement('button');
        refreshButton.id = 'refresh-capture-btn';
        refreshButton.className = 'btn btn-primary';
        refreshButton.innerHTML = '<span class="icon-refresh"></span> Refresh Preview';
        refreshButton.style.cssText = `
            margin-right: 10px;
            background-color: #4CAF50;
            color: white;
            border: none;
            padding: 8px 15px;
            font-weight: bold;
        `;
        refreshButton.addEventListener('click', refreshCallback);

        // Find the download button to position next to it
        const downloadButton = document.querySelector('#preview-container .btn-download');
        if (downloadButton) {
            downloadButton.parentNode.insertBefore(refreshButton, downloadButton);
        } else {
            // Fallback if download button not found
            const previewContainer = document.getElementById('preview-container');
            if (previewContainer) {
                const header = previewContainer.querySelector('.preview-header') || previewContainer;
                header.appendChild(refreshButton);
            }
        }

        // Show a message to guide the user
        this.ui.showMessage('Click "Refresh Preview" to update this tab\'s preview', 'info', 3000);
    }

    /**
     * Start the capture process with retry support
     * @param {Object} tab - Tab to capture
     */
    startCapture(tab) {
        try {
            // Verify that chrome runtime API is available
            if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
                console.error('Chrome runtime API not available');
                this.ui.showError('Capture Failed', 'Chrome API not available. Please reload the extension.');
                this.tabManager.setCaptureInProgress(false);
                this.captureInProgress = false;
                return;
            }

            // Verify tab ID
            if (!tab || !tab.id) {
                console.error('Invalid tab object for capture');
                this.ui.showError('Capture Failed', 'Invalid tab data.');
                this.tabManager.setCaptureInProgress(false);
                this.captureInProgress = false;
                return;
            }

            // Send capture request to background script
            chrome.runtime.sendMessage(
                { action: 'capture_tab', tabId: tab.id },
                (response) => {
                    // Check for runtime errors first
                    if (chrome.runtime.lastError) {
                        console.error('Chrome runtime error:', chrome.runtime.lastError);

                        if (this.captureRetryCount < this.MAX_RETRY_COUNT) {
                            this.captureRetryCount++;
                            console.log(`Retrying capture after runtime error (${this.captureRetryCount}/${this.MAX_RETRY_COUNT})...`);

                            // Retry after a short delay
                            setTimeout(() => {
                                this.startCapture(tab);
                            }, 1000);
                        } else {
                            // Max retries reached, show error
                            this.ui.showError(
                                'Capture Failed',
                                'Chrome runtime error: ' + (chrome.runtime.lastError.message || 'Unknown error'),
                                () => this.handleTabSelect(tab) // Fresh retry
                            );
                            this.tabManager.setCaptureInProgress(false);
                            this.captureInProgress = false;
                        }
                        return;
                    }

                    if (!response || !response.success) {
                        console.error('Failed to initiate capture:', response?.error || 'Unknown error');

                        // Check if we should retry
                        if (this.captureRetryCount < this.MAX_RETRY_COUNT) {
                            this.captureRetryCount++;
                            console.log(`Retrying capture (${this.captureRetryCount}/${this.MAX_RETRY_COUNT})...`);
                            this.ui.showProgress(0, `Retrying capture (${this.captureRetryCount}/${this.MAX_RETRY_COUNT})...`);

                            // Retry after a short delay
                            setTimeout(() => {
                                this.startCapture(tab);
                            }, 1000);
                        } else {
                            // Max retries reached, show error
                            this.ui.showError(
                                'Capture Failed',
                                response?.error || 'Failed to initiate capture after multiple attempts',
                                () => this.handleTabSelect(tab) // Fresh retry
                            );
                            this.tabManager.setCaptureInProgress(false);
                            this.captureInProgress = false;
                        }
                    } else {
                        this.ui.showProgress(0, 'Capture in progress...');
                    }
                }
            );
        } catch (error) {
            console.error('Unexpected error in startCapture:', error);
            this.ui.showError('Capture Failed', 'Unexpected error: ' + error.message);
            this.tabManager.setCaptureInProgress(false);
            this.captureInProgress = false;
        }
    }

    /**
     * Handle screenshots received from background script
     * @param {Object} message - Message containing screenshots and metadata
     */
    async handleScreenshotsReceived(message) {
        try {
            const { screenshots, sourceTabId, sourceUrl } = message;

            // Validate screenshots array
            if (!screenshots || !Array.isArray(screenshots) || screenshots.length === 0) {
                throw new Error('No valid screenshots received');
            }

            // Validate screenshot format
            for (let i = 0; i < screenshots.length; i++) {
                const screenshot = screenshots[i];
                if (!screenshot || typeof screenshot !== 'object') {
                    console.error(`Invalid screenshot at index ${i}, not an object:`, screenshot);
                    screenshots[i] = null; // Mark as invalid
                    continue;
                }

                if (!screenshot.dataUrl) {
                    console.error(`Screenshot at index ${i} missing dataUrl:`, screenshot);
                    screenshots[i] = null; // Mark as invalid
                    continue;
                }

                // Ensure x and y coordinates exist (default to 0,0 if missing)
                if (typeof screenshot.x !== 'number') screenshot.x = 0;
                if (typeof screenshot.y !== 'number') screenshot.y = 0;
            }

            // Filter out invalid screenshots
            const validScreenshots = screenshots.filter(s => s !== null);

            if (validScreenshots.length === 0) {
                throw new Error('All screenshots were invalid');
            }

            // Update progress - check if UI is available
            if (this.ui && typeof this.ui.showProgress === 'function') {
                this.ui.showProgress(90, 'Processing screenshots...');
            }

            // Get tab info
            let tabInfo = this.currentTabInfo;
            if (!tabInfo && sourceTabId) {
                tabInfo = this.tabManager.getTabById(sourceTabId);
            }
            if (!tabInfo && sourceUrl) {
                // Create minimal tab info from URL
                tabInfo = {
                    title: this.extractTitleFromUrl(sourceUrl),
                    url: sourceUrl,
                    favIconUrl: this.getFavIconForUrl(sourceUrl)
                };
            }

            try {
                // Check if ImageProcessor is available
                if (!ImageProcessor || typeof ImageProcessor.stitchScreenshots !== 'function') {
                    throw new Error('Image processing functionality is not available');
                }

                // Log detailed screenshot info for debugging
                console.log(`Processing ${validScreenshots.length} valid screenshots`);

                // Stitch screenshots together
                const stitchedImage = await ImageProcessor.stitchScreenshots(validScreenshots);
                if (!stitchedImage) {
                    throw new Error('Failed to stitch screenshots - result was empty');
                }

                // Create URL for display
                if (typeof ImageProcessor.createImageUrl !== 'function') {
                    throw new Error('Image URL creation functionality is not available');
                }
                const imageUrl = ImageProcessor.createImageUrl(stitchedImage);
                if (!imageUrl) {
                    throw new Error('Failed to create image URL from stitched image');
                }

                // Display the screenshot - check if UI is available
                if (this.ui && typeof this.ui.showScreenshot === 'function') {
                    this.ui.showScreenshot(imageUrl, tabInfo || { title: 'Captured Tab', url: sourceUrl || '' });
                } else {
                    console.error('Cannot display screenshot: UI controller not available');
                }

                // Store current screenshot blob for download
                this.currentScreenshot = stitchedImage;

                // Robust caching with extensive error handling
                if (tabInfo && tabInfo.id && this.cacheManager) {
                    try {
                        console.log('Attempting to cache screenshot for tab:', tabInfo.id);
                        await this.cacheManager.cacheScreenshot(
                            tabInfo.id,
                            imageUrl,
                            {
                                title: tabInfo.title || 'Captured Tab',
                                url: tabInfo.url || sourceUrl || '',
                                favIconUrl: tabInfo.favIconUrl || this.getFavIconForUrl(tabInfo.url || sourceUrl || '')
                            }
                        );
                        console.log('Screenshot cached successfully');

                        // Update the cachedTabIds Set and apply visual indicator immediately
                        if (this.tabManager && typeof this.tabManager.updateCachedTabIds === 'function') {
                            // Add this tab to the cachedTabIds set
                            const updatedCachedIds = new Set(this.tabManager.cachedTabIds || []);
                            updatedCachedIds.add(tabInfo.id);

                            // Update the cached tab IDs in the tab manager
                            this.tabManager.updateCachedTabIds(updatedCachedIds);

                            // Also update the tab element directly without requiring a refresh
                            const tabElement = document.querySelector(`.tab-item[data-tab-id="${tabInfo.id}"]`);
                            if (tabElement && !tabElement.classList.contains('cached')) {
                                tabElement.classList.add('cached');
                                console.log(`Added cached class to tab element ${tabInfo.id}`);
                            }
                        }
                    } catch (cacheError) {
                        console.error('Failed to cache screenshot:', cacheError);
                        // Non-fatal error - continue with extension functionality
                        if (this.ui && typeof this.ui.showMessage === 'function') {
                            this.ui.showMessage(
                                'Warning: Could not cache screenshot. Storage might be full or unavailable.',
                                'warning'
                            );
                        }
                    }
                }
            } catch (error) {
                console.error('Error processing screenshots:', error);

                // If we have at least one valid screenshot with dataUrl, show it as fallback
                const fallbackScreenshot = validScreenshots.find(s => s && s.dataUrl);

                if (fallbackScreenshot) {
                    try {
                        const fallbackBlob = await this.dataUrlToBlob(fallbackScreenshot.dataUrl);
                        const fallbackUrl = URL.createObjectURL(fallbackBlob);

                        if (this.ui && typeof this.ui.showScreenshot === 'function') {
                            this.ui.showScreenshot(
                                fallbackUrl,
                                tabInfo || { title: 'Partial Screenshot', url: sourceUrl || '' }
                            );
                        }

                        if (this.ui && typeof this.ui.showMessage === 'function') {
                            this.ui.showMessage(
                                'Warning: Only showing partial screenshot. Full stitching failed: ' + error.message,
                                'warning'
                            );
                        }

                        this.currentScreenshot = fallbackBlob;
                    } catch (fallbackError) {
                        console.error('Error showing fallback screenshot:', fallbackError);
                        if (this.ui && typeof this.ui.showError === 'function') {
                            this.ui.showError('Failed to process screenshot: ' + error.message);
                        }
                    }
                } else {
                    // No fallback available
                    if (this.ui && typeof this.ui.showError === 'function') {
                        this.ui.showError('Failed to process screenshots: ' + error.message);
                    }
                }
            }
        } catch (error) {
            console.error('Error handling screenshots:', error);
            if (this.ui && typeof this.ui.showError === 'function') {
                this.ui.showError('Failed to handle screenshots: ' + error.message);
            }
        } finally {
            // Ensure capture progress is updated regardless of success or failure
            if (this.tabManager && typeof this.tabManager.setCaptureInProgress === 'function') {
                this.tabManager.setCaptureInProgress(false);
            }
            this.captureInProgress = false;
        }
    }

    /**
     * Convert a data URL to a Blob
     * @param {string} dataUrl - Data URL to convert
     * @returns {Promise<Blob>} - The resulting blob
     */
    dataUrlToBlob(dataUrl) {
        return new Promise((resolve, reject) => {
            try {
                // Validate dataUrl format
                if (!dataUrl || typeof dataUrl !== 'string') {
                    reject(new Error('Invalid data URL: not a string'));
                    return;
                }

                if (!dataUrl.startsWith('data:')) {
                    reject(new Error('Invalid data URL format: must start with "data:"'));
                    return;
                }

                // Parse the data URL
                const [header, base64Data] = dataUrl.split(',', 2);
                if (!header || !base64Data) {
                    reject(new Error('Invalid data URL: missing header or data'));
                    return;
                }

                // Extract mime type from header
                const matches = header.match(/^data:(.*?)(;base64)?$/);
                if (!matches) {
                    reject(new Error('Invalid data URL header format'));
                    return;
                }

                const mimeType = matches[1] || 'image/png'; // Default to png if not specified

                try {
                    // Decode base64 data
                    const binaryString = atob(base64Data);
                    const byteArray = new Uint8Array(binaryString.length);

                    for (let i = 0; i < binaryString.length; i++) {
                        byteArray[i] = binaryString.charCodeAt(i);
                    }

                    // Create and return blob
                    resolve(new Blob([byteArray], { type: mimeType }));
                } catch (encodingError) {
                    console.error('Error decoding base64 data:', encodingError);
                    reject(new Error('Failed to decode data URL: ' + encodingError.message));
                }
            } catch (error) {
                console.error('Error processing data URL:', error);
                reject(error);
            }
        });
    }

    /**
     * Extract a title from URL for fallback display
     * @param {string} url - URL to extract title from
     * @returns {string} - Extracted title
     */
    extractTitleFromUrl(url) {
        try {
            // Add URL validation before constructing URL object
            if (!url || typeof url !== 'string') {
                return 'Captured Tab';
            }

            // Validate URL format
            const urlRegex = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
            if (!urlRegex.test(url)) {
                return 'Captured Tab';
            }

            const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
            // Use hostname and pathname for a reasonable title
            return urlObj.hostname.replace('www.', '') + urlObj.pathname.substring(0, 20);
        } catch (error) {
            console.warn('URL parsing error:', error);
            return 'Captured Tab';
        }
    }

    /**
     * Get a favicon URL for a domain
     * @param {string} url - URL to get favicon for
     * @returns {string} - Favicon URL
     */
    getFavIconForUrl(url) {
        try {
            const urlObj = new URL(url);
            return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
        } catch (error) {
            return '';
        }
    }

    /**
     * Update the capture progress display
     * @param {number} percent - Percentage complete (0-100)
     * @param {string} status - Status message
     */
    updateCaptureProgress(percent, status) {
        this.ui.showProgress(percent, status);
    }

    /**
     * Handle capture process errors
     * @param {string} errorMessage - Error message
     */
    handleCaptureError(errorMessage) {
        this.ui.showError(
            'Capture Failed',
            errorMessage || 'An unknown error occurred during capture',
            () => {
                if (this.currentTabInfo) {
                    this.handleTabSelect(this.currentTabInfo);
                }
            }
        );
        this.tabManager.setCaptureInProgress(false);
        this.captureInProgress = false;
    }

    /**
     * Check if a URL can be captured
     * @param {string} url - URL to check
     * @returns {boolean} - Whether the URL can be captured
     */
    isCapturableUrl(url) {
        return !(
            url.startsWith('chrome://') ||
            url.startsWith('chrome-extension://') ||
            url.startsWith('about:') ||
            url.startsWith('data:') ||
            url.startsWith('file:') ||
            url.startsWith('view-source:') ||
            url.startsWith('devtools:')
        );
    }

    /**
     * Handle notification about a truncated capture due to infinite scrolling
     * @param {number} maximumHeight - Maximum height captured
     * @param {number} actualHeight - Actual height detected
     */
    handleCaptureTruncated(maximumHeight, actualHeight) {
        const heightInPages = Math.round(maximumHeight / 1000);
        this.ui.showMessage(
            `Page was too long (${Math.round(actualHeight / 1000)}K px). Capture limited to ${heightInPages}K pixels.`,
            8000 // Show for 8 seconds
        );

        console.warn(`Infinite scrolling page detected. Capture limited to ${maximumHeight}px of ${actualHeight}px total height.`);
    }

    /**
     * Initialize Load All functionality
     */
    initLoadAllFeature() {
        console.log('Initializing Load All feature...');

        // Set up Load All button
        const loadAllBtn = document.getElementById('load-all-btn');
        if (!loadAllBtn) {
            console.error('Load All button not found in the DOM');
        } else {
            console.log('Load All button found, adding event listener');
            loadAllBtn.addEventListener('click', () => {
                console.log('Load All button clicked');
                this.startLoadAllPreviews();
            });
        }

        // Set up Clear Cache button
        const clearCacheBtn = document.getElementById('clear-cache-btn');
        if (!clearCacheBtn) {
            console.error('Clear Cache button not found in the DOM');
        } else {
            console.log('Clear Cache button found, adding event listener');
            clearCacheBtn.addEventListener('click', () => {
                console.log('Clear Cache button clicked');
                this.clearAllCache();
            });
        }

        // Add Repair Database button
        this.addRepairDatabaseButton();
    }

    /**
     * Add a repair database button to the UI
     */
    addRepairDatabaseButton() {
        // Look for settings container or create one if needed
        let settingsContainer = document.querySelector('.settings-container');

        // If no existing container is found, create a new one
        if (!settingsContainer) {
            // Try to find an appropriate container
            settingsContainer = document.querySelector('.actions-container') ||
                document.querySelector('.tab-actions') ||
                document.querySelector('.controls');

            if (!settingsContainer) {
                settingsContainer = document.createElement('div');
                settingsContainer.className = 'settings-container actions-container';
                settingsContainer.style.marginTop = '10px';

                // Try to find a parent to append to
                const parentContainer = document.querySelector('.app-container') ||
                    document.querySelector('#main-content') ||
                    document.body;

                parentContainer.appendChild(settingsContainer);
                console.log('Created new container for repair database button');
            }
        }

        // Create the repair button
        const repairButton = document.createElement('button');
        repairButton.id = 'repair-db-btn';
        repairButton.className = 'btn btn-warning';
        repairButton.innerHTML = 'Repair Database';
        repairButton.title = 'Attempt to fix database issues by rebuilding it';
        repairButton.style.marginTop = '10px';

        // Add click listener
        repairButton.addEventListener('click', () => {
            this.repairDatabase();
        });

        // Add to container
        settingsContainer.appendChild(repairButton);
        console.log('Repair database button added to UI');
    }

    /**
     * Repair the database by rebuilding it from scratch
     */
    async repairDatabase() {
        if (!this.cacheManager || typeof this.cacheManager.recoverDatabase !== 'function') {
            this.ui.showError('Repair Failed', 'Database repair functionality not available');
            return;
        }

        // Show progress
        this.ui.showLoading('Repairing database...');

        try {
            // Attempt database recovery
            const success = await this.cacheManager.recoverDatabase();

            if (success) {
                this.ui.showMessage('Database successfully repaired', 'success', 5000);

                // Update cached tabs list
                await this.updateCachedTabsList();

                // Refresh storage info
                this.showStorageInfo();
            } else {
                this.ui.showError(
                    'Repair Failed',
                    'Could not repair database. Try reloading the extension or restarting your browser.',
                    () => {
                        // Offer to retry
                        this.repairDatabase();
                    }
                );
            }
        } catch (error) {
            console.error('Error repairing database:', error);
            this.ui.showError(
                'Repair Failed',
                `Error repairing database: ${error.message || 'Unknown error'}`,
                () => {
                    // Offer to retry
                    this.repairDatabase();
                }
            );
        }
    }

    /**
     * Start the process of loading all tab previews
     * @param {Array} tabsToLoad - Optional array of tabs to load, if not provided all capturable tabs will be used
     */
    async startLoadAllPreviews(tabsToLoad) {
        try {
            // Check if already loading
            if (this.loadAllInProgress) {
                console.warn('Already loading all previews');
                return;
            }

            // Set loading flag
            this.loadAllInProgress = true;
            this.cancelLoadAll = false;

            // Get capturable tabs
            let capturableTabs = tabsToLoad;

            if (!capturableTabs) {
                // If no tabs provided, get all current tabs
                const allTabs = await chrome.tabs.query({});

                // Get the extension tab ID if not already set
                if (!this.tabManager.extensionTabId) {
                    const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (currentTabs && currentTabs.length > 0) {
                        this.tabManager.extensionTabId = currentTabs[0].id;
                        console.log('Extension tab ID:', this.tabManager.extensionTabId);
                    }
                }

                // Simple filter approach: only keep tabs that are not the extension tab and have capturable URLs
                capturableTabs = allTabs.filter(tab => {
                    // Skip extension tab by ID
                    if (tab.id === this.tabManager.extensionTabId) {
                        return false;
                    }

                    // Skip chrome pages and other non-capturable URLs
                    if (!this.isCapturableUrl(tab.url)) {
                        return false;
                    }

                    return true;
                });

                console.log(`Found ${capturableTabs.length} capturable tabs out of ${allTabs.length} total tabs`);
            } else {
                // Filter provided tabs
                capturableTabs = capturableTabs.filter(tab =>
                    tab.id !== this.tabManager.extensionTabId &&
                    this.isCapturableUrl(tab.url)
                );
            }

            // Check if we have any tabs to capture
            if (capturableTabs.length === 0) {
                this.ui.showMessage('No capturable tabs found', 'warning');
                this.loadAllInProgress = false;
                return;
            }

            // Reset queue and counters
            this.loadAllQueue = [...capturableTabs];
            this.loadAllTotal = this.loadAllQueue.length;
            this.loadAllProcessed = 0;

            // Show loading message
            this.ui.showMessage(
                `Starting to load previews for ${this.loadAllTotal} tabs...`,
                'info'
            );

            // Add cancel button
            this.addCancelLoadAllButton();

            // Disable tab list during capturing to prevent interference
            if (this.tabManager) {
                this.tabManager.setCaptureInProgress(true);
            }

            // Start processing the queue
            await this.processLoadAllQueue();
        } catch (error) {
            console.error('Error starting load all previews:', error);
            this.ui.showError('Failed to load all previews: ' + error.message);
            this.loadAllInProgress = false;

            // Re-enable tab list
            if (this.tabManager) {
                this.tabManager.setCaptureInProgress(false);
            }

            // Make sure cancel button is removed
            this.removeCancelLoadAllButton();
        }
    }

    /**
     * Helper method to check if a tab belongs to this extension
     * @param {Object} tab - Tab to check
     * @returns {boolean} - Whether the tab belongs to this extension
     */
    isExtensionTab(tab) {
        if (!tab || !tab.url) return false;

        const url = tab.url;

        return (
            // Check by URL matching extension ID
            (url.includes('chrome-extension://') && url.includes(chrome.runtime.id)) ||
            // Check by extension page markers
            url.includes('/main.html') ||
            // Check by title (if available)
            (tab.title && (
                tab.title.includes('Declutter X GoFullPage') ||
                tab.title.includes('Tab Preview')
            ))
        );
    }

    /**
     * Add cancel button for Load All process
     */
    addCancelLoadAllButton() {
        // Remove existing button if any
        this.removeCancelLoadAllButton();

        // Create cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancel-load-all-btn';
        cancelBtn.className = 'btn btn-danger';
        cancelBtn.textContent = 'Cancel Loading';
        cancelBtn.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 1000;
            padding: 10px 15px;
            background-color: #f44336;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            transition: all 0.3s ease;
        `;

        // Add hover effect
        cancelBtn.addEventListener('mouseover', () => {
            cancelBtn.style.backgroundColor = '#d32f2f';
            cancelBtn.style.transform = 'scale(1.05)';
        });

        cancelBtn.addEventListener('mouseout', () => {
            cancelBtn.style.backgroundColor = '#f44336';
            cancelBtn.style.transform = 'scale(1)';
        });

        // Add click event with debounce
        let clickTimeout;
        cancelBtn.addEventListener('click', () => {
            // Clear any existing timeout
            if (clickTimeout) {
                clearTimeout(clickTimeout);
            }

            // Set new timeout
            clickTimeout = setTimeout(() => {
                this.cancelLoadAll = true;
                this.ui.showMessage('Cancelling preview generation...', 'info');

                // Disable the button to prevent multiple clicks
                cancelBtn.disabled = true;
                cancelBtn.style.opacity = '0.7';
                cancelBtn.style.cursor = 'not-allowed';
            }, 300); // 300ms debounce
        });

        // Add to body with a fade-in effect
        cancelBtn.style.opacity = '0';
        document.body.appendChild(cancelBtn);

        // Trigger fade-in
        requestAnimationFrame(() => {
            cancelBtn.style.opacity = '1';
        });

        // Store button reference for cleanup
        this.cancelLoadAllButton = cancelBtn;
    }

    /**
     * Remove cancel button with fade-out effect
     */
    removeCancelLoadAllButton() {
        const cancelBtn = this.cancelLoadAllButton || document.getElementById('cancel-load-all-btn');
        if (cancelBtn) {
            // Add fade-out effect
            cancelBtn.style.opacity = '0';
            cancelBtn.style.transition = 'opacity 0.3s ease';

            // Remove after fade-out
            setTimeout(() => {
                cancelBtn.remove();
                this.cancelLoadAllButton = null;
            }, 300);
        }
    }

    /**
     * Calculate adaptive delay based on tab properties and previous capture history
     * @param {Object} tab - Tab to calculate delay for
     * @returns {number} - Delay in milliseconds
     */
    calculateAdaptiveDelay(tab) {
        // Base delay
        let delay = 1500; // 1.5 seconds minimum between captures

        // Add delay based on processed tab count (gradually slow down for many tabs)
        delay += Math.min(this.loadAllProcessed * 50, 2000); // Up to 2 seconds more based on tab count

        // Check for complex domains
        if (tab.url) {
            const complexDomains = [
                'facebook.com', 'twitter.com', 'instagram.com',
                'youtube.com', 'reddit.com', 'linkedin.com',
                'amazon.com', 'ebay.com', 'github.com'
            ];

            for (const domain of complexDomains) {
                if (tab.url.includes(domain)) {
                    delay += 1000; // Add 1 second for complex pages
                    break;
                }
            }
        }

        // Random jitter to prevent exactly consistent timing
        delay += Math.random() * 500;

        return delay;
    }

    /**
     * Calculate an adaptive capture timeout based on tab characteristics
     * @param {Object} tab - The tab to capture
     * @returns {number} - Timeout in milliseconds
     */
    calculateCaptureTimeout(tab) {
        // Base timeout for average pages
        let timeout = 45000; // 45 seconds for average pages

        if (!tab || !tab.url) {
            return timeout;
        }

        const url = tab.url.toLowerCase();

        // Adjust timeout based on known complex domains
        const complexDomains = [
            'facebook.com', 'twitter.com', 'instagram.com',
            'youtube.com', 'reddit.com', 'linkedin.com',
            'amazon.com', 'ebay.com', 'walmart.com',
            'cnn.com', 'nytimes.com', 'bbc.com',
            'github.com', 'gitlab.com', 'stackoverflow.com'
        ];

        // Check if the URL contains any complex domain
        for (const domain of complexDomains) {
            if (url.includes(domain)) {
                timeout += 20000; // Add 20 seconds for complex sites
                break;
            }
        }

        // Add time for https (usually more complex than http)
        if (url.startsWith('https://')) {
            timeout += 5000;
        }

        // Add time for sites likely to have infinite scroll
        const infiniteScrollIndicators = [
            'feed', 'timeline', 'scroll', 'infinite',
            'news', 'forum', 'blog', 'post', 'article'
        ];

        for (const indicator of infiniteScrollIndicators) {
            if (url.includes(indicator)) {
                timeout += 10000; // Add 10 seconds for potential infinite scroll
                break;
            }
        }

        // Set reasonable upper bound
        return Math.min(timeout, 120000); // Max 2 minutes
    }

    /**
     * Process the Load All queue
     */
    async processLoadAllQueue() {
        try {
            // If queue is empty or cancelled, we're done
            if (this.loadAllQueue.length === 0 || this.cancelLoadAll) {
                if (this.cancelLoadAll) {
                    console.log('Load All process cancelled by user');
                    this.ui.showMessage('Preview generation cancelled', 'info');
                } else {
                    console.log('Load All queue is empty, process complete');
                    this.ui.showMessage('All previews generated successfully', 'success', 3000);
                }
                // Finish the load all process
                this.finishLoadAllProcess();
                return;
            }

            // Get next tab
            const tab = this.loadAllQueue.shift();
            this.loadAllProcessed++;

            // Update UI with progress
            const progressPercent = Math.round((this.loadAllProcessed / this.loadAllTotal) * 100);
            this.ui.showLoading(`Processing ${tab.title} (${this.loadAllProcessed}/${this.loadAllTotal} - ${progressPercent}%)`);
            console.log(`Processing tab ${this.loadAllProcessed}/${this.loadAllTotal}: ${tab.title}`);

            try {
                // Check if the URL is capturable
                if (!this.isCapturableUrl(tab.url)) {
                    console.log(`Skipping non-capturable tab: ${tab.url || 'unknown URL'}`);

                    // Add a small delay before processing next tab
                    await new Promise(resolve => setTimeout(resolve, 200));

                    await this.processLoadAllQueue();
                    return;
                }

                // Check if we already have a cached screenshot for this tab
                let cachedScreenshot = null;
                try {
                    cachedScreenshot = await this.cacheManager.getScreenshot(tab.id);
                } catch (cacheError) {
                    console.warn(`Error retrieving cache for tab ${tab.id}:`, cacheError);
                    // Continue with capture even if cache retrieval fails
                }

                if (cachedScreenshot) {
                    console.log(`Using cached preview for tab: ${tab.title}`);
                    // No need to capture again, process the next tab
                    await new Promise(resolve => setTimeout(resolve, 300));
                    await this.processLoadAllQueue();
                    return;
                }

                // Capture this tab
                try {
                    // Use adaptive delay to prevent rate limiting
                    const adaptiveDelay = this.calculateAdaptiveDelay(tab);
                    console.log(`Waiting ${adaptiveDelay / 1000} seconds before capturing tab ${tab.title}`);

                    // Show waiting message
                    this.ui.showMessage(`Waiting to capture ${tab.title}...`, 'info');

                    // Wait before capturing
                    await new Promise(resolve => setTimeout(resolve, adaptiveDelay));

                    // Capture the tab
                    await this.captureCurrentTab(tab);
                    console.log(`Successfully captured tab: ${tab.title}`);

                    // Significant delay between captures to avoid rate limiting
                    // Longer delay after successful capture
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (captureError) {
                    console.error(`Failed to capture tab ${tab.title}:`, captureError);
                    this.ui.showMessage(`Failed to capture ${tab.title}: ${captureError.message}`, 'error', 2000);
                    // Add shorter delay if capture failed
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                // Process next tab if not cancelled
                if (!this.cancelLoadAll) {
                    await this.processLoadAllQueue();
                } else {
                    this.finishLoadAllProcess();
                }
            } catch (processingError) {
                console.error(`Error processing tab ${tab.title}:`, processingError);
                // Continue with next tab despite errors
                await this.processLoadAllQueue();
            }
        } catch (error) {
            console.error('Error in processLoadAllQueue:', error);
            // Ensure we finish the process
            this.finishLoadAllProcess();
        }
    }

    /**
     * Check if a tab is capturable
     * @param {Object} tab - Tab to check
     * @returns {boolean} - Whether the tab can be captured
     */
    isTabCapturable(tab) {
        if (!tab || !tab.url) {
            return false;
        }

        const url = tab.url;

        // Comprehensive check for extension tab (multiple markers)
        const isExtensionTab = (
            // Check by URL matching extension ID
            (url.includes('chrome-extension://') && url.includes(chrome.runtime.id)) ||
            // Check by extension page markers
            url.includes('/main.html') ||
            // Check by title (if available)
            (tab.title && (
                tab.title.includes('Declutter X GoFullPage') ||
                tab.title.includes('Tab Preview')
            )) ||
            // Check for extension hostname
            (url.startsWith('chrome-extension://') &&
                !url.includes('/suspended.html') && // Exception for suspend extensions
                !url.includes('/viewer.html')) // Exception for PDF viewers
        );

        if (isExtensionTab) {
            console.log('Skipping extension tab:', tab.title, url);
            return false;
        }

        // Check for internal Chrome pages
        if (
            url.startsWith('chrome://') ||
            url.startsWith('about:') ||
            url.startsWith('data:') ||
            url.startsWith('file:') ||
            url.startsWith('view-source:') ||
            url.startsWith('devtools:')
        ) {
            console.log('Skipping non-capturable URL:', url);
            return false;
        }

        // Check for valid web protocols
        const hasValidProtocol = url.startsWith('http://') || url.startsWith('https://');
        if (!hasValidProtocol) {
            console.log('Skipping URL with invalid protocol:', url);
            return false;
        }

        return true;
    }

    /**
     * Capture the current tab directly
     * @param {Object} tab - Tab to capture
     */
    async captureCurrentTab(tab) {
        return new Promise((resolve, reject) => {
            // Mark capture as in progress
            this.captureInProgress = true;

            // Show loading state in UI
            this.ui.showLoading(`Capturing ${tab.title}...`);

            // Store current tab for retry purposes
            this.currentTabInfo = tab;

            // Calculate adaptive timeout based on complexity indicators
            const adaptiveTimeout = this.calculateCaptureTimeout(tab);
            console.log(`Using adaptive timeout of ${adaptiveTimeout / 1000} seconds for ${tab.title}`);

            // Set up listeners for the capture results
            const messageHandler = (message) => {
                if (!message || typeof message !== 'object') return;

                if (message.action === 'show_screenshots') {
                    // Success - we got screenshots
                    console.log('Received screenshots from background');
                    chrome.runtime.onMessage.removeListener(messageHandler);
                    this.handleScreenshotsReceived(message);
                    this.captureInProgress = false;
                    resolve();
                } else if (message.action === 'capture_error') {
                    // Error during capture
                    console.error('Capture error:', message.error);
                    chrome.runtime.onMessage.removeListener(messageHandler);
                    this.captureInProgress = false;
                    reject(new Error(message.error || 'Unknown capture error'));
                }
            };

            // Add temporary listener for this capture
            chrome.runtime.onMessage.addListener(messageHandler);

            // Send capture request to background script with adaptive parameters
            chrome.runtime.sendMessage(
                {
                    action: 'capture_tab',
                    tabId: tab.id,
                    captureParams: {
                        timeout: adaptiveTimeout,
                        scrollDelay: this.calculateScrollDelay(tab),
                        maxScrolls: 1000 // Allow more scrolls for very long pages
                    }
                },
                response => {
                    if (!response || !response.success) {
                        chrome.runtime.onMessage.removeListener(messageHandler);
                        this.captureInProgress = false;
                        reject(new Error(response?.error || 'Unknown capture error'));
                    }
                    // Don't resolve here - wait for the screenshots
                }
            );

            // Set timeout to avoid hanging forever, but use adaptive timeout
            setTimeout(() => {
                chrome.runtime.onMessage.removeListener(messageHandler);
                this.captureInProgress = false;
                reject(new Error('Capture timed out'));
            }, adaptiveTimeout + 5000); // Add 5 seconds buffer to the timeout
        });
    }

    /**
     * Calculate scroll delay based on tab characteristics
     * @param {Object} tab - The tab to capture
     * @returns {number} - Scroll delay in milliseconds
     */
    calculateScrollDelay(tab) {
        // Base delay for normal pages
        let delay = 100; // 100ms between scrolls

        if (!tab || !tab.url) {
            return delay;
        }

        const url = tab.url.toLowerCase();

        // Adjust delay for complex sites that need more time to load resources
        const complexSites = [
            'facebook.com', 'twitter.com', 'instagram.com',
            'youtube.com', 'reddit.com'
        ];

        for (const site of complexSites) {
            if (url.includes(site)) {
                delay += 100; // Additional 100ms delay for complex sites
                break;
            }
        }

        // Sites with lazy loading need more time between scrolls
        const lazyLoadIndicators = ['lazy', 'infinite', 'scroll'];
        for (const indicator of lazyLoadIndicators) {
            if (url.includes(indicator)) {
                delay += 50; // Add 50ms for lazy loading sites
                break;
            }
        }

        return delay;
    }

    /**
     * Update the tab list to show which tabs have cached previews
     * @returns {Promise<void>}
     */
    async updateCachedTabsList() {
        try {
            // Get all cached items
            const allItems = await this.cacheManager.getAllCacheItems();

            // Extract tab IDs from cache keys
            const cachedTabIds = new Set(
                Object.keys(allItems)
                    .filter(key => key.startsWith(this.cacheManager.CACHE_PREFIX))
                    .map(key => {
                        // Extract the tab ID from the cache key
                        const tabId = key.replace(this.cacheManager.CACHE_PREFIX, '');
                        return parseInt(tabId, 10);
                    })
                    .filter(tabId => !isNaN(tabId))
            );

            // Update the tab manager with cached tab IDs
            if (this.tabManager) {
                this.tabManager.updateCachedTabIds(cachedTabIds);
            }

            console.log(`Updated cached tabs list (${cachedTabIds.size} cached tabs)`);
        } catch (error) {
            console.error('Error updating cached tabs list:', error);
        }
    }

    /**
     * Clear the cached preview for a specific tab
     * @param {number} tabId - ID of the tab to clear cache for
     * @returns {Promise<boolean>} - Whether the operation was successful
     */
    async clearTabCache(tabId) {
        try {
            const result = await this.cacheManager.removeScreenshot(tabId);

            if (result) {
                console.log(`Cleared cache for tab ${tabId}`);

                // Update the UI to reflect the change
                await this.updateCachedTabsList();

                this.ui.showMessage('Preview cache cleared', 'info');
                return true;
            } else {
                console.log(`No cache found for tab ${tabId}`);
                return false;
            }
        } catch (error) {
            console.error(`Error clearing cache for tab ${tabId}:`, error);
            return false;
        }
    }

    /**
     * Clear all cached previews
     * @returns {Promise<void>}
     */
    async clearAllCache() {
        try {
            this.ui.showMessage('Clearing all cached previews...', 'info');

            const clearedCount = await this.cacheManager.clearAllCache();

            // Update the UI to reflect the change
            await this.updateCachedTabsList();

            this.ui.showMessage(`Cleared ${clearedCount} cached previews`, 'success');
        } catch (error) {
            console.error('Error clearing all cache:', error);
            this.ui.showMessage(`Error clearing cache: ${error.message}`, 'error');
        }
    }

    /**
     * Display storage info in the UI
     */
    showStorageInfo() {
        if (this.ui) {
            const storageType = 'IndexedDB';
            let statusMessage = `Using ${storageType} for screenshot cache`;

            // Add database status if available
            if (this.cacheManager && typeof this.cacheManager._dbReady !== 'undefined') {
                const dbStatus = this.cacheManager._dbReady ? 'ready' : 'not fully initialized';
                statusMessage += ` (Database: ${dbStatus})`;
            }

            this.ui.showMessage(statusMessage, 'info', 3000);
            console.log(statusMessage);
        }
    }

    /**
     * Set up event listeners for the application
     */
    setupEventListeners() {
        // Set up load all button
        const loadAllBtn = document.getElementById('load-all-btn');
        if (loadAllBtn) {
            loadAllBtn.addEventListener('click', () => {
                this.handleLoadAllClick();
            });
        }

        // Set up clear cache button
        const clearCacheBtn = document.getElementById('clear-cache-btn');
        if (clearCacheBtn) {
            clearCacheBtn.addEventListener('click', async () => {
                await this.handleClearCache();
            });
        }

        // Set up close preview button
        const closePreviewBtn = document.getElementById('close-preview');
        if (closePreviewBtn) {
            closePreviewBtn.addEventListener('click', () => {
                this.ui.hidePreview();
            });
        }

        // Listen for tab group updates
        window.addEventListener('tabGroupsUpdated', (event) => {
            // Update the tab list to reflect new group information
            if (this.tabManager) {
                this.tabManager.refreshTabs();
            }
            console.log('Tab groups updated:', event.detail);
        });

        // Listen for changes in chrome tabs to keep our persistent list updated
        chrome.tabs.onCreated.addListener(() => {
            if (this.tabManager) {
                this.tabManager.updateTabStatus();
            }
        });

        chrome.tabs.onRemoved.addListener(() => {
            if (this.tabManager) {
                this.tabManager.updateTabStatus();
            }
        });

        // Update when window focus changes to detect new tabs
        chrome.windows.onFocusChanged.addListener(() => {
            if (this.tabManager) {
                setTimeout(() => {
                    this.tabManager.updateTabStatus();
                }, 500);
            }
        });

        // Save workspace button
        const saveWorkspaceButton = document.getElementById('saveWorkspaceButton');
        if (saveWorkspaceButton) {
            saveWorkspaceButton.addEventListener('click', () => {
                this.showSaveWorkspaceDialog();
            });
        }

        // Listen for load workspace events
        document.addEventListener('loadWorkspace', (event) => {
            this.loadWorkspace(event.detail.workspaceId);
        });
        
        // Listen for duplicate workspace events
        document.addEventListener('duplicateWorkspace', (event) => {
            this.duplicateWorkspace(event.detail.workspaceId);
        });
        
        // Listen for toggleStarTab events
        document.addEventListener('toggleStarTab', (event) => {
            this.handleToggleStarTab(event.detail.tabId, event.detail.tabInfo);
        });
        
        // Listen for removeTab events
        document.addEventListener('removeTab', (event) => {
            this.handleRemoveTab(event.detail.tabId, event.detail.tabInfo);
        });

        // Listen for view workspace as current events
        document.addEventListener('viewWorkspaceAsCurrent', (event) => {
            this.viewWorkspaceAsCurrent(event.detail.workspaceId);
        });

        // Listen for close tabs actions
        document.addEventListener('closeAllTabs', () => {
            this.closeAllTabs();
        });

        document.addEventListener('closeTabsWithPreviews', () => {
            this.closeTabsWithPreviews();
        });

        document.addEventListener('removeClosedTabs', () => {
            this.removeClosedTabs();
        });

        document.addEventListener('undoClosedTabs', () => {
            this.undoClosedTabs();
        });

        // Listen for navigation between tabs
        document.addEventListener('navigatePreview', (event) => {
            const direction = event.detail.direction;
            const showFullscreen = event.detail.fullscreen || false;
            if (this.currentTabInfo) {
                this.navigateToAdjacentTab(this.currentTabInfo, direction, showFullscreen);
            }
        });

        // Listen for open all tabs in list event
        document.addEventListener('openAllTabsInList', () => {
            this.openAllTabsInList();
        });
    }

    /**
     * Handle the "Load All Previews" button click
     */
    handleLoadAllClick() {
        // If already loading, show message and return
        if (this.loadAllInProgress) {
            this.ui.showMessage('Already loading all previews, please wait...', 'warning', 3000);
            return;
        }

        // Get all open tabs (excluding the extension tab)
        const openTabs = this.tabManager.persistentTabs.filter(tab =>
            tab.isOpenInChrome &&
            tab.id !== this.tabManager.extensionTabId &&
            this.isCapturableUrl(tab.url)
        );

        // Check if we have any capturable tabs
        if (openTabs.length === 0) {
            this.ui.showMessage('No capturable tabs found. Try opening some new tabs first.', 'warning', 3000);
            return;
        }

        // Start loading all previews
        this.startLoadAllPreviews(openTabs);
    }

    /**
     * Handle Clear Cache button click
     */
    async handleClearCache() {
        // Show confirmation dialog
        if (confirm('Are you sure you want to clear all cached previews? This cannot be undone.')) {
            await this.clearAllCache();
        }
    }

    /**
     * Clean up and finish the Load All process
     */
    finishLoadAllProcess() {
        // Reset flags
        this.loadAllInProgress = false;
        this.cancelLoadAll = false;

        // Remove the cancel button
        this.removeCancelLoadAllButton();

        // Re-enable tab list
        if (this.tabManager) {
            this.tabManager.setCaptureInProgress(false);
        }

        console.log('Load All process finished');
    }

    /**
     * Show dialog to save current tabs as a workspace
     */
    async showSaveWorkspaceDialog() {
        try {
            const workspaceName = prompt('Enter a name for this workspace:', 'Workspace ' + new Date().toLocaleDateString());
            if (workspaceName) {
                await this.saveWorkspace(workspaceName);
            }
        } catch (error) {
            console.error('Error showing save workspace dialog:', error);
            this.ui.showError('Failed to save workspace', error.message);
        }
    }

    /**
     * Save current tabs as a workspace
     * @param {string} name - Workspace name
     */
    async saveWorkspace(name) {
        try {
            // Show loading message
            this.ui.showMessage('Saving workspace...', 'info');
            
            // Get current tabs list
            const tabs = this.tabManager.persistentTabs;
            
            // Create a simplified version of tabs (we don't need to save everything)
            const simplifiedTabs = tabs.map(tab => ({
                id: tab.id,
                title: tab.title,
                url: tab.url,
                favIconUrl: tab.favIconUrl,
                groupId: tab.groupId
            }));

            // Create workspace object
            const workspace = {
                id: Date.now().toString(),
                name: name,
                tabs: simplifiedTabs,
                createdAt: new Date().toISOString()
            };
            
            // Save workspace
            await this.workspaceManager.saveWorkspace(workspace);
            
            // Show success message
            this.ui.showMessage(`Workspace "${name}" saved successfully`, 'success', 3000);
            
            // Update sidebar
            this.sidebar.renderWorkspaces();
        } catch (error) {
            console.error('Error saving workspace:', error);
            this.ui.showError('Failed to save workspace', error.message);
        }
    }

    /**
     * Load a workspace by ID
     * @param {string} workspaceId - Workspace ID to load
     */
    async loadWorkspace(workspaceId) {
        try {
            // Get workspace
            const workspace = await this.workspaceManager.getWorkspace(workspaceId);
            if (!workspace) {
                throw new Error('Workspace not found');
            }
            
            // Show loading
            this.ui.showMessage(`Loading workspace "${workspace.name}"...`, 'info');
            
            // Track metrics for user feedback
            let openedCount = 0;
            let alreadyOpenCount = 0;
            
            // First check if any of these tabs already exist in our list
            const existingTabsByUrl = {};
            for (const tab of this.tabManager.persistentTabs) {
                if (tab.url) {
                    existingTabsByUrl[tab.url] = tab;
                }
            }
            
            // Open tabs from workspace
            for (const workspaceTab of workspace.tabs) {
                if (!workspaceTab.url) continue;
                
                // Check if this tab already exists in our list
                const existingTab = existingTabsByUrl[workspaceTab.url];
                
                if (existingTab) {
                    // Tab already exists, check if it's open in Chrome
                    if (!existingTab.isOpenInChrome) {
                        try {
                            // Open the tab in Chrome
                            const newTab = await chrome.tabs.create({ 
                                url: workspaceTab.url,
                                active: false // Open in background
                            });
                            
                            // Update the existing tab entry
                            existingTab.isOpenInChrome = true;
                            existingTab.id = newTab.id;
                            existingTab.windowId = newTab.windowId;
                            openedCount++;
                            
                            // Apply highlight effect to show the tab has been updated
                            setTimeout(() => {
                                const tabElement = document.querySelector(`.tab-item[data-id="${existingTab.id}"]`);
                                if (tabElement) {
                                    tabElement.classList.add('highlight-tab');
                                    setTimeout(() => {
                                        tabElement.classList.remove('highlight-tab');
                                    }, 2000);
                                }
                            }, 500);
                        } catch (error) {
                            console.error('Error opening tab:', error);
                        }
                    } else {
                        // Tab is already open in Chrome
                        alreadyOpenCount++;
                    }
                } else {
                    // Tab doesn't exist in our list, create it normally
                    try {
                        // Create the tab in Chrome
                        const newTab = await chrome.tabs.create({ 
                            url: workspaceTab.url,
                            active: false // Open in background
                        });
                        
                        // Create a new entry for our list with appropriate properties
                        const newTabInfo = {
                            ...workspaceTab,
                            id: newTab.id,
                            windowId: newTab.windowId,
                            isOpenInChrome: true,
                            title: workspaceTab.title || 'Loading...',
                            favIconUrl: workspaceTab.favIconUrl || ''
                        };
                        
                        // Add to our list
                        this.tabManager.persistentTabs.push(newTabInfo);
                        openedCount++;
                    } catch (error) {
                        console.error('Error opening tab:', error);
                    }
                }
                
                // Add a small delay between opening tabs to prevent browser overload
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // Update the UI
            this.tabManager.renderTabs();
            
            // Show success message with counts
            let message = `Workspace "${workspace.name}" loaded successfully.`;
            if (openedCount > 0) {
                message += ` Opened ${openedCount} tab(s)`;
            }
            if (alreadyOpenCount > 0) {
                message += ` (${alreadyOpenCount} tab(s) were already open)`;
            }
            
            this.ui.showMessage(message, 'success', 3000);
        } catch (error) {
            console.error('Error loading workspace:', error);
            this.ui.showError('Failed to load workspace', error.message);
        }
    }

    /**
     * Navigate to the adjacent tab (previous or next)
     * @param {Object} currentTab - The current tab
     * @param {string} direction - 'prev' or 'next'
     * @param {boolean} showFullscreen - Whether to show the tab in fullscreen mode
     */
    navigateToAdjacentTab(currentTab, direction, showFullscreen = false) {
        if (!this.tabManager) {
            this.ui.showMessage('Tab manager not initialized', 'error', 3000);
            return;
        }

        try {
            // Get tabs from tab manager - using persistentTabs to ensure we get all available tabs including closed ones
            const tabs = this.tabManager.persistentTabs || [];
            
            if (!tabs || tabs.length <= 1) {
                this.ui.showMessage('No other tabs to navigate to', 'info', 2000);
                return;
            }

            // Find the index of the current tab
            const currentIndex = tabs.findIndex(tab => tab.id === currentTab.id);
            if (currentIndex === -1) {
                console.warn('Current tab not found in the tabs list');
                // Try selecting the first tab as fallback
                if (tabs.length > 0) {
                    this.handleTabSelect(tabs[0]);
                    this.ui.showMessage('Selected first available tab', 'info', 2000);
                }
                return;
            }

            // Function to check if a tab has a preview (only navigate to tabs with previews)
            const hasPreview = (tab) => {
                return tab && 
                       this.isCapturableUrl(tab.url) && 
                       this.tabManager.cachedTabIds && 
                       this.tabManager.cachedTabIds.has(tab.id);
            };

            // Find the next/prev tab that has a preview
            let newIndex = currentIndex;
            let targetTab = null;
            let loopCount = 0;
            const maxLoops = tabs.length; // Prevent infinite loop

            while (loopCount < maxLoops) {
                // Calculate the new index based on direction
                if (direction === 'prev') {
                    newIndex = newIndex === 0 ? tabs.length - 1 : newIndex - 1;
                } else {
                    newIndex = newIndex === tabs.length - 1 ? 0 : newIndex + 1;
                }

                // Get the tab at the new index
                targetTab = tabs[newIndex];
                
                // Only consider tabs that already have previews generated
                if (hasPreview(targetTab)) {
                    break; // Found a tab with preview
                }
                
                loopCount++;
            }

            // If we did a full loop and couldn't find a tab with preview, or if the target tab is null
            if (loopCount >= maxLoops || !targetTab) {
                this.ui.showMessage('No tabs with previews found to navigate to', 'warning', 2000);
                return;
            }
            
            // Select the target tab
            console.log(`Navigating to ${direction} tab: ${targetTab.title}`);
            
            // First handle the tab selection normally
            this.handleTabSelect(targetTab);
            
            // If fullscreen mode is requested, open the preview in fullscreen after a short delay
            // The delay is needed to ensure the preview has been loaded before opening in fullscreen
            if (showFullscreen) {
                setTimeout(() => {
                    // Get the cached image URL for the target tab
                    this.cacheManager.getScreenshot(targetTab.id)
                        .then(cachedData => {
                            if (cachedData && cachedData.dataUrl) {
                                // Toggle fullscreen preview mode
                                this.ui.toggleFullscreenPreview(targetTab, cachedData.dataUrl);
                            } else if (this.currentScreenshot) {
                                // If for some reason we don't have cachedData but do have currentScreenshot
                                this.ui.toggleFullscreenPreview(targetTab, this.currentScreenshot);
                            }
                        })
                        .catch(err => {
                            console.error('Error getting cached screenshot for fullscreen:', err);
                            // If there's an error, try using currentScreenshot as fallback
                            if (this.currentScreenshot) {
                                this.ui.toggleFullscreenPreview(targetTab, this.currentScreenshot);
                            }
                        });
                }, 50); // Short delay to ensure cache is checked and UI updated
            }
            
            this.ui.showMessage(`Navigated to ${direction === 'prev' ? 'previous' : 'next'} tab: ${targetTab.title}`, 'info', 1500);
            
        } catch (error) {
            console.error('Error navigating to adjacent tab:', error);
            this.ui.showMessage('Failed to navigate to the next tab: ' + error.message, 'error', 3000);
        }
    }

    /**
     * View a workspace as the current one, saving the current workspace automatically if needed
     * @param {string} workspaceId - ID of the workspace to view as current
     * @param {Object} options - Additional options
     */
    async viewWorkspaceAsCurrent(workspaceId, options = {}) {
        try {
            // Extract options with defaults
            const { openTabs = false, addToCurrent = false } = 
                typeof workspaceId === 'object' && workspaceId.detail ? workspaceId.detail : options;
            
            // If workspaceId is an event object, extract the actual ID
            const actualWorkspaceId = typeof workspaceId === 'object' && workspaceId.detail 
                ? workspaceId.detail.workspaceId 
                : workspaceId;
            
            // Get the workspace to view
            const targetWorkspace = await this.workspaceManager.getWorkspace(actualWorkspaceId);
            if (!targetWorkspace) {
                throw new Error('Workspace not found');
            }
            
            // Check if we're already viewing this workspace
            const currentWorkspaceId = this.tabManager.currentWorkspaceId;
            if (currentWorkspaceId === actualWorkspaceId && !addToCurrent) {
                this.ui.showMessage(`Already viewing workspace: ${targetWorkspace.name}`, 'info', 3000);
                return;
            }
            
            // If addToCurrent is false (default behavior) and not already viewing this workspace
            if (!addToCurrent) {
                // First check if there are any open tabs that might need saving
                const currentTabs = await this.tabManager.getAllTabs();
                
                // Only save current workspace if:
                // 1. We have tabs to save AND
                // 2. We're not already viewing a saved workspace (prevent re-saving)
                if (currentTabs && currentTabs.length > 0 && !currentWorkspaceId) {
                    // Generate a default name for the current workspace
                    const defaultName = `Auto-saved workspace ${new Date().toLocaleString()}`;
                    
                    // Save the current workspace
                    await this.saveWorkspace(defaultName);
                    this.ui.showMessage(`Current tabs saved as "${defaultName}"`, 'info', 3000);
                }
                
                // Update the tab manager to display the workspace tabs in the list
                if (this.tabManager) {
                    // Create the array of tabs from the workspace
                    // Initially mark all as not open in Chrome - will update open status later if needed
                    const workspaceTabs = targetWorkspace.tabs.map(tab => ({
                        ...tab,
                        isOpenInChrome: false
                    }));
                    
                    // Replace the current list with the workspace tabs
                    this.tabManager.persistentTabs = workspaceTabs;
                    
                    // Set the current workspace ID to track that we're viewing a saved workspace
                    this.tabManager.currentWorkspaceId = actualWorkspaceId;
                    
                    // Show success message
                    this.ui.showMessage(`Now viewing workspace: ${targetWorkspace.name}`, 'success', 3000);
                    
                    // Highlight the current workspace in the sidebar
                    this.sidebar.highlightCurrentWorkspace(actualWorkspaceId);
                    
                    // If we need to open the tabs in Chrome, do it after setting up the view
                    if (openTabs && targetWorkspace.tabs.length > 0) {
                        // Show loading
                        this.ui.showMessage(`Opening tabs from workspace "${targetWorkspace.name}"...`, 'info', 3000);
                        
                        let openedCount = 0;
                        
                        // Open tabs from workspace
                        for (let i = 0; i < workspaceTabs.length; i++) {
                            if (workspaceTabs[i].url) {
                                try {
                                    // Create the tab in Chrome
                                    const newTab = await chrome.tabs.create({
                                        url: workspaceTabs[i].url,
                                        active: false // Open in background
                                    });
                                    
                                    // Update our internal reference
                                    workspaceTabs[i].isOpenInChrome = true;
                                    workspaceTabs[i].id = newTab.id;
                                    workspaceTabs[i].windowId = newTab.windowId;
                                    
                                    openedCount++;
                                    
                                    // Add a small delay between opening tabs
                                    await new Promise(resolve => setTimeout(resolve, 100));
                                } catch (tabError) {
                                    console.error('Error opening tab:', tabError);
                                }
                            }
                        }
                        
                        // Render the tabs after all have been opened and updated
                        this.tabManager.renderTabs();
                        
                        // Show success message
                        this.ui.showMessage(`Opened ${openedCount} tabs from workspace: ${targetWorkspace.name}`, 'success', 3000);
                    } else {
                        // If not opening tabs, just render the list
                        this.tabManager.renderTabs();
                    }
                }
            } else {
                // Add workspace tabs to current list without saving current workspace
                if (this.tabManager) {
                    // Create copies of the workspace tabs to add to current list
                    const tabsToAdd = targetWorkspace.tabs.map(tab => ({
                        ...tab,
                        isOpenInChrome: false // Mark as not open initially
                    }));
                    
                    // Add tabs to persistentTabs
                    this.tabManager.persistentTabs = [...this.tabManager.persistentTabs, ...tabsToAdd];
                    
                    // Refresh the tab list UI
                    this.tabManager.renderTabs();
                    
                    // Show success message
                    this.ui.showMessage(`Added ${tabsToAdd.length} tabs from workspace: ${targetWorkspace.name}`, 'success', 3000);
                }
            }
            
        } catch (error) {
            console.error('Error viewing workspace as current:', error);
            this.ui.showError('Failed to view workspace as current: ' + error.message);
        }
    }
    
    /**
     * Duplicate an existing workspace
     * @param {string} workspaceId - ID of the workspace to duplicate
     */
    async duplicateWorkspace(workspaceId) {
        try {
            // Get the workspace to duplicate
            const workspace = await this.workspaceManager.getWorkspace(workspaceId);
            if (!workspace) {
                throw new Error('Workspace not found');
            }
            
            // Create a new workspace object with a new ID and updated name
            const duplicatedWorkspace = {
                ...workspace,
                id: Date.now().toString(),
                name: `${workspace.name} (Copy)`,
                createdAt: new Date().toISOString()
            };
            
            // Save the duplicated workspace
            await this.workspaceManager.saveWorkspace(duplicatedWorkspace);
            
            // Show success message
            this.ui.showMessage(`Workspace "${workspace.name}" duplicated successfully`, 'success', 3000);
            
            // Update sidebar
            this.sidebar.renderWorkspaces();
            
        } catch (error) {
            console.error('Error duplicating workspace:', error);
            this.ui.showError('Failed to duplicate workspace: ' + error.message);
        }
    }

    /**
     * Close all tabs in the current window
     */
    closeAllTabs() {
        if (this.tabManager) {
            this.tabManager.handleCloseAllTabs();
        }
    }

    /**
     * Close all tabs that have previews generated
     */
    closeTabsWithPreviews() {
        if (this.tabManager) {
            this.tabManager.handleCloseTabsWithPreviews();
        }
    }

    /**
     * Remove all closed tabs from the list
     */
    removeClosedTabs() {
        if (this.tabManager) {
            this.tabManager.handleRemoveClosedTabs();
        }
    }

    /**
     * Restore recently closed tabs
     */
    undoClosedTabs() {
        if (this.tabManager) {
            this.tabManager.handleUndoClosedTabs();
        }
    }

    /**
     * Handle starring/unstarring a tab
     * @param {number} tabId - ID of the tab to toggle star status
     * @param {Object} tabInfo - Additional tab information
     */
    handleToggleStarTab(tabId, tabInfo) {
        if (!this.tabManager || !tabId) return;
        
        try {
            // Find the tab in the persistent tabs list
            const tab = this.tabManager.persistentTabs.find(tab => tab.id === tabId);
            if (!tab) {
                console.warn(`Tab with ID ${tabId} not found for starring in persistentTabs`);
                return;
            }
            
            // Toggle the starred status
            tab.isStarred = !tab.isStarred;
            
            // Update the tab element in the UI
            this.tabManager.updateTabElement(tab);
            
            console.log(`Tab ${tabId} (${tab.title}) ${tab.isStarred ? 'starred' : 'unstarred'}`);
            
            // If the workspace manager is available, update any workspaces containing this tab
            if (this.workspaceManager) {
                this.updateStarredTabInWorkspaces(tabId, tab.isStarred);
            }
        } catch (error) {
            console.error('Error toggling tab star status:', error);
            this.ui.showMessage('Failed to update tab starred status', 'error', 3000);
        }
    }
    
    /**
     * Update the starred status of a tab in all workspaces
     * @param {number} tabId - ID of the tab
     * @param {boolean} isStarred - New starred status
     */
    async updateStarredTabInWorkspaces(tabId, isStarred) {
        try {
            // Get all workspaces
            const workspaces = await this.workspaceManager.loadWorkspaces();
            let updatedCount = 0;
            
            // Loop through each workspace
            for (const workspace of workspaces) {
                let updated = false;
                
                // Check if the workspace contains the tab
                for (const tab of workspace.tabs) {
                    if (tab.id === tabId) {
                        tab.isStarred = isStarred;
                        updated = true;
                    }
                }
                
                // If the workspace was updated, save it
                if (updated) {
                    await this.workspaceManager.saveWorkspace(workspace);
                    updatedCount++;
                }
            }
            
            if (updatedCount > 0) {
                console.log(`Updated starred status in ${updatedCount} workspaces`);
            }
        } catch (error) {
            console.error('Error updating starred tabs in workspaces:', error);
        }
    }
    
    /**
     * Handle removing a tab
     * @param {number} tabId - ID of the tab to remove
     * @param {Object} tabInfo - Additional tab information
     */
    handleRemoveTab(tabId, tabInfo) {
        if (!this.tabManager || !tabId) return;
        
        try {
            // If tab is open in Chrome, close it
            if (tabInfo.isOpenInChrome) {
                chrome.tabs.remove(tabId).catch(error => {
                    console.warn(`Failed to close tab in Chrome: ${error.message}`);
                });
            }
            
            // Remove the tab from the persistent tabs list
            this.tabManager.removeTab(tabId);
            
            // Clear the cache for this tab
            if (this.cacheManager) {
                this.cacheManager.removeScreenshot(tabId).catch(error => {
                    console.warn(`Failed to clear tab cache: ${error.message}`);
                });
            }
            
            // Refresh the tab list
            this.tabManager.refreshTabs();
        } catch (error) {
            console.error('Error removing tab:', error);
            this.ui.showMessage('Failed to remove tab', 'error', 3000);
        }
    }
    
    /**
     * Clean up resources when the application is closed
     */
    dispose() {
        console.log('Disposing application resources...');
        
        // Clean up activity tracker
        if (this.activityTracker) {
            try {
                this.activityTracker.dispose();
                console.log('Activity tracker disposed');
            } catch (e) {
                console.warn('Error disposing activity tracker:', e);
            }
        }
        
        // Clean up smart cache manager
        if (this.cacheManager) {
            try {
                this.cacheManager.dispose();
                console.log('Cache manager disposed');
            } catch (e) {
                console.warn('Error disposing cache manager:', e);
            }
        }
    }

    /**
     * Open all tabs in the current list that aren't already open
     */
    async openAllTabsInList() {
        try {
            // Get all tabs that aren't already open in Chrome
            const closedTabs = this.tabManager.persistentTabs.filter(tab => !tab.isOpenInChrome);
            
            if (closedTabs.length === 0) {
                this.ui.showMessage('All tabs in the list are already open in Chrome.', 'info', 3000);
                return;
            }
            
            // Show loading message
            this.ui.showMessage(`Opening ${closedTabs.length} tabs...`, 'info', 3000);
            
            // Track how many tabs were successfully opened
            let openCount = 0;
            
            // Open tabs sequentially with slight delays to prevent browser overload
            for (const tab of closedTabs) {
                if (tab.url) {
                    try {
                        // Create the tab in Chrome
                        const newTab = await chrome.tabs.create({
                            url: tab.url,
                            active: false // Open in background
                        });
                        
                        // Update our internal tab information
                        tab.isOpenInChrome = true;
                        tab.id = newTab.id; // Update with new Chrome tab ID
                        tab.windowId = newTab.windowId;
                        
                        openCount++;
                        
                        // Small delay between opening tabs
                        await new Promise(resolve => setTimeout(resolve, 100));
                    } catch (tabError) {
                        console.error('Error opening tab:', tabError);
                    }
                }
            }
            
            // Update the tab list to reflect changes
            setTimeout(() => {
                this.tabManager.updateTabStatus();
                this.tabManager.renderTabs();
            }, 300);
            
            // Show success message
            this.ui.showMessage(`Successfully opened ${openCount} tab(s).`, 'success', 3000);
        } catch (error) {
            console.error('Error opening all tabs:', error);
            this.ui.showMessage('Error opening tabs: ' + error.message, 'error', 3000);
        }
    }
}

// Ensure initialization happens after DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    try {
        const app = new App();
        app.init().catch(error => {
            console.error('Initialization failed:', error);
            // Fallback error display
            alert('Extension could not be initialized. Please reload.');
        });
    } catch (instantiationError) {
        console.error('Failed to create App instance:', instantiationError);
        alert('Critical error: Extension could not start.');
    }
}); 

// Help Button Functionality
document.addEventListener('DOMContentLoaded', () => {
    const helpButton = document.getElementById('helpButton');
    
    if (helpButton) {
        helpButton.addEventListener('click', () => {
            // Create a new window/tab with the help popup
            chrome.tabs.create({
                url: chrome.runtime.getURL('html/help-popup.html')
            });
        });
    }
}); 