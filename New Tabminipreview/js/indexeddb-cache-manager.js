/**
 * IndexedDB Cache Manager for Screenshot Previews
 * Handles storing and retrieving screenshots using IndexedDB
 */

class IndexedDBCacheManager {
    constructor() {
        this.CACHE_PREFIX = 'tab_preview_'; // Keep same prefix for compatibility
        this.CACHE_EXPIRY = 30 * 60 * 1000; // 30 minutes in milliseconds
        this.MAX_CACHE_ITEMS = 50; // Maximum number of items to keep in cache

        this.DB_NAME = 'TabPreviewCache';
        this.STORE_NAME = 'screenshots';
        this.DB_VERSION = 2; // Increment version to ensure clean upgrade

        this.db = null;
        this._initPromise = null;
        this._dbReady = false;
        this._initRetryCount = 0;
        this.MAX_INIT_RETRIES = 3;
    }

    /**
     * Initialize the cache manager
     * @returns {Promise<void>}
     */
    async init() {
        try {
            // Check if IndexedDB is available
            if (!this.isIndexedDBAvailable()) {
                console.warn('IndexedDB is not available in this browser/context');
                // We'll continue to run but operations will fail gracefully
                return false;
            }

            // Try normal initialization first
            await this._initOrRecreateDatabase();
            console.log('IndexedDB cache manager initialized');

            // Only attempt migration if database init was successful
            if (this._dbReady) {
                try {
                    // Migrate data from chrome.storage.local if available
                    await this._migrateFromChromeStorage();

                    // Clean expired cache entries on startup
                    await this.cleanExpiredCache();
                } catch (postInitError) {
                    console.error('Error in post-initialization operations:', postInitError);
                    // Continue despite these errors
                }
            } else {
                // If initialization failed, try recovery as a last resort
                console.warn('Database initialization was not successful, attempting recovery...');
                return await this.recoverDatabase();
            }

            return this._dbReady;
        } catch (error) {
            console.error('Error initializing IndexedDB cache manager:', error);

            // Try recovery as a last resort
            console.warn('Attempting database recovery after initialization error...');
            return await this.recoverDatabase();
        }
    }

    /**
     * Initialize the database or recreate it if needed
     * @private
     * @returns {Promise<boolean>}
     */
    async _initOrRecreateDatabase() {
        try {
            // Try normal initialization first
            await this._initDatabase();

            // Verify database has the correct structure
            if (!this.db || !this.db.objectStoreNames.contains(this.STORE_NAME)) {
                console.warn('Database structure invalid, recreating...');
                await this._recreateDatabase();
            } else {
                this._dbReady = true;
            }

            return this._dbReady;
        } catch (error) {
            console.error('Database initialization failed:', error);

            // If we haven't exceeded retry count, try recreating
            if (this._initRetryCount < this.MAX_INIT_RETRIES) {
                this._initRetryCount++;
                console.warn(`Retrying database creation (${this._initRetryCount}/${this.MAX_INIT_RETRIES})...`);
                return this._recreateDatabase();
            } else {
                console.error('Max database initialization retries exceeded');
                this._dbReady = false;
                return false;
            }
        }
    }

    /**
     * Recreate the database from scratch
     * @private
     * @returns {Promise<boolean>}
     */
    async _recreateDatabase() {
        try {
            // Close any existing connection
            if (this.db) {
                this.db.close();
                this.db = null;
            }

            // Reset initialization promise
            this._initPromise = null;

            // Delete the database
            await new Promise((resolve, reject) => {
                const deleteRequest = indexedDB.deleteDatabase(this.DB_NAME);
                deleteRequest.onsuccess = () => resolve();
                deleteRequest.onerror = () => reject(new Error('Failed to delete database'));
                // Handle blocked state (when there are other connections)
                deleteRequest.onblocked = () => {
                    console.warn('Database deletion blocked, waiting...');
                    // Continue anyway after a short delay
                    setTimeout(resolve, 1000);
                };
            });

            // Reinitialize with a clean slate
            await this._initDatabase();

            // Verify store exists
            this._dbReady = !!(this.db && this.db.objectStoreNames.contains(this.STORE_NAME));

            return this._dbReady;
        } catch (error) {
            console.error('Failed to recreate database:', error);
            this._dbReady = false;
            return false;
        }
    }

