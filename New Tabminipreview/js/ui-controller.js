/**
 * UI Controller Module
 * Handles the extension's user interface elements and interactions
 */

class UIController {
    constructor() {
        this.previewContainer = null;
        this.progressContainer = null;
        this.progressBar = null;
        this.progressText = null;
        this.errorContainer = null;
        this.messageContainer = null;
        this.screenshotUrls = new Set(); // Track created URLs for cleanup
        this.messageTimeout = null;
    }

    /**
     * Initialize the UI controller
     * @param {Object} selectors - Object with element selectors
     */
    init(selectors) {
        // Store elements
        this.previewContainer = document.querySelector(selectors.previewContainer);
        this.progressContainer = document.querySelector(selectors.progressContainer);
        this.progressBar = document.querySelector(selectors.progressBar);
        this.progressText = document.querySelector(selectors.progressText);
        this.errorContainer = document.querySelector(selectors.errorContainer);

        // Create message container if it doesn't exist
        this.createMessageContainer();

        // Set up action buttons
        this.setupButtons();

        // Initialize UI state
        this.resetPreview();

        // Set up window events for cleanup
        window.addEventListener('beforeunload', () => {
            this.cleanupScreenshotUrls();
        });
    }

    /**
     * Create a message container for temporary messages
     */
    createMessageContainer() {
        if (!this.messageContainer) {
            this.messageContainer = document.createElement('div');
            this.messageContainer.className = 'message-container';
            this.messageContainer.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                max-width: 400px;
                background-color: rgba(33, 150, 243, 0.9);
                color: white;
                padding: 10px 15px;
                border-radius: 4px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                z-index: 1000;
                font-size: 14px;
                transition: opacity 0.3s ease;
                display: none;
            `;
            document.body.appendChild(this.messageContainer);
        }
    }

    /**
     * Set up event listeners for UI buttons
     */
    setupButtons() {
        // Close preview button
        const closeBtn = document.querySelector('#close-preview');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hidePreview();
            });
        }

        // Download button (if available)
        const downloadBtn = document.querySelector('#download-screenshot');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                this.downloadCurrentPreview();
            });
        }
    }

    /**
     * Show capture progress
     * @param {number} percent - Percentage complete (0-100)
     * @param {string} message - Optional status message
     */
    showProgress(percent, message = '') {
        if (!this.progressContainer || !this.progressBar) {
            return;
        }

        // Show progress container
        this.progressContainer.style.display = 'block';

        // Update progress bar
        this.progressBar.style.width = `${percent}%`;
        this.progressBar.setAttribute('aria-valuenow', percent);

        // Update message if provided
        if (message && this.progressText) {
            this.progressText.textContent = message;
        }

        // If progress is 100%, hide progress after a delay
        if (percent >= 100) {
            setTimeout(() => {
                this.hideProgress();
            }, 1500);
        }
    }

    /**
     * Hide the progress indicator
     */
    hideProgress() {
        if (this.progressContainer) {
            this.progressContainer.style.display = 'none';
        }
    }

    /**
     * Show an error message
     * @param {string} titleOrMessage - Error title or complete error message
     * @param {string} message - Error message (optional)
     * @param {Function} retryCallback - Optional callback for retry button
     */
    showError(titleOrMessage, message, retryCallback = null) {
        if (!this.errorContainer) {
            return;
        }

        // Hide any existing message
        this.hideMessage();

        // Reset previous content
        this.errorContainer.innerHTML = '';
        this.errorContainer.style.display = 'block';

        // Handle case where only message is provided
        let errorTitle, errorMessage;

        if (message && typeof message === 'string') {
            // Both title and message provided
            errorTitle = titleOrMessage;
            errorMessage = message;
        } else if (typeof titleOrMessage === 'string') {
            // Only message provided, use "Error" as title
            errorTitle = 'Error';
            errorMessage = titleOrMessage;

            // If third param is actually the retry callback when called with single message
            if (message && typeof message === 'function' && !retryCallback) {
                retryCallback = message;
            }
        } else {
            // Fallback for unexpected input
            errorTitle = 'Error';
            errorMessage = 'An unknown error occurred';
        }

        // Create error elements
        const titleElement = document.createElement('h3');
        titleElement.textContent = errorTitle;

        const messageElement = document.createElement('p');
        messageElement.textContent = errorMessage;

        this.errorContainer.appendChild(titleElement);
        this.errorContainer.appendChild(messageElement);

        // Add retry button if callback provided
        if (retryCallback && typeof retryCallback === 'function') {
            const retryButton = document.createElement('button');
            retryButton.className = 'btn btn-primary';
            retryButton.textContent = 'Retry';
            retryButton.addEventListener('click', retryCallback);

            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'error-actions';
            buttonContainer.appendChild(retryButton);

            this.errorContainer.appendChild(buttonContainer);
        }
    }

    /**
     * Hide any displayed error
     */
    hideError() {
        if (this.errorContainer) {
            this.errorContainer.style.display = 'none';
        }
    }

    /**
     * Clear any displayed error (alias for hideError)
     */
    clearError() {
        this.hideError();
    }

    /**
     * Show a temporary message toast
     * @param {string} message - Message to display
     * @param {string|number} typeOrDuration - Message type ('info', 'warning', 'error', 'success') or duration in ms
     * @param {number} duration - Duration to show in ms (default 5000ms)
     */
    showMessage(message, typeOrDuration = 'info', duration = 5000) {
        if (!this.messageContainer) {
            this.createMessageContainer();
        }

        // Clear any existing timeout
        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }

        // Handle legacy call style where second param was duration
        let type = 'info';
        if (typeof typeOrDuration === 'number') {
            duration = typeOrDuration;
        } else if (typeof typeOrDuration === 'string') {
            type = typeOrDuration;
        }

        // Apply appropriate styling based on message type
        this.messageContainer.className = 'message-container';
        this.messageContainer.classList.add(`message-${type}`);

        // Set message content
        this.messageContainer.textContent = message;
        this.messageContainer.style.display = 'block';
        this.messageContainer.style.opacity = '1';

        // Hide after duration
        this.messageTimeout = setTimeout(() => {
            this.hideMessage();
        }, duration);
    }

    /**
     * Hide the message toast
     */
    hideMessage() {
        if (this.messageContainer) {
            this.messageContainer.style.opacity = '0';
            setTimeout(() => {
                this.messageContainer.style.display = 'none';
            }, 300);
        }

        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }
    }

    /**
     * Reset the preview area
     */
    resetPreview() {
        if (this.previewContainer) {
            this.previewContainer.innerHTML = '<div class="empty-preview">Click on a tab to capture a screenshot</div>';
        }

        this.hideProgress();
        this.hideError();
        this.hideMessage();
        this.cleanupScreenshotUrls();
    }

    /**
     * Show a loading state in the preview area
     * @param {string} message - Loading message
     * @param {string} type - Message type ('info', 'warning', 'error', 'success')
     */
    showLoading(message = 'Preparing to capture...', type = 'info') {
        if (!this.previewContainer) {
            return;
        }

        // Hide any existing errors or messages
        this.hideError();

        // Determine spinner color based on type
        let spinnerClass = 'spinner';
        if (type === 'warning') spinnerClass += ' spinner-warning';
        if (type === 'error') spinnerClass += ' spinner-error';
        if (type === 'success') spinnerClass += ' spinner-success';

        this.previewContainer.innerHTML = `
            <div class="loading-container">
                <div class="${spinnerClass}"></div>
                <div class="loading-message ${type}">${message}</div>
            </div>
        `;
    }

    /**
     * Show a screenshot in the preview area
     * @param {string} imageUrl - URL of the screenshot to display
     * @param {Object} tabInfo - Information about the source tab
     * @param {function} refreshCallback - Optional callback for refreshing the screenshot
     */
    showScreenshot(imageUrl, tabInfo, refreshCallback = null) {
        if (!this.previewContainer) {
            return;
        }

        // Track URL for cleanup
        this.screenshotUrls.add(imageUrl);

        // Create preview container
        this.previewContainer.innerHTML = `
            <div class="preview-header">
                <div class="tab-info">
                    <img class="tab-favicon" src="${tabInfo.favIconUrl || 'icons/default-favicon.png'}" alt="">
                    <span class="tab-title">${tabInfo.title || 'Untitled Tab'}</span>
                    ${tabInfo.id && tabInfo.isOpenInChrome ? `<button id="switch-to-tab" class="btn btn-switch-tab" title="Switch to this tab in Chrome"><span class="icon-open-tab"></span></button>` : ''}
                </div>
                <div class="preview-actions">
                    <div class="zoom-controls">
                        <button id="zoom-out" class="btn btn-icon zoom-btn" title="Zoom Out">-</button>
                        <span id="zoom-level">100%</span>
                        <button id="zoom-in" class="btn btn-icon zoom-btn" title="Zoom In">+</button>
                        <button id="expand-preview" class="btn btn-icon expand-btn" title="Full Screen Preview">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
                            </svg>
                        </button>
                    </div>
                    <button id="close-tabs-dropdown-preview" class="btn btn-danger btn-sm" title="Close Tabs">Close Tabs</button>
                    ${refreshCallback ? '<button id="refresh-screenshot" class="btn btn-refresh" title="Refresh Preview"><span class="icon-refresh"></span> Refresh</button>' : ''}
                    <button id="download-screenshot" class="btn btn-download" title="Download Screenshot">
                        <span class="icon-download"></span>
                    </button>
                </div>
            </div>
            <div class="pdf-viewer-container">
                <div class="screenshot-container">
                    <img class="screenshot-image" src="${imageUrl}" alt="Full page screenshot">
                </div>
                <div class="preview-nav-arrow prev" title="Previous Tab">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                </div>
                <div class="preview-nav-arrow next" title="Next Tab">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </div>
            </div>
        `;

        // Set up download button
        const downloadBtn = document.querySelector('#download-screenshot');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                this.downloadScreenshot(imageUrl, tabInfo);
            });
        }

        // Set up zoom functionality
        let currentZoom = 100;
        const zoomStep = 10;
        const minZoom = 50;
        const maxZoom = 200;
        
        const updateZoom = (newZoom) => {
            const screenshotImage = document.querySelector('.screenshot-image');
            const zoomLevel = document.getElementById('zoom-level');
            const screenshotContainer = document.querySelector('.screenshot-container');
            
            if (screenshotImage && zoomLevel) {
                currentZoom = newZoom;
                screenshotImage.style.width = `${currentZoom}%`;
                zoomLevel.textContent = `${currentZoom}%`;
                
                // Enable/disable horizontal scrolling based on zoom level
                if (currentZoom > 100) {
                    screenshotContainer.style.overflowX = 'auto';
                } else {
                    screenshotContainer.style.overflowX = 'hidden';
                }
            }
        };
        
        const zoomIn = document.getElementById('zoom-in');
        if (zoomIn) {
            zoomIn.addEventListener('click', () => {
                if (currentZoom < maxZoom) {
                    updateZoom(currentZoom + zoomStep);
                }
            });
        }
        
        const zoomOut = document.getElementById('zoom-out');
        if (zoomOut) {
            zoomOut.addEventListener('click', () => {
                if (currentZoom > minZoom) {
                    updateZoom(currentZoom - zoomStep);
                }
            });
        }
        
        // Set up expand button for fullscreen preview
        const expandBtn = document.getElementById('expand-preview');
        if (expandBtn) {
            expandBtn.addEventListener('click', () => {
                this.toggleFullscreenPreview(tabInfo, imageUrl);
            });
        }
        
        // Initial zoom setup
        updateZoom(100);

        // Add refresh functionality if callback provided
        if (refreshCallback) {
            const refreshBtn = document.querySelector('#refresh-screenshot');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', refreshCallback);
            }
        }

        // Close tabs dropdown setup
        const closeTabsDropdown = document.querySelector('#close-tabs-dropdown-preview');
        if (closeTabsDropdown) {
            closeTabsDropdown.addEventListener('click', (e) => {
                this.createCloseTabsDropdownInPreview(e.target);
            });
        }

        // Switch to tab functionality
        const switchToTabBtn = document.querySelector('#switch-to-tab');
        if (switchToTabBtn && tabInfo.id) {
            switchToTabBtn.addEventListener('click', () => {
                chrome.tabs.update(tabInfo.id, { active: true });
            });
        }

        // Set up navigation arrows
        const prevArrow = document.querySelector('.preview-nav-arrow.prev');
        const nextArrow = document.querySelector('.preview-nav-arrow.next');
        
        if (prevArrow) {
            prevArrow.addEventListener('click', () => {
                document.dispatchEvent(new CustomEvent('navigatePreview', { detail: { direction: 'prev' } }));
            });
        }
        
        if (nextArrow) {
            nextArrow.addEventListener('click', () => {
                document.dispatchEvent(new CustomEvent('navigatePreview', { detail: { direction: 'next' } }));
            });
        }

        // Hide loading indicators
        this.hideProgress();
        this.hideError();
    }

    /**
     * Toggle fullscreen preview for a screenshot
     * @param {Object} tabInfo - Tab information
     * @param {string|Blob|Object} imageUrl - URL of the image to show, can be a string URL, Blob object, or an object with dataUrl property
     */
    toggleFullscreenPreview(tabInfo, imageUrl) {
        // Remove any existing fullscreen previews
        const existingPreview = document.querySelector('.fullscreen-preview');
        if (existingPreview) {
            existingPreview.remove();
        }
        
        // Check if we should exit fullscreen (toggle off)
        if (document.body.classList.contains('no-scroll') && existingPreview) {
            document.body.classList.remove('no-scroll');
            return;
        }
        
        // Handle different image URL formats
        let finalImageUrl = '';
        if (typeof imageUrl === 'string') {
            finalImageUrl = imageUrl;
        } else if (imageUrl instanceof Blob) {
            // Create an object URL for the Blob
            finalImageUrl = URL.createObjectURL(imageUrl);
            this.screenshotUrls.add(finalImageUrl); // Track for cleanup
        } else if (imageUrl && typeof imageUrl === 'object') {
            // If it's an object from cache, it might have a dataUrl property
            if (imageUrl.dataUrl) {
                finalImageUrl = imageUrl.dataUrl;
            } else if (imageUrl.screenshot) {
                finalImageUrl = imageUrl.screenshot;
            }
        }
        
        // Check if we have a valid image URL
        if (!finalImageUrl) {
            console.error('No valid image URL for fullscreen preview:', imageUrl);
            this.showMessage('Could not display fullscreen preview', 'error', 3000);
            return;
        }
        
        // Check if tab has a starred status
        const isStarred = tabInfo.isStarred || false;
        
        // Create fullscreen container
        const fullscreenPreview = document.createElement('div');
        fullscreenPreview.className = 'fullscreen-preview';
        fullscreenPreview.innerHTML = `
            <div class="fullscreen-header">
                <div class="tab-info">
                    <img class="tab-favicon" src="${tabInfo.favIconUrl || 'icons/default-favicon.png'}" alt="">
                    <span class="tab-title">${tabInfo.title || 'Untitled Tab'}</span>
                </div>
                <div class="fullscreen-actions">
                    <button class="btn star-tab-btn" title="${isStarred ? 'Unstar Tab' : 'Star Tab'}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="${isStarred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                    </button>
                    <button class="btn remove-tab-btn" title="Remove Tab">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18"></path>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                    <button class="btn close-fullscreen" title="Exit Fullscreen">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 6L6 18"></path>
                            <path d="M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="fullscreen-content">
                <div class="preview-nav-arrow prev" title="Previous Tab">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                </div>
                <div class="fullscreen-image-container">
                    <img src="${finalImageUrl}" alt="Full page screenshot">
                </div>
                <div class="preview-nav-arrow next" title="Next Tab">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </div>
            </div>
        `;
        
        // Add to document
        document.body.appendChild(fullscreenPreview);
        document.body.classList.add('no-scroll'); // Prevent scrolling the main page
        
        // Close button functionality
        const closeBtn = fullscreenPreview.querySelector('.close-fullscreen');
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(fullscreenPreview);
            document.body.classList.remove('no-scroll');
        });
        
        // Star button functionality
        const starBtn = fullscreenPreview.querySelector('.star-tab-btn');
        starBtn.addEventListener('click', () => {
            // Toggle star status and get the new state
            const newIsStarred = this.toggleStarTab(tabInfo);
            
            // Update star button appearance immediately
            starBtn.title = newIsStarred ? 'Unstar Tab' : 'Star Tab';
            starBtn.querySelector('svg').setAttribute('fill', newIsStarred ? 'currentColor' : 'none');
        });
        
        // Remove tab button functionality
        const removeBtn = fullscreenPreview.querySelector('.remove-tab-btn');
        removeBtn.addEventListener('click', () => {
            this.showRemoveTabConfirmation(tabInfo, fullscreenPreview);
        });
        
        // Set up navigation arrows
        const prevArrow = fullscreenPreview.querySelector('.preview-nav-arrow.prev');
        const nextArrow = fullscreenPreview.querySelector('.preview-nav-arrow.next');
        
        if (prevArrow) {
            prevArrow.addEventListener('click', () => {
                document.dispatchEvent(new CustomEvent('navigatePreview', { detail: { direction: 'prev', fullscreen: true } }));
                // Close the current fullscreen preview - it will be reopened by the next tab
                document.body.removeChild(fullscreenPreview);
                document.body.classList.remove('no-scroll');
            });
        }
        
        if (nextArrow) {
            nextArrow.addEventListener('click', () => {
                document.dispatchEvent(new CustomEvent('navigatePreview', { detail: { direction: 'next', fullscreen: true } }));
                // Close the current fullscreen preview - it will be reopened by the next tab
                document.body.removeChild(fullscreenPreview);
                document.body.classList.remove('no-scroll');
            });
        }
        
        // Add keyboard navigation
        const keyHandler = (e) => {
            // Handle escape key to exit fullscreen
            if (e.key === 'Escape') {
                if (document.querySelector('.fullscreen-preview')) {
                    document.body.removeChild(fullscreenPreview);
                    document.body.classList.remove('no-scroll');
                    document.removeEventListener('keydown', keyHandler);
                }
            }
        };
        
        document.addEventListener('keydown', keyHandler);
    }
    
    /**
     * Toggle starred status of a tab
     * @param {Object} tabInfo - The tab to toggle star status
     */
    toggleStarTab(tabInfo) {
        // Store the current starred state before toggling
        const currentStarredState = tabInfo.isStarred || false;
        
        // Create a custom event to handle starring a tab
        const event = new CustomEvent('toggleStarTab', { 
            detail: { 
                tabId: tabInfo.id,
                tabInfo: tabInfo
            } 
        });
        document.dispatchEvent(event);
        
        // Update the tab info for UI updates
        tabInfo.isStarred = !currentStarredState;
        
        // Show a message to the user
        const message = tabInfo.isStarred 
            ? `Tab "${tabInfo.title}" has been starred` 
            : `Tab "${tabInfo.title}" has been unstarred`;
            
        this.showMessage(message, 'success', 2000);
        
        // Return the new state in case caller needs it
        return tabInfo.isStarred;
    }
    
    /**
     * Show confirmation dialog for removing a tab
     * @param {Object} tabInfo - The tab to remove
     * @param {HTMLElement} fullscreenPreview - The fullscreen preview element
     */
    showRemoveTabConfirmation(tabInfo, fullscreenPreview) {
        // Create confirmation dialog
        const confirmationDialog = document.createElement('div');
        confirmationDialog.className = 'confirmation-dialog';
        confirmationDialog.innerHTML = `
            <h3>Remove Tab</h3>
            <p>Are you sure you want to remove "${tabInfo.title}" from the tab list?</p>
            <p>This will also close the tab in Chrome if it's currently open.</p>
            <div class="dialog-buttons">
                <button class="btn btn-secondary cancel-btn">Cancel</button>
                <button class="btn btn-danger confirm-btn">Remove Tab</button>
            </div>
        `;
        
        // Add dialog to the fullscreen preview
        fullscreenPreview.querySelector('.fullscreen-content').appendChild(confirmationDialog);
        
        // Add event listeners
        const cancelBtn = confirmationDialog.querySelector('.cancel-btn');
        const confirmBtn = confirmationDialog.querySelector('.confirm-btn');
        
        cancelBtn.addEventListener('click', () => {
            confirmationDialog.remove();
        });
        
        confirmBtn.addEventListener('click', () => {
            // Remove the tab
            this.removeTab(tabInfo);
            
            // Close the fullscreen preview
            document.body.removeChild(fullscreenPreview);
            document.body.classList.remove('no-scroll');
        });
    }
    
    /**
     * Remove a tab from the list and close it in Chrome if open
     * @param {Object} tabInfo - The tab to remove
     */
    removeTab(tabInfo) {
        // Create a custom event to handle removing a tab
        const event = new CustomEvent('removeTab', { 
            detail: { 
                tabId: tabInfo.id,
                tabInfo: tabInfo
            } 
        });
        document.dispatchEvent(event);
        
        // Show a message to the user
        this.showMessage(`Tab "${tabInfo.title}" has been removed`, 'info', 2000);
    }

    /**
     * Create Close tabs dropdown in the preview section
     * @param {HTMLElement} button - The button to attach the dropdown to
     */
    createCloseTabsDropdownInPreview(button) {
        // Check if dropdown already exists to avoid duplicates
        const existingDropdown = this.previewContainer.querySelector('.dropdown-menu');
        if (existingDropdown) {
            existingDropdown.remove();
        }

        // Create dropdown menu
        const dropdownMenu = document.createElement('div');
        dropdownMenu.className = 'dropdown-menu';
        dropdownMenu.style.display = 'none';

        // Add menu items
        const closeAllItem = document.createElement('button');
        closeAllItem.className = 'dropdown-menu-item';
        closeAllItem.textContent = 'Close all tabs in window';
        closeAllItem.addEventListener('click', (e) => {
            e.stopPropagation(); // Stop event from bubbling
            dropdownMenu.style.display = 'none'; // Hide dropdown
            // Dispatch a custom event that tab-manager can listen for
            document.dispatchEvent(new CustomEvent('closeAllTabs'));
        }, { once: true }); // Use once option to ensure it only triggers once

        const closeWithPreviewItem = document.createElement('button');
        closeWithPreviewItem.className = 'dropdown-menu-item danger';
        closeWithPreviewItem.textContent = 'Close tabs with previews';
        closeWithPreviewItem.addEventListener('click', (e) => {
            e.stopPropagation(); // Stop event from bubbling
            dropdownMenu.style.display = 'none'; // Hide dropdown
            // Dispatch a custom event that tab-manager can listen for
            document.dispatchEvent(new CustomEvent('closeTabsWithPreviews'));
        }, { once: true }); // Use once option to ensure it only triggers once

        const removeClosedTabsItem = document.createElement('button');
        removeClosedTabsItem.className = 'dropdown-menu-item';
        removeClosedTabsItem.textContent = 'Remove closed tabs from list';
        removeClosedTabsItem.addEventListener('click', (e) => {
            e.stopPropagation(); // Stop event from bubbling
            dropdownMenu.style.display = 'none'; // Hide dropdown
            // Dispatch a custom event that tab-manager can listen for
            document.dispatchEvent(new CustomEvent('removeClosedTabs'));
        }, { once: true }); // Use once option to ensure it only triggers once

        const undoCloseItem = document.createElement('button');
        undoCloseItem.className = 'dropdown-menu-item';
        undoCloseItem.textContent = 'Undo closed tabs';
        undoCloseItem.addEventListener('click', (e) => {
            e.stopPropagation(); // Stop event from bubbling
            dropdownMenu.style.display = 'none'; // Hide dropdown
            // Dispatch a custom event that tab-manager can listen for
            document.dispatchEvent(new CustomEvent('undoClosedTabs'));
        }, { once: true }); // Use once option to ensure it only triggers once

        const openAllTabsItem = document.createElement('button');
        openAllTabsItem.className = 'dropdown-menu-item';
        openAllTabsItem.textContent = 'Open all tabs in list';
        openAllTabsItem.addEventListener('click', (e) => {
            e.stopPropagation(); // Stop event from bubbling
            dropdownMenu.style.display = 'none'; // Hide dropdown
            // Dispatch a custom event that main.js can listen for
            document.dispatchEvent(new CustomEvent('openAllTabsInList'));
        }, { once: true });

        // Add items to menu
        dropdownMenu.appendChild(closeAllItem);
        dropdownMenu.appendChild(closeWithPreviewItem);
        dropdownMenu.appendChild(removeClosedTabsItem);
        dropdownMenu.appendChild(undoCloseItem);
        dropdownMenu.appendChild(openAllTabsItem);

        // Add menu to document
        document.body.appendChild(dropdownMenu);

        // Toggle dropdown when button is clicked
        button.addEventListener('click', (e) => {
            e.stopPropagation();

            // Position the dropdown under the button
            const buttonRect = button.getBoundingClientRect();
            dropdownMenu.style.position = 'absolute';
            dropdownMenu.style.top = `${buttonRect.bottom + 5}px`;
            dropdownMenu.style.right = `${window.innerWidth - buttonRect.right}px`;

            // Toggle visibility
            const isVisible = dropdownMenu.style.display === 'block';
            dropdownMenu.style.display = isVisible ? 'none' : 'block';
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            dropdownMenu.style.display = 'none';
        });
    }

    /**
     * Hide the preview
     */
    hidePreview() {
        this.resetPreview();
    }

    /**
     * Download the current screenshot
     * @param {string} imageUrl - URL of the screenshot to download
     * @param {Object} tabInfo - Information about the source tab
     */
    downloadScreenshot(imageUrl, tabInfo) {
        try {
            // Create a download link
            const downloadLink = document.createElement('a');
            downloadLink.href = imageUrl;

            // Generate filename from the page title
            let filename = `screenshot-${new Date().toISOString().split('T')[0]}`;
            if (tabInfo && tabInfo.title) {
                // Clean the title for use in a filename
                const cleanTitle = tabInfo.title
                    .replace(/[\\/:*?"<>|]/g, '_') // Remove invalid filename chars
                    .replace(/\s+/g, '_') // Replace spaces with underscores
                    .substring(0, 100); // Limit length

                filename = `${cleanTitle}-${filename}`;
            }

            // Set download attributes
            downloadLink.download = `${filename}.png`;
            downloadLink.style.display = 'none';

            // Add to document, click, and remove
            document.body.appendChild(downloadLink);
            downloadLink.click();

            // Show success message
            this.showMessage('Screenshot downloaded successfully!', 3000);

            // Cleanup
            setTimeout(() => {
                if (downloadLink.parentNode) {
                    downloadLink.parentNode.removeChild(downloadLink);
                }
            }, 100);
        } catch (error) {
            console.error('Error downloading screenshot:', error);
            this.showError('Download Failed', 'Could not download the screenshot: ' + error.message);
        }
    }

    /**
     * Clean up screenshot URLs to prevent memory leaks
     */
    cleanupScreenshotUrls() {
        this.screenshotUrls.forEach(url => {
            try {
                URL.revokeObjectURL(url);
            } catch (error) {
                console.warn('Error revoking URL:', error);
            }
        });
        this.screenshotUrls.clear();
    }
}

// Export the module
export default UIController; 