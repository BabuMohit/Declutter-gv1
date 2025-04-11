/**
 * Tab State Manager
 * Handles persisting tab state even after tabs are closed
 * Implements decoupling of previews from open tabs
 */

class TabStateManager {
    constructor() {
        this.DB_NAME = 'DeclutterXTab';
        this.TAB_STORE = 'tabMetadata';
        this.DB_VERSION = 1;
        this.db = null;
        this._dbReady = false;
        this._initPromise = null;
        this.tabMetadata = {}; // Store tab metadata keyed by tabId
        this.tabScreenshots = {}; // Store screenshot data keyed by tabId
        this.STORAGE_KEYS = {
            TAB_METADATA: 'declutter_tab_metadata',
            TAB_SCREENSHOTS: 'declutter_tab_screenshots',
            SETTINGS: 'declutter_settings',
            LAST_SYNC: 'declutter_last_sync'
        };
        this.MAX_STORAGE_SIZE = 1024 * 1024 * 10; // 10 MB default limit
        this.MAX_TABS = 100; // Default max tabs to store
    }

    /**
     * Initialize the tab state manager
     * @returns {Promise<boolean>} Whether initialization was successful
     */
    async init() {
        try {
            if (this._initPromise) {
                return this._initPromise;
            }

            this._initPromise = new Promise((resolve) => {
                // Check if IndexedDB is available
                if (!window.indexedDB) {
                    console.error('IndexedDB is not supported in this browser');
                    this._dbReady = false;
                    resolve(false);
                    return;
                }

                const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

                request.onerror = (event) => {
                    console.error('Error opening tab state database:', event.target.error);
                    this._dbReady = false;
                    resolve(false);
                };

                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    this._dbReady = true;
                    console.log('Tab state database initialized successfully');
                    resolve(true);
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    // Create tab metadata store if it doesn't exist
                    if (!db.objectStoreNames.contains(this.TAB_STORE)) {
                        const tabStore = db.createObjectStore(this.TAB_STORE, { keyPath: 'id' });

                        // Create indices for efficient querying
                        tabStore.createIndex('isOpen', 'isOpen', { unique: false });
                        tabStore.createIndex('capturedAt', 'capturedAt', { unique: false });
                        tabStore.createIndex('url', 'url', { unique: false });
                    }
                };
            });

            return this._initPromise;
        } catch (error) {
            console.error('Error initializing tab state manager:', error);
            this._dbReady = false;
            return false;
        }
    }

    /**
     * Store or update tab metadata
     * @param {Object} tabData - Tab data to store
     * @returns {Promise<boolean>} Whether operation was successful
     */
    async storeTabMetadata(tabData) {
        if (!this._dbReady || !this.db) {
            const initialized = await this.init();
            if (!initialized) {
                console.error('Failed to initialize database for storing tab metadata');
                return false;
            }
        }

        return new Promise((resolve) => {
            try {
                const transaction = this.db.transaction([this.TAB_STORE], 'readwrite');
                const store = transaction.objectStore(this.TAB_STORE);

                // Ensure required fields are present
                const sanitizedTabData = {
                    id: tabData.id.toString(), // Ensure ID is a string
                    url: tabData.url || '',
                    title: tabData.title || 'Untitled',
                    favIconUrl: tabData.favIconUrl || '',
                    isOpen: tabData.isOpen === undefined ? true : tabData.isOpen,
                    capturedAt: tabData.capturedAt || null,
                    previewId: tabData.previewId || null,
                    groupId: tabData.groupId || -1,
                    windowId: tabData.windowId || -1,
                    lastUpdated: Date.now()
                };

                const request = store.put(sanitizedTabData);

                request.onsuccess = () => {
                    resolve(true);
                };

                request.onerror = (event) => {
                    console.error('Error storing tab metadata:', event.target.error);
                    resolve(false);
                };
            } catch (error) {
                console.error('Exception storing tab metadata:', error);
                resolve(false);
            }
        });
    }

    /**
     * Get tab metadata by ID
     * @param {string} tabId - Tab ID to retrieve
     * @returns {Promise<Object|null>} Tab metadata or null if not found
     */
    async getTabMetadata(tabId) {
        if (!this._dbReady || !this.db) {
            const initialized = await this.init();
            if (!initialized) {
                console.error('Failed to initialize database for retrieving tab metadata');
                return null;
            }
        }

        return new Promise((resolve) => {
            try {
                const transaction = this.db.transaction([this.TAB_STORE], 'readonly');
                const store = transaction.objectStore(this.TAB_STORE);
                const request = store.get(tabId.toString());

                request.onsuccess = () => {
                    resolve(request.result || null);
                };

                request.onerror = (event) => {
                    console.error('Error retrieving tab metadata:', event.target.error);
                    resolve(null);
                };
            } catch (error) {
                console.error('Exception retrieving tab metadata:', error);
                resolve(null);
            }
        });
    }

    /**
     * Get all tab metadata
     * @param {Object} options - Query options
     * @param {boolean} options.onlyOpen - Get only open tabs
     * @param {boolean} options.onlyClosed - Get only closed tabs
     * @param {boolean} options.onlyWithPreview - Get only tabs with previews
     * @returns {Promise<Object>} Object with tabId keys and tab metadata values
     */
    async getAllTabMetadata(options = {}) {
        if (!this._dbReady || !this.db) {
            const initialized = await this.init();
            if (!initialized) {
                console.error('Failed to initialize database for retrieving all tab metadata');
                return {};
            }
        }

        return new Promise((resolve) => {
            try {
                const transaction = this.db.transaction([this.TAB_STORE], 'readonly');
                const store = transaction.objectStore(this.TAB_STORE);
                const request = store.getAll();

                request.onsuccess = () => {
                    const allTabs = request.result || [];
                    const result = {};

                    // Filter tabs based on options
                    for (const tab of allTabs) {
                        if (options.onlyOpen && !tab.isOpen) continue;
                        if (options.onlyClosed && tab.isOpen) continue;
                        if (options.onlyWithPreview && !tab.previewId) continue;

                        result[tab.id] = tab;
                    }

                    resolve(result);
                };

                request.onerror = (event) => {
                    console.error('Error retrieving all tab metadata:', event.target.error);
                    resolve({});
                };
            } catch (error) {
                console.error('Exception retrieving all tab metadata:', error);
                resolve({});
            }
        });
    }

    /**
     * Update tab open/closed status
     * @param {string} tabId - Tab ID to update
     * @param {boolean} isOpen - Whether tab is open
     * @returns {Promise<boolean>} Whether operation was successful
     */
    async updateTabStatus(tabId, isOpen) {
        const tabData = await this.getTabMetadata(tabId);
        if (!tabData) {
            return false;
        }

        tabData.isOpen = isOpen;
        tabData.lastUpdated = Date.now();

        return this.storeTabMetadata(tabData);
    }

    /**
     * Bulk update tabs that are closed
     * @param {Set<string>} openTabIds - Set of currently open tab IDs
     * @returns {Promise<number>} Number of tabs updated
     */
    async markClosedTabs(openTabIds) {
        const allTabs = await this.getAllTabMetadata({ onlyOpen: true });
        let updatedCount = 0;

        for (const tabId in allTabs) {
            if (!openTabIds.has(tabId)) {
                allTabs[tabId].isOpen = false;
                allTabs[tabId].lastUpdated = Date.now();
                await this.storeTabMetadata(allTabs[tabId]);
                updatedCount++;
            }
        }

        return updatedCount;
    }

    /**
     * Delete tab metadata
     * @param {string} tabId - Tab ID to delete
     * @returns {Promise<boolean>} Whether operation was successful
     */
    async deleteTabMetadata(tabId) {
        if (!this._dbReady || !this.db) {
            const initialized = await this.init();
            if (!initialized) {
                return false;
            }
        }

        return new Promise((resolve) => {
            try {
                const transaction = this.db.transaction([this.TAB_STORE], 'readwrite');
                const store = transaction.objectStore(this.TAB_STORE);
                const request = store.delete(tabId.toString());

                request.onsuccess = () => {
                    resolve(true);
                };

                request.onerror = (event) => {
                    console.error('Error deleting tab metadata:', event.target.error);
                    resolve(false);
                };
            } catch (error) {
                console.error('Exception deleting tab metadata:', error);
                resolve(false);
            }
        });
    }

    /**
     * Clear all tab metadata
     * @returns {Promise<boolean>} Whether operation was successful
     */
    async clearAllTabMetadata() {
        if (!this._dbReady || !this.db) {
            const initialized = await this.init();
            if (!initialized) {
                return false;
            }
        }

        return new Promise((resolve) => {
            try {
                const transaction = this.db.transaction([this.TAB_STORE], 'readwrite');
                const store = transaction.objectStore(this.TAB_STORE);
                const request = store.clear();

                request.onsuccess = () => {
                    resolve(true);
                };

                request.onerror = (event) => {
                    console.error('Error clearing tab metadata:', event.target.error);
                    resolve(false);
                };
            } catch (error) {
                console.error('Exception clearing tab metadata:', error);
                resolve(false);
            }
        });
    }

    /**
     * Initialize the manager
     * @returns {Promise<void>}
     */
    async initManager() {
        try {
            console.log('Initializing TabStateManager');
            // Load settings first to get storage limits
            await this.loadSettings();

            // Then load stored data
            await this.loadTabMetadata();

            console.log(`Initialized with ${Object.keys(this.tabMetadata).length} tabs in metadata`);
        } catch (error) {
            console.error('Error initializing TabStateManager:', error);
            throw error;
        }
    }

    /**
     * Load extension settings
     * @returns {Promise<void>}
     */
    async loadSettings() {
        try {
            const settings = await this.getStorageData(this.STORAGE_KEYS.SETTINGS) || {};
            if (settings.maxStorageSize) {
                this.MAX_STORAGE_SIZE = settings.maxStorageSize;
            }
            if (settings.maxTabs) {
                this.MAX_TABS = settings.maxTabs;
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    /**
     * Load saved tab metadata from storage
     * @returns {Promise<void>}
     */
    async loadTabMetadata() {
        try {
            const storedMetadata = await this.getStorageData(this.STORAGE_KEYS.TAB_METADATA);
            if (storedMetadata) {
                this.tabMetadata = storedMetadata;
            }
        } catch (error) {
            console.error('Error loading tab metadata:', error);
            this.tabMetadata = {};
        }
    }

    /**
     * Save the current tab metadata to storage
     * @returns {Promise<void>}
     */
    async saveTabMetadata() {
        try {
            await this.setStorageData(this.STORAGE_KEYS.TAB_METADATA, this.tabMetadata);
            await this.setStorageData(this.STORAGE_KEYS.LAST_SYNC, Date.now());
        } catch (error) {
            console.error('Error saving tab metadata:', error);
            throw error;
        }
    }

    /**
     * Get tab metadata for a specific tab
     * @param {string} tabId - The ID of the tab
     * @returns {Object|null} - The tab metadata or null if not found
     */
    getTabMetadata(tabId) {
        return this.tabMetadata[tabId] || null;
    }

    /**
     * Get all tab metadata
     * @param {string} filter - Optional filter ('all', 'open', 'closed', 'preview')
     * @returns {Object} - Map of tab ID to tab metadata
     */
    getAllTabMetadata(filter = 'all') {
        if (filter === 'all') {
            return this.tabMetadata;
        }

        // Create a filtered copy of the metadata
        const filteredMetadata = {};
        for (const [tabId, metadata] of Object.entries(this.tabMetadata)) {
            if (filter === 'open' && metadata.isOpen) {
                filteredMetadata[tabId] = metadata;
            } else if (filter === 'closed' && !metadata.isOpen) {
                filteredMetadata[tabId] = metadata;
            } else if (filter === 'preview' && metadata.isPreview) {
                filteredMetadata[tabId] = metadata;
            }
        }
        return filteredMetadata;
    }

    /**
     * Add or update a tab's metadata
     * @param {string} tabId - The ID of the tab
     * @param {Object} metadata - The tab metadata
     * @returns {Promise<void>}
     */
    async updateTabMetadata(tabId, metadata) {
        // Ensure the tab ID is a string
        const id = String(tabId);

        // Merge with existing metadata or create new
        this.tabMetadata[id] = {
            ...(this.tabMetadata[id] || {}),
            ...metadata,
            lastUpdated: Date.now()
        };

        // Ensure required fields
        if (!this.tabMetadata[id].isOpen) {
            this.tabMetadata[id].isOpen = false;
        }

        // Auto-save
        await this.saveTabMetadata();
    }

    /**
     * Mark a tab as open
     * @param {string} tabId - The ID of the tab
     * @param {boolean} isOpen - Whether the tab is open
     * @returns {Promise<void>}
     */
    async setTabOpenState(tabId, isOpen) {
        // Ensure the tab ID is a string
        const id = String(tabId);

        // Skip if no change or tab doesn't exist
        if (!this.tabMetadata[id]) {
            return;
        }

        // Update the open state
        this.tabMetadata[id].isOpen = isOpen;
        this.tabMetadata[id].lastUpdated = Date.now();

        // Auto-save
        await this.saveTabMetadata();
    }

    /**
     * Mark a tab as a preview (not associated with a real browser tab)
     * @param {string} tabId - The ID of the tab
     * @param {boolean} isPreview - Whether the tab is a preview
     * @returns {Promise<void>}
     */
    async setTabPreviewState(tabId, isPreview) {
        // Ensure the tab ID is a string
        const id = String(tabId);

        // Skip if no change or tab doesn't exist
        if (!this.tabMetadata[id]) {
            return;
        }

        // Update the preview state
        this.tabMetadata[id].isPreview = isPreview;
        this.tabMetadata[id].lastUpdated = Date.now();

        // Auto-save
        await this.saveTabMetadata();
    }

    /**
     * Remove a tab and its associated data
     * @param {string} tabId - The ID of the tab to remove
     * @returns {Promise<void>}
     */
    async removeTab(tabId) {
        // Ensure the tab ID is a string
        const id = String(tabId);

        // Skip if tab doesn't exist
        if (!this.tabMetadata[id]) {
            return;
        }

        // Remove tab metadata
        delete this.tabMetadata[id];

        // Remove screenshot if exists
        if (this.tabScreenshots[id]) {
            delete this.tabScreenshots[id];
            // Save screenshot storage
            try {
                await this.setStorageData(this.STORAGE_KEYS.TAB_SCREENSHOTS, this.tabScreenshots);
            } catch (error) {
                console.error('Error removing screenshot from storage:', error);
            }
        }

        // Save metadata
        await this.saveTabMetadata();
    }

    /**
     * Get a tab's screenshot data
     * @param {string} tabId - The ID of the tab
     * @returns {Promise<string|null>} The screenshot data (data URL) or null if not found
     */
    async getTabScreenshot(tabId) {
        // Ensure the tab ID is a string
        const id = String(tabId);

        // Check memory cache first
        if (this.tabScreenshots[id]) {
            return this.tabScreenshots[id];
        }

        // Otherwise try to load from storage
        try {
            const screenshots = await this.getStorageData(this.STORAGE_KEYS.TAB_SCREENSHOTS) || {};
            if (screenshots[id]) {
                // Update the memory cache
                this.tabScreenshots[id] = screenshots[id];
                return screenshots[id];
            }
        } catch (error) {
            console.error('Error getting tab screenshot:', error);
        }

        return null;
    }

    /**
     * Save a tab's screenshot data
     * @param {string} tabId - The ID of the tab
     * @param {string} screenshotData - The screenshot data (data URL)
     * @returns {Promise<void>}
     */
    async saveTabScreenshot(tabId, screenshotData) {
        // Ensure the tab ID is a string
        const id = String(tabId);

        // Update memory cache
        this.tabScreenshots[id] = screenshotData;

        // Load existing screenshots
        let screenshots;
        try {
            screenshots = await this.getStorageData(this.STORAGE_KEYS.TAB_SCREENSHOTS) || {};
        } catch (error) {
            console.error('Error loading existing screenshots:', error);
            screenshots = {};
        }

        // Add the new screenshot
        screenshots[id] = screenshotData;

        // Check total size
        if (await this.calculateStorageSize(screenshots) > this.MAX_STORAGE_SIZE) {
            // Over limit, need to prune old screenshots
            await this.pruneScreenshots(screenshots);
        }

        // Save to storage
        try {
            await this.setStorageData(this.STORAGE_KEYS.TAB_SCREENSHOTS, screenshots);
            await this.setStorageData(this.STORAGE_KEYS.LAST_SYNC, Date.now());
        } catch (error) {
            console.error('Error saving tab screenshot:', error);
            throw error;
        }
    }

    /**
     * Prune old screenshots to fit within storage limits
     * @param {Object} screenshots - The screenshot data object
     * @returns {Promise<Object>} The pruned object
     */
    async pruneScreenshots(screenshots) {
        // Get tab metadata for sorting
        const metadata = this.tabMetadata;

        // Convert to array for sorting
        const screenshotEntries = Object.entries(screenshots);

        // Sort by last accessed time (least recent first)
        screenshotEntries.sort((a, b) => {
            const tabA = metadata[a[0]];
            const tabB = metadata[b[0]];

            // Tabs without metadata get pruned first
            if (!tabA) return -1;
            if (!tabB) return 1;

            // Then sort by last updated
            return (tabA.lastUpdated || 0) - (tabB.lastUpdated || 0);
        });

        // Calculate current size
        let totalSize = await this.calculateStorageSize(screenshots);

        // Remove oldest screenshots until under size limit
        while (totalSize > this.MAX_STORAGE_SIZE && screenshotEntries.length > 0) {
            const [tabId, screenshot] = screenshotEntries.shift();
            // Calculate screenshot size
            const screenshotSize = (screenshot.length * 3) / 4; // Approximate size of base64 data
            totalSize -= screenshotSize;
            delete screenshots[tabId];

            console.log(`Pruned screenshot for tab ${tabId} to save space`);
        }

        // Make sure we update our memory cache
        this.tabScreenshots = { ...screenshots };

        return screenshots;
    }

    /**
     * Calculate the approximate size of an object in storage
     * @param {Object} obj - The object to calculate size for
     * @returns {Promise<number>} Approximate size in bytes
     */
    async calculateStorageSize(obj) {
        if (!obj) return 0;
        return new Blob([JSON.stringify(obj)]).size;
    }

    /**
     * Cleans up tabs that are no longer relevant
     * @returns {Promise<void>}
     */
    async cleanupOldTabs() {
        // Convert to array for filtering
        const tabEntries = Object.entries(this.tabMetadata);

        // Keep track of removed count
        let removedCount = 0;

        // If we're over the limit, remove oldest tabs
        if (tabEntries.length > this.MAX_TABS) {
            // Sort by last updated (oldest first)
            tabEntries.sort((a, b) => {
                return (a[1].lastUpdated || 0) - (b[1].lastUpdated || 0);
            });

            // Calculate how many to remove
            const removeCount = tabEntries.length - this.MAX_TABS;

            // Remove oldest tabs
            for (let i = 0; i < removeCount; i++) {
                const [tabId] = tabEntries[i];
                await this.removeTab(tabId);
                removedCount++;
            }
        }

        // Also remove tabs older than 30 days
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

        for (const [tabId, metadata] of Object.entries(this.tabMetadata)) {
            // Skip tabs marked as important
            if (metadata.important) continue;

            // Remove tabs without a lastUpdated or ones too old
            if (!metadata.lastUpdated || metadata.lastUpdated < thirtyDaysAgo) {
                await this.removeTab(tabId);
                removedCount++;
            }
        }

        return removedCount;
    }

    /**
     * Check if a tab is open (has an actual browser tab)
     * @param {string} tabId - The ID of the tab to check
     * @returns {boolean} Whether the tab is open
     */
    isTabOpen(tabId) {
        const id = String(tabId);
        return this.tabMetadata[id]?.isOpen || false;
    }

    /**
     * Check if a tab is a preview-only (not linked to actual browser tab)
     * @param {string} tabId - The ID of the tab to check
     * @returns {boolean} Whether the tab is a preview
     */
    isTabPreview(tabId) {
        const id = String(tabId);
        return this.tabMetadata[id]?.isPreview || false;
    }

    /**
     * Get tab counts by type
     * @returns {Object} Counts for different tab types
     */
    getTabCounts() {
        let total = 0;
        let open = 0;
        let closed = 0;
        let preview = 0;

        for (const metadata of Object.values(this.tabMetadata)) {
            total++;
            if (metadata.isOpen) open++;
            if (!metadata.isOpen) closed++;
            if (metadata.isPreview) preview++;
        }

        return { total, open, closed, preview };
    }

    /**
     * Sync with Chrome's current tabs
     * @param {Array} chromeTabs - Current Chrome tabs from chrome.tabs.query
     * @returns {Promise<Object>} Results of the sync operation
     */
    async syncWithChromeTabs(chromeTabs) {
        const results = {
            added: 0,
            updated: 0,
            closed: 0,
            total: chromeTabs.length
        };

        // Create a set of current Chrome tab IDs for quick lookup
        const chromeTabIds = new Set(chromeTabs.map(tab => String(tab.id)));

        // Mark tabs that are no longer open
        for (const [tabId, metadata] of Object.entries(this.tabMetadata)) {
            // Skip if this tab is already marked as closed or is a preview
            if (!metadata.isOpen || metadata.isPreview) continue;

            // If tab is in our metadata as open but not in Chrome's current tabs
            if (!chromeTabIds.has(tabId)) {
                await this.setTabOpenState(tabId, false);
                results.closed++;
            }
        }

        // Update or add tabs from Chrome
        for (const tab of chromeTabs) {
            const tabId = String(tab.id);

            // Skip special or extension tabs
            if (tab.url.startsWith('chrome:') || tab.url.startsWith('chrome-extension:')) {
                continue;
            }

            const existingTab = this.tabMetadata[tabId];

            if (existingTab) {
                // Update existing tab
                await this.updateTabMetadata(tabId, {
                    title: tab.title,
                    url: tab.url,
                    favIconUrl: tab.favIconUrl,
                    windowId: tab.windowId,
                    isOpen: true,
                    isActive: tab.active,
                    index: tab.index,
                    pinned: tab.pinned,
                    groupId: tab.groupId || -1,
                    lastUpdated: Date.now()
                });
                results.updated++;
            } else {
                // Add new tab
                await this.updateTabMetadata(tabId, {
                    title: tab.title,
                    url: tab.url,
                    favIconUrl: tab.favIconUrl,
                    windowId: tab.windowId,
                    isOpen: true,
                    isPreview: false,
                    isActive: tab.active,
                    index: tab.index,
                    pinned: tab.pinned,
                    groupId: tab.groupId || -1,
                    createdAt: Date.now(),
                    lastUpdated: Date.now()
                });
                results.added++;
            }
        }

        // Save all changes
        await this.saveTabMetadata();

        // Run cleanup after sync
        await this.cleanupOldTabs();

        return results;
    }

    /**
     * Get data from storage
     * @param {string} key - The storage key
     * @returns {Promise<any>} The data from storage
     */
    async getStorageData(key) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(key, (result) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(result[key]);
                }
            });
        });
    }

    /**
     * Set data in storage
     * @param {string} key - The storage key
     * @param {any} data - The data to store
     * @returns {Promise<void>}
     */
    async setStorageData(key, data) {
        return new Promise((resolve, reject) => {
            const item = {};
            item[key] = data;

            chrome.storage.local.set(item, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
    }
}

export default TabStateManager; 