    /**
     * Initialize the IndexedDB database
     * @private
     * @returns {Promise<IDBDatabase>}
     */
    async _initDatabase() {
        // Only initialize once per operation
        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = new Promise((resolve, reject) => {
            try {
                // Open database with explicit version number
                const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

                // Handle database upgrade or creation
                request.onupgradeneeded = (event) => {
                    try {
                        const db = event.target.result;
                        console.log(`Database upgrade needed: ${event.oldVersion} to ${event.newVersion}`);

                        // If the store exists, delete it to ensure clean schema
                        if (db.objectStoreNames.contains(this.STORE_NAME)) {
                            db.deleteObjectStore(this.STORE_NAME);
                        }

                        // Create fresh object store
                        const store = db.createObjectStore(this.STORE_NAME, {
                            keyPath: 'tabId',
                            autoIncrement: false
                        });

                        // Create timestamp index for expiration queries
                        store.createIndex('timestamp', 'metadata.timestamp', { unique: false });
                        console.log('Object store created successfully');
                    } catch (upgradeError) {
                        console.error('Error during database upgrade:', upgradeError);
                        // Will be caught in the onerror handler
                        throw upgradeError;
                    }
                };

                // Handle successful database open
                request.onsuccess = (event) => {
                    try {
                        this.db = event.target.result;

                        // Enhanced error handling for database operations
                        this.db.onerror = (error) => {
                            console.error('IndexedDB database error:', error);
                        };

                        // Handle unexpected database closure
                        this.db.onclose = () => {
                            console.warn('Database connection unexpectedly closed');
                            this.db = null;
                            this._dbReady = false;
                            this._initPromise = null;
                        };

                        // Handle version change (from another tab/window)
                        this.db.onversionchange = () => {
                            console.warn('Database version changed in another tab, closing connection');
                            if (this.db) {
                                this.db.close();
                                this.db = null;
                                this._dbReady = false;
                                this._initPromise = null;
                            }
                        };

                        // Verify store exists
                        if (!this.db.objectStoreNames.contains(this.STORE_NAME)) {
                            reject(new Error('Object store not created properly'));
                            return;
                        }

                        // Success!
                        this._dbReady = true;
                        resolve(this.db);
                    } catch (successError) {
                        console.error('Error in onsuccess handler:', successError);
                        reject(successError);
                    }
                };

                // Handle database open error
                request.onerror = (event) => {
                    console.error('Error opening IndexedDB:', event.target.error);
                    reject(event.target.error);
                };

                // Handle blocked state
                request.onblocked = (event) => {
                    console.warn('Database opening blocked, another connection may be open');
                    // Still try to continue
                    setTimeout(() => {
                        if (this.db) {
                            resolve(this.db);
                        } else {
                            reject(new Error('Database opening blocked'));
                        }
                    }, 1000);
                };
            } catch (error) {
                console.error('Critical error during database initialization:', error);
                reject(error);
            }
        });

        return this._initPromise;
    }

    /**
     * Helper to safely execute a database operation
     * @private
     * @param {Function} operation - Function that performs the database operation
     * @param {String} operationName - Name of the operation for logging
     * @param {any} defaultValue - Default value to return if operation fails
     * @returns {Promise<any>} - Result of the operation or defaultValue
     */
    async _safeOperation(operation, operationName, defaultValue) {
        if (!this._dbReady) {
            try {
                // Try to initialize the database if it's not ready
                await this._initOrRecreateDatabase();
                if (!this._dbReady) {
                    console.warn(`Database not ready, cannot perform ${operationName}`);
                    return defaultValue;
                }
            } catch (initError) {
                console.error(`Database initialization failed for ${operationName}:`, initError);
                return defaultValue;
            }
        }

        try {
            // Ensure we have a valid database object
            if (!this.db) {
                await this._initOrRecreateDatabase();
                if (!this.db) {
                    throw new Error('Database object is null');
                }
            }

            // Try the operation
            return await operation();
        } catch (error) {
            // If the error is about an invalid state or missing object store
            if (error.name === 'InvalidStateError' ||
                error.name === 'NotFoundError' ||
                (error.message && error.message.includes('transaction'))) {

                console.warn(`Database error in ${operationName}, attempting recovery:`, error);

                // Try to recover by reinitializing
                try {
                    await this._recreateDatabase();

                    // Retry the operation once if recovery was successful
                    if (this._dbReady) {
                        return await operation();
                    }
                } catch (recoveryError) {
                    console.error(`Failed to recover database for ${operationName}:`, recoveryError);
                }
            }

            console.error(`Error in ${operationName}:`, error);
            return defaultValue;
        }
    }

    /**
     * Helper to put an item in IndexedDB with enhanced error handling
     * @private
     * @param {Object} item - Item to store
     * @returns {Promise<boolean>} - Whether the operation succeeded
     */
    async _putItem(item) {
        return this._safeOperation(async () => {
            return new Promise((resolve, reject) => {
                try {
                    // Create a transaction with appropriate mode and timeout
                    const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
                    const store = transaction.objectStore(this.STORE_NAME);

                    // Set transaction timeout
                    setTimeout(() => {
                        if (transaction.readyState !== 'inactive') {
                            reject(new Error('Transaction timeout'));
                        }
                    }, 5000); // 5 second timeout

                    const request = store.put(item);

                    request.onsuccess = () => resolve(true);
                    request.onerror = (event) => {
                        console.error('Error putting item in store:', event.target.error);
                        reject(event.target.error);
                    };

                    transaction.oncomplete = () => resolve(true);
                    transaction.onerror = (event) => {
                        console.error('Transaction error in _putItem:', event.target.error);
                        reject(event.target.error);
                    };
                    transaction.onabort = (event) => {
                        console.error('Transaction aborted in _putItem:', event.target.error);
                        reject(new Error('Transaction aborted'));
                    };
                } catch (error) {
                    console.error('Unexpected error in _putItem:', error);
                    reject(error);
                }
            });
        }, '_putItem', false);
    }

    /**
     * Helper to get an item from IndexedDB with enhanced error handling
     * @private
     * @param {string} tabId - Tab ID to get
     * @returns {Promise<Object|null>} - The retrieved item or null
     */
    async _getItem(tabId) {
        if (!tabId) return null;

        return this._safeOperation(async () => {
            return new Promise((resolve, reject) => {
                try {
                    // Create a transaction with appropriate mode
                    const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
                    const store = transaction.objectStore(this.STORE_NAME);

                    // Set transaction timeout
                    setTimeout(() => {
                        if (transaction.readyState !== 'inactive') {
                            reject(new Error('Transaction timeout'));
                        }
                    }, 5000); // 5 second timeout

                    const request = store.get(tabId);

                    request.onsuccess = () => {
                        try {
                            const result = request.result;

                            // Validate result structure
                            if (result) {
                                // Check if this is a valid screenshot entry
                                if (!result.dataUrl) {
                                    console.warn(`Invalid cache entry for ${tabId}: Missing dataUrl`);
                                    resolve(null);
                                    return;
                                }

                                // Ensure metadata exists
                                if (!result.metadata) {
                                    console.warn(`Cache entry for ${tabId} missing metadata, adding default metadata`);
                                    result.metadata = { timestamp: Date.now() };
                                }
                            }

                            resolve(result || null);
                        } catch (validationError) {
                            console.error('Error validating cache result:', validationError);
                            resolve(null);
                        }
                    };

                    request.onerror = (event) => {
                        console.error('Error getting item from store:', event.target.error);
                        reject(event.target.error);
                    };

                    transaction.onerror = (event) => {
                        console.error('Transaction error in _getItem:', event.target.error);
                        reject(event.target.error);
                    };
                    transaction.onabort = (event) => {
                        console.error('Transaction aborted in _getItem:', event.target.error);
                        reject(new Error('Transaction aborted'));
                    };
                } catch (error) {
                    console.error('Unexpected error in _getItem:', error);
                    reject(error);
                }
            });
        }, '_getItem', null);
    }

    /**
     * Helper to delete an item from IndexedDB
     * @private
     * @param {string} tabId - Tab ID to delete
     * @returns {Promise<boolean>}
     */
    async _deleteItem(tabId) {
        return this._safeOperation(async () => {
            return new Promise((resolve, reject) => {
                try {
                    const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
                    const store = transaction.objectStore(this.STORE_NAME);

                    // Set transaction timeout
                    setTimeout(() => {
                        if (transaction.readyState !== 'inactive') {
                            reject(new Error('Transaction timeout'));
                        }
                    }, 5000); // 5 second timeout

                    const request = store.delete(tabId);

                    request.onsuccess = () => resolve(true);
                    request.onerror = (event) => {
                        console.error('Error deleting item:', event.target.error);
                        reject(event.target.error);
                    };

                    transaction.oncomplete = () => resolve(true);
                    transaction.onerror = (event) => {
                        console.error('Transaction error in _deleteItem:', event.target.error);
                        reject(event.target.error);
                    };
                    transaction.onabort = (event) => {
                        console.error('Transaction aborted in _deleteItem:', event.target.error);
                        reject(new Error('Transaction aborted'));
                    };
                } catch (error) {
                    console.error('Unexpected error in _deleteItem:', error);
                    reject(error);
                }
            });
        }, '_deleteItem', false);
    }

    /**
     * Store a screenshot in the cache
     * @param {string} tabId - Tab ID to use as key
     * @param {string} screenshot - Screenshot data URL or blob URL
     * @param {Object} metadata - Additional metadata about the screenshot
     * @returns {Promise<boolean>} - Whether the operation was successful
     */
    async cacheScreenshot(tabId, screenshot, metadata = {}) {
        if (!tabId || !screenshot) {
            console.error('Invalid cache parameters');
            return false;
        }

        try {
            // Convert blob URL to data URL if needed
            let dataUrl = screenshot;
            if (screenshot.startsWith('blob:')) {
                try {
                    dataUrl = await this.blobUrlToDataUrl(screenshot);
                } catch (conversionError) {
                    console.error('Error converting blob URL to data URL:', conversionError);
                    return false;
                }
            }

            // Create cache entry with same structure as chrome.storage version
            const cacheEntry = {
                tabId: tabId,
                dataUrl: dataUrl,
                metadata: {
                    ...metadata,
                    timestamp: Date.now()
                }
            };

            // Store in IndexedDB
            const success = await this._putItem(cacheEntry);
            if (success) {
                console.log(`Cached screenshot for tab ${tabId}`);

                // Manage cache size after adding new item
                try {
                    await this.manageCacheSize();
                } catch (managementError) {
                    console.warn('Error managing cache size:', managementError);
                    // Non-fatal error, continue
                }

                return true;
            } else {
                console.error('Failed to store cache entry');
                return false;
            }
        } catch (error) {
            console.error('Error caching screenshot:', error);
            return false;
        }
    }

    /**
     * Retrieve a screenshot from the cache
     * @param {string} tabId - Tab ID to retrieve
     * @returns {Promise<Object|null>} - Cache entry or null if not found
     */
    async getScreenshot(tabId) {
        if (!tabId) return null;

        return this._safeOperation(async () => {
            const result = await this._getItem(tabId);

            if (!result) {
                console.log(`No cached screenshot for tab ${tabId}`);
                return null;
            }

            // Check if the cache entry has expired
            const timestamp = result.metadata?.timestamp || 0;
            const now = Date.now();
            if (now - timestamp > this.CACHE_EXPIRY) {
                console.log(`Cached screenshot for tab ${tabId} has expired`);
                await this.removeScreenshot(tabId);
                return null;
            }

            console.log(`Retrieved cached screenshot for tab ${tabId}`);
            return result;
        }, 'getScreenshot', null);
    }

    /**
     * Get screenshots for a tab - compatibility method that returns an array format
     * @param {string} tabId - Tab ID to retrieve
     * @returns {Promise<Array>} - Array of screenshots or empty array if not found
     */
    async getScreenshots(tabId) {
        try {
            const screenshot = await this.getScreenshot(tabId);
            if (!screenshot || !screenshot.dataUrl) {
                return [];
            }

            // Return as an array of objects with dataUrl property for backward compatibility
            return [{
                dataUrl: screenshot.dataUrl,
                x: 0,
                y: 0
            }];
        } catch (error) {
            console.error('Error in getScreenshots:', error);
            return [];
        }
    }

    /**
     * Remove a screenshot from the cache
     * @param {string} tabId - Tab ID to remove
     * @returns {Promise<boolean>} - Whether the operation was successful
     */
    async removeScreenshot(tabId) {
        if (!tabId) return false;
        return this._safeOperation(async () => {
            const result = await this._deleteItem(tabId);
            if (result) {
                console.log(`Removed cached screenshot for tab ${tabId}`);
            }
            return result;
        }, 'removeScreenshot', false);
    }

    /**
     * Clean expired cache entries
     * @returns {Promise<number>} - Number of items removed
     */
    async cleanExpiredCache() {
        return this._safeOperation(async () => {
            try {
                const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(this.STORE_NAME);
                const index = store.index('timestamp');

                const now = Date.now();
                const expiryTime = now - this.CACHE_EXPIRY;

                // Get all items with timestamps before expiry time
                const range = IDBKeyRange.upperBound(expiryTime);

                let expiredCount = 0;

                // Process cursor results
                await new Promise((resolve, reject) => {
                    const request = index.openCursor(range);

                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            // Delete expired item
                            cursor.delete();
                            expiredCount++;
                            cursor.continue();
                        } else {
                            // No more items
                            resolve();
                        }
                    };

                    request.onerror = (event) => {
                        console.error('Error in cursor operation:', event.target.error);
                        reject(event.target.error);
                    };

                    transaction.oncomplete = () => {
                        resolve();
                    };

                    transaction.onerror = (event) => {
                        console.error('Transaction error in cleanExpiredCache:', event.target.error);
                        reject(event.target.error);
                    };

                    // Set transaction timeout
                    setTimeout(() => {
                        if (transaction.readyState !== 'inactive') {
                            reject(new Error('Transaction timeout'));
                        }
                    }, 10000); // 10 seconds for potentially larger operation
                });

                if (expiredCount > 0) {
                    console.log(`Cleaned ${expiredCount} expired cache entries`);
                }

                return expiredCount;
            } catch (error) {
                console.error('Error cleaning expired cache:', error);
                return 0;
            }
        }, 'cleanExpiredCache', 0);
    }

    /**
     * Manage cache size to prevent it from growing too large
     * @returns {Promise<number>} - Number of items removed
     */
    async manageCacheSize() {
        return this._safeOperation(async () => {
            try {
                // Get all items sorted by timestamp
                const allItems = await this._getAllItems();

                if (allItems.length <= this.MAX_CACHE_ITEMS) {
                    return 0;
                }

                // Sort items by timestamp (oldest first)
                const sortedItems = allItems.sort((a, b) => {
                    const timestampA = a.metadata?.timestamp || 0;
                    const timestampB = b.metadata?.timestamp || 0;
                    return timestampA - timestampB;
                });

                // Remove oldest items to get back to MAX_CACHE_ITEMS
                const itemsToRemove = sortedItems.slice(0, sortedItems.length - this.MAX_CACHE_ITEMS);

                // Create transaction for batch deletion
                const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(this.STORE_NAME);

                // Delete each item
                for (const item of itemsToRemove) {
                    store.delete(item.tabId);
                }

                // Wait for transaction to complete
                await new Promise((resolve, reject) => {
                    transaction.oncomplete = () => resolve();
                    transaction.onerror = (event) => {
                        console.error('Transaction error in manageCacheSize:', event.target.error);
                        reject(event.target.error);
                    };
                    transaction.onabort = (event) => {
                        console.error('Transaction aborted in manageCacheSize:', event.target.error);
                        reject(new Error('Transaction aborted'));
                    };

                    // Set transaction timeout
                    setTimeout(() => {
                        if (transaction.readyState !== 'inactive') {
                            reject(new Error('Transaction timeout'));
                        }
                    }, 10000); // 10 seconds for potentially larger operation
                });

                console.log(`Removed ${itemsToRemove.length} old cache entries to manage cache size`);
                return itemsToRemove.length;
            } catch (error) {
                console.error('Error managing cache size:', error);
                return 0;
            }
        }, 'manageCacheSize', 0);
    }

    /**
     * Convert a Blob URL to a Data URL
     * @param {string} blobUrl - Blob URL to convert
     * @returns {Promise<string>} - Data URL
     */
    blobUrlToDataUrl(blobUrl) {
        return new Promise((resolve, reject) => {
            try {
                fetch(blobUrl)
                    .then(response => response.blob())
                    .then(blob => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    })
                    .catch(reject);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Get all cache items
     * @returns {Promise<Object>} - All cache items with tabId as keys
     */
    async getAllCacheItems() {
        return this._safeOperation(async () => {
            try {
                // Get all items from the store
                const allItems = await this._getAllItems();

                // Convert to object with tabId as keys (matching chrome.storage format)
                const result = {};
                for (const item of allItems) {
                    const key = this.CACHE_PREFIX + item.tabId;
                    result[key] = item;
                }

                return result;
            } catch (error) {
                console.error('Error getting all cache items:', error);
                return {};
            }
        }, 'getAllCacheItems', {});
    }

    /**
     * Clear all cache entries
     * @returns {Promise<number>} - Number of cleared entries
     */
    async clearAllCache() {
        return this._safeOperation(async () => {
            try {
                const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(this.STORE_NAME);

                // Get count before clearing
                const countRequest = store.count();
                let count = 0;

                await new Promise((resolve, reject) => {
                    countRequest.onsuccess = () => {
                        count = countRequest.result;

                        // Clear all items
                        const request = store.clear();

                        request.onsuccess = resolve;
                        request.onerror = (event) => {
                            console.error('Error clearing store:', event.target.error);
                            reject(event.target.error);
                        };
                    };

                    countRequest.onerror = (event) => {
                        console.error('Error counting items:', event.target.error);
                        reject(event.target.error);
                    };

                    transaction.onerror = (event) => {
                        console.error('Transaction error in clearAllCache:', event.target.error);
                        reject(event.target.error);
                    };

                    // Set transaction timeout
                    setTimeout(() => {
                        if (transaction.readyState !== 'inactive') {
                            reject(new Error('Transaction timeout'));
                        }
                    }, 10000); // 10 seconds for potentially larger operation
                });

                console.log(`Cleared all cache entries (${count} items)`);
                return count;
            } catch (error) {
                console.error('Error clearing cache:', error);
                return 0;
            }
        }, 'clearAllCache', 0);
    }

    /**
     * Helper to get all items from IndexedDB
     * @private
     * @returns {Promise<Array>}
     */
    async _getAllItems() {
        return this._safeOperation(async () => {
            return new Promise((resolve, reject) => {
                try {
                    const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
                    const store = transaction.objectStore(this.STORE_NAME);

                    const request = store.getAll();

                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = (event) => {
                        console.error('Error getting all items:', event.target.error);
                        reject(event.target.error);
                    };

                    transaction.onerror = (event) => {
                        console.error('Transaction error in _getAllItems:', event.target.error);
                        reject(event.target.error);
                    };

                    // Set transaction timeout
                    setTimeout(() => {
                        if (transaction.readyState !== 'inactive') {
                            reject(new Error('Transaction timeout'));
                        }
                    }, 5000);
                } catch (error) {
                    console.error('Unexpected error in _getAllItems:', error);
                    reject(error);
                }
            });
        }, '_getAllItems', []);
    }

    /**
     * Migrate data from chrome.storage.local to IndexedDB
     * @private
     * @returns {Promise<number>} - Number of migrated items
     */
    async _migrateFromChromeStorage() {
        if (!chrome.storage || !chrome.storage.local) {
            console.log('Chrome storage API not available, skipping migration');
            return 0;
        }

        return this._safeOperation(async () => {
            try {
                // Get all items from chrome.storage.local
                const items = await this._getChromeStorageItems();
                const cacheKeys = Object.keys(items).filter(key => key.startsWith(this.CACHE_PREFIX));

                if (cacheKeys.length === 0) {
                    console.log('No items to migrate from chrome.storage.local');
                    return 0;
                }

                console.log(`Migrating ${cacheKeys.length} items from chrome.storage.local to IndexedDB`);

                let migratedCount = 0;

                // Migrate each item to IndexedDB
                for (const key of cacheKeys) {
                    const item = items[key];
                    if (item && item.tabId) {
                        try {
                            await this._putItem(item);

                            // Remove from chrome.storage.local after successful migration
                            await this._removeChromeStorageItem(key);
                            migratedCount++;
                        } catch (itemError) {
                            console.error(`Error migrating item ${key}:`, itemError);
                            // Continue with other items
                        }
                    }
                }

                console.log(`Migration from chrome.storage.local complete (${migratedCount} items)`);
                return migratedCount;
            } catch (error) {
                console.error('Error during migration from chrome.storage.local:', error);
                return 0;
            }
        }, '_migrateFromChromeStorage', 0);
    }

    /**
     * Helper to get all items from chrome.storage.local
     * @private
     * @returns {Promise<Object>}
     */
    _getChromeStorageItems() {
        return new Promise((resolve, reject) => {
            try {
                chrome.storage.local.get(null, items => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(items || {});
                    }
                });
            } catch (error) {
                console.error('Error accessing chrome.storage.local:', error);
                reject(error);
            }
        });
    }

    /**
     * Helper to remove an item from chrome.storage.local
     * @private
     * @param {string} key - Key to remove
     * @returns {Promise<void>}
     */
    _removeChromeStorageItem(key) {
        return new Promise((resolve, reject) => {
            try {
                chrome.storage.local.remove(key, () => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve();
                    }
                });
            } catch (error) {
                console.error('Error removing item from chrome.storage.local:', error);
                reject(error);
            }
        });
    }

    /**
     * Attempt to recover a corrupted or blocked database
     * @returns {Promise<boolean>} - Whether recovery was successful
     */
    async recoverDatabase() {
        console.log("Attempting database recovery...");

        try {
            // Close any existing connections
            if (this.db) {
                try {
                    this.db.close();
                    console.log("Closed existing database connection");
                } catch (closeError) {
                    console.warn("Error closing database:", closeError);
                }
                this.db = null;
            }

            // Reset initialization state
            this._dbReady = false;
            this._initPromise = null;
            this._initRetryCount = 0;

            // Delete and recreate the database
            await new Promise((resolve, reject) => {
                try {
                    const deleteRequest = indexedDB.deleteDatabase(this.DB_NAME);

                    deleteRequest.onsuccess = () => {
                        console.log("Successfully deleted database");
                        resolve();
                    };

                    deleteRequest.onerror = (event) => {
                        console.error("Error deleting database:", event.target.error);
                        reject(event.target.error);
                    };

                    // Handle blocked state (when there are other connections)
                    deleteRequest.onblocked = () => {
                        console.warn("Database deletion blocked. Please close all other tabs using this extension.");
                        // We'll try to continue anyway
                        setTimeout(resolve, 1000);
                    };
                } catch (error) {
                    console.error("Critical error during database deletion:", error);
                    reject(error);
                }
            });

            // Increment the database version to ensure a clean slate
            this.DB_VERSION++;
            console.log(`Incremented database version to ${this.DB_VERSION}`);

            // Reinitialize the database
            const initResult = await this._initOrRecreateDatabase();

            if (initResult) {
                console.log("Database recovered successfully");
                return true;
            } else {
                console.error("Database recovery failed");
                return false;
            }
        } catch (error) {
            console.error("Error during database recovery:", error);
            return false;
        }
    }

    /**
     * Check if IndexedDB is available in this browser/context
     * @returns {boolean}
     */
    isIndexedDBAvailable() {
        try {
            // Check if indexedDB object exists
            if (!window.indexedDB) {
                return false;
            }

            // Test for private browsing mode
            try {
                // Try to open a test database
                const testRequest = window.indexedDB.open('__idb_test__');

                testRequest.onsuccess = (event) => {
                    try {
                        // Clean up the test database
                        const db = event.target.result;
                        db.close();
                        window.indexedDB.deleteDatabase('__idb_test__');
                    } catch (cleanupError) {
                        console.warn('Error cleaning up test database:', cleanupError);
                    }
                };

                testRequest.onerror = () => {
                    console.warn('IndexedDB test failed, may be in private browsing mode');
                };
            } catch (testError) {
                console.warn('Error testing IndexedDB availability:', testError);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error checking IndexedDB availability:', error);
            return false;
        }
    }
}

// Export as a class - will be instantiated in main.js (keeping same pattern as original)
export default IndexedDBCacheManager; 