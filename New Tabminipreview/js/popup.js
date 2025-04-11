import TabManager from './tab-manager.js';
import TabGroupManager from './tab-group-manager.js';
import ClosedTabTracker from './closed-tab-tracker.js';
import PageCapture from './page-capture.js';
import TabPreview from './tab-preview.js';
import Settings from './settings.js';
import ActivityTracker from './activity-tracker.js';

// Initialize managers
const activityTracker = new ActivityTracker();
// Pass ActivityTracker during TabManager construction
const tabManager = new TabManager(activityTracker);
const tabGroupManager = new TabGroupManager();
const closedTabTracker = new ClosedTabTracker();
const pageCapture = new PageCapture();
const tabPreview = new TabPreview();
const settings = new Settings();

// DOM Elements
let tabContainer;
let previewContainer;
let refreshButton;
let closeTabsButton;
let closeAllTabsButton;
let closeAndRetainButton;
let undoButton;
let settingsButton;

// Initialize the popup
async function init() {
    // Get DOM elements
    tabContainer = document.getElementById('tabList');
    previewContainer = document.getElementById('previewContainer');
    refreshButton = document.getElementById('refreshButton');
    closeTabsButton = document.getElementById('closeTabsButton');
    closeAllTabsButton = document.getElementById('closeAllTabs');
    closeAndRetainButton = document.getElementById('closeAndRetain');
    undoButton = document.getElementById('undoButton');
    settingsButton = document.getElementById('settingsButton');

    // Initialize managers
    await activityTracker.init();
    // Don't pass activityTracker again as it's already set during construction
    await tabManager.init(tabContainer, handleTabSelect);
    await tabGroupManager.init();
    await closedTabTracker.init(tabManager.extensionTabId);
    await pageCapture.init();
    await tabPreview.init(previewContainer);
    await settings.init();

    // Set up event listeners
    setupEventListeners();

    // Load initial state
    await loadInitialState();
}

// Set up event listeners
function setupEventListeners() {
    // Refresh button
    refreshButton.addEventListener('click', () => {
        tabManager.refreshTabs();
    });

    // Close tabs buttons
    closeAllTabsButton.addEventListener('click', async () => {
        await closedTabTracker.closeAllTabs(false);
    });

    closeAndRetainButton.addEventListener('click', async () => {
        await closedTabTracker.closeAllTabs(true);
    });

    // Undo button
    undoButton.addEventListener('click', async () => {
        await closedTabTracker.reopenAllTabs();
    });

    // Settings button
    settingsButton.addEventListener('click', () => {
        settings.show();
    });

    // Listen for closed tabs updates
    window.addEventListener('closedTabsUpdated', (event) => {
        const { closedTabs } = event.detail;
        updateUndoButton(closedTabs.length > 0);
    });
}

// Update undo button visibility
function updateUndoButton(hasClosedTabs) {
    if (undoButton) {
        undoButton.classList.toggle('visible', hasClosedTabs);
    }
}

// Handle tab selection
async function handleTabSelect(tab) {
    if (!tab) return;

    try {
        // Show loading state
        previewContainer.innerHTML = '<div class="loading">Loading preview...</div>';

        // Capture the page
        const captureResult = await pageCapture.captureTab(tab.id);

        if (captureResult.success) {
            // Display the preview
            await tabPreview.displayPreview(captureResult.dataUrl);
        } else {
            // Show error message
            previewContainer.innerHTML = `<div class="error">Failed to capture preview: ${captureResult.error}</div>`;
        }
    } catch (error) {
        console.error('Error capturing preview:', error);
        previewContainer.innerHTML = '<div class="error">Failed to capture preview</div>';
    }
}

// Load initial state
async function loadInitialState() {
    try {
        // Load settings
        await settings.loadSettings();

        // Load initial tabs
        await tabManager.refreshTabs();

        // Update undo button state
        const closedTabs = closedTabTracker.getClosedTabs();
        updateUndoButton(closedTabs.length > 0);
    } catch (error) {
        console.error('Error loading initial state:', error);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init); 