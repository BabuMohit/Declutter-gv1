/**
 * Cache Manager for Screenshot Previews
 * Handles storing and retrieving screenshots from local storage
 */

class CacheManager {
    constructor() {
        this.CACHE_PREFIX = 'tab_preview_';
        this.CACHE_EXPIRY = 30 * 60 * 1000; // 30 minutes in milliseconds
        this.MAX_CACHE_ITEMS = 50; // Maximum number of items to keep in cache
    }

    /**
     * Initialize the cache manager
     * @returns {Promise<void>}
     */
    async init() {
        // Check if chrome.storage is available
        if (!chrome.storage || !chrome.storage.local) {
            console.error('Chrome storage API not available');
            throw new Error('Storage API not available');
        }

        console.log('Cache manager initialized');

        // Clean expired cache entries on startup
        await this.cleanExpiredCache();
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
                dataUrl = await this.blobUrlToDataUrl(screenshot);
            }

            const cacheKey = this.CACHE_PREFIX + tabId;
            const cacheEntry = {
                tabId: tabId,
                dataUrl: dataUrl,
                metadata: {
                    ...metadata,
                    timestamp: Date.now()
                }
            };

            // Store in chrome.storage.local
            await this.setStorageItem(cacheKey, cacheEntry);
            console.log(`Cached screenshot for tab ${tabId}`);

            // Manage cache size after adding new item
            this.manageCacheSize();

            return true;
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

        try {
            const cacheKey = this.CACHE_PREFIX + tabId;
            const result = await this.getStorageItem(cacheKey);

            if (!result) {
                console.log(`No cached screenshot for tab ${tabId}`);
                return null;
            }

            // Check if the cache entry has expired
            const timestamp = result.metadata?.timestamp || 0;
            const now = Date.now();
            if (now - timestamp > this.CACHE_EXPIRY) {
                console.log(`Cached screenshot for tab ${tabId} has expired`);
                this.removeScreenshot(tabId);
                return null;
            }

            console.log(`Retrieved cached screenshot for tab ${tabId}`);
            return result;
        } catch (error) {
            console.error('Error retrieving cached screenshot:', error);
            return null;
        }
    }

    /**
     * Remove a screenshot from the cache
     * @param {string} tabId - Tab ID to remove
     * @returns {Promise<boolean>} - Whether the operation was successful
     */
    async removeScreenshot(tabId) {
        if (!tabId) return false;

        try {
            const cacheKey = this.CACHE_PREFIX + tabId;
            await this.removeStorageItem(cacheKey);
            console.log(`Removed cached screenshot for tab ${tabId}`);
            return true;
        } catch (error) {
            console.error('Error removing cached screenshot:', error);
            return false;
        }
    }

    /**
     * Clean expired cache entries
     * @returns {Promise<void>}
     */
    async cleanExpiredCache() {
        try {
            const allItems = await this.getAllCacheItems();
            const now = Date.now();
            let expiredCount = 0;

            for (const [key, item] of Object.entries(allItems)) {
                const timestamp = item.metadata?.timestamp || 0;
                if (now - timestamp > this.CACHE_EXPIRY) {
                    await this.removeStorageItem(key);
                    expiredCount++;
                }
            }

            if (expiredCount > 0) {
                console.log(`Cleaned ${expiredCount} expired cache entries`);
            }
        } catch (error) {
            console.error('Error cleaning expired cache:', error);
        }
    }

    /**
     * Manage cache size to prevent it from growing too large
     * @returns {Promise<void>}
     */
    async manageCacheSize() {
        try {
            const allItems = await this.getAllCacheItems();
            const keys = Object.keys(allItems);

            if (keys.length <= this.MAX_CACHE_ITEMS) {
                return;
            }

            // Sort items by timestamp (oldest first)
            const sortedEntries = Object.entries(allItems)
                .filter(([key, _]) => key.startsWith(this.CACHE_PREFIX))
                .sort((a, b) => {
                    const timestampA = a[1].metadata?.timestamp || 0;
                    const timestampB = b[1].metadata?.timestamp || 0;
                    return timestampA - timestampB;
                });

            // Remove oldest items to get back to MAX_CACHE_ITEMS
            const itemsToRemove = sortedEntries.slice(0, sortedEntries.length - this.MAX_CACHE_ITEMS);
            for (const [key, _] of itemsToRemove) {
                await this.removeStorageItem(key);
            }

            console.log(`Removed ${itemsToRemove.length} old cache entries to manage cache size`);
        } catch (error) {
            console.error('Error managing cache size:', error);
        }
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
     * @returns {Promise<Object>} - All cache items
     */
    async getAllCacheItems() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(null, result => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(result);
                }
            });
        });
    }

    /**
     * Get a specific item from storage
     * @param {string} key - Storage key
     * @returns {Promise<any>} - Storage value
     */
    getStorageItem(key) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get([key], result => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(result[key]);
                }
            });
        });
    }

    /**
     * Set a storage item
     * @param {string} key - Storage key
     * @param {any} value - Storage value
     * @returns {Promise<void>}
     */
    setStorageItem(key, value) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({ [key]: value }, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Remove a storage item
     * @param {string} key - Storage key
     * @returns {Promise<void>}
     */
    removeStorageItem(key) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.remove(key, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Clear all cached screenshots
     * @returns {Promise<number>} - Number of cleared items
     */
    async clearAllCache() {
        try {
            const allItems = await this.getAllCacheItems();
            const cacheKeys = Object.keys(allItems)
                .filter(key => key.startsWith(this.CACHE_PREFIX));

            let clearedCount = 0;
            for (const key of cacheKeys) {
                await this.removeStorageItem(key);
                clearedCount++;
            }

            console.log(`Cleared all cache (${clearedCount} items)`);
            return clearedCount;
        } catch (error) {
            console.error('Error clearing all cache:', error);
            throw error;
        }
    }
}

// Export the module
export default CacheManager; 