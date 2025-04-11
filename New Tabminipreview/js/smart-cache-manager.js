/**
 * Smart Cache Manager for Screenshot Previews
 * Extends IndexedDBCacheManager with activity-based expiry logic
 */

import IndexedDBCacheManager from './indexeddb-cache-manager.js';

class SmartCacheManager extends IndexedDBCacheManager {
    constructor() {
        super();
        
        // Reference to the activity tracker (will be set in init)
        this.activityTracker = null;
        
        // Settings
        this.SIZE_THRESHOLD_WARNING = 0.85; // 85% of quota
        this.SIZE_THRESHOLD_CRITICAL = 0.95; // 95% of quota
        
        // Storage quota information
        this.storageQuota = null;
        
        // Cleanup interval reference
        this.cleanupInterval = null;
    }
    
    /**
     * Initialize the cache manager with activity tracking
     * @param {ActivityTracker} activityTracker - The activity tracker instance
     * @returns {Promise<boolean>} - Whether initialization was successful
     */
    async init(activityTracker) {
        // Store reference to the activity tracker
        this.activityTracker = activityTracker;
        
        // Call parent's init method
        const initResult = await super.init();
        
        // Get storage quota info from browser
        await this.updateStorageQuota();
        
        // Initial cleanup on startup
        await this.performStartupCleanup();
        
        // Set up regular cleanup checks
        this.cleanupInterval = setInterval(
            () => this.performPeriodicCleanup(),
            10 * 60 * 1000 // Every 10 minutes
        );
        
        return initResult;
    }
    
    /**
     * Get current browser storage quota information
     * @returns {Promise<void>}
     */
    async updateStorageQuota() {
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const estimate = await navigator.storage.estimate();
                this.storageQuota = {
                    usage: estimate.usage || 0,
                    quota: estimate.quota || 0,
                    usageRatio: estimate.quota ? estimate.usage / estimate.quota : 0
                };
                
                console.log(`Storage usage: ${Math.round(this.storageQuota.usageRatio * 100)}% (${this.formatBytes(this.storageQuota.usage)} / ${this.formatBytes(this.storageQuota.quota)})`);
            }
        } catch (e) {
            console.error('Failed to estimate storage usage:', e);
        }
    }
    
    /**
     * Format bytes into human-readable format
     * @param {number} bytes - Number of bytes
     * @returns {string} - Formatted string
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    /**
     * Check if a cache item should be considered expired
     * @param {Object} item - The cache item to check
     * @returns {boolean} - Whether the item should be considered expired
     */
    isExpired(item) {
        // If activity tracker is not available, fall back to default expiry logic
        if (!this.activityTracker) {
            const timestamp = item.metadata?.timestamp || 0;
            return (Date.now() - timestamp) > this.CACHE_EXPIRY;
        }
        
        // If extension has been active recently, nothing expires
        if (this.activityTracker.isActive()) {
            return false;
        }
        
        // Calculate expiry time based on last activity
        const timestamp = item.metadata?.timestamp || 0;
        const expiryTime = this.activityTracker.lastActivity + this.CACHE_EXPIRY;
        
        // Item is expired if we're past the expiry time
        return Date.now() > expiryTime;
    }
    
    /**
     * Startup cleanup - more aggressive than periodic
     * @returns {Promise<void>}
     */
    async performStartupCleanup() {
        console.log('Performing startup cleanup check...');
        
        // If the activity tracker is available and extension hasn't been used for a while
        if (this.activityTracker && !this.activityTracker.isActive()) {
            console.log('Performing startup cleanup due to inactivity');
            await this.cleanExpiredCache();
        } else {
            console.log('No startup cleanup needed - extension has been recently active');
        }
        
        // Also check if we're getting close to storage quota
        await this.updateStorageQuota();
        if (this.storageQuota && this.storageQuota.usageRatio > this.SIZE_THRESHOLD_WARNING) {
            console.log('Performing startup cleanup due to high storage usage');
            await this.manageCacheSize();
        }
    }
    
    /**
     * Periodic cleanup - runs in the background
     * @returns {Promise<void>}
     */
    async performPeriodicCleanup() {
        // Only cleanup if:
        // 1. The extension is not actively being used, OR
        // 2. We're approaching storage limits
        
        let needsCleanup = false;
        if (this.activityTracker) {
            needsCleanup = !this.activityTracker.isActive();
        }
        
        // Check storage usage
        await this.updateStorageQuota();
        const isStorageCritical = this.storageQuota && 
                                this.storageQuota.usageRatio > this.SIZE_THRESHOLD_WARNING;
        
        if (needsCleanup || isStorageCritical) {
            console.log('Performing periodic cleanup');
            
            if (needsCleanup) {
                await this.cleanExpiredCache();
            }
            
            if (isStorageCritical) {
                await this.manageCacheSize();
            }
        }
    }
    
    /**
     * Override getScreenshot to implement activity-aware expiry logic
     * @param {string} tabId - Tab ID to retrieve
     * @returns {Promise<Object|null>} - Cache entry or null if not found/expired
     */
    async getScreenshot(tabId) {
        return await this._safeOperation(async () => {
            const result = await this._getItem(tabId);
            if (!result) {
                console.log(`No cached screenshot for tab ${tabId}`);
                return null;
            }
            
            // Check if this item should be expired based on activity
            if (this.isExpired(result)) {
                console.log(`Cached screenshot for tab ${tabId} has expired due to inactivity`);
                await this.removeScreenshot(tabId);
                return null;
            }
            
            console.log(`Retrieved cached screenshot for tab ${tabId}`);
            return result;
        }, 'getScreenshot', null);
    }
    
    /**
     * Override cleanExpiredCache to use activity-based expiry
     * @returns {Promise<number>} - Number of items removed
     */
    async cleanExpiredCache() {
        return await this._safeOperation(async () => {
            try {
                // Get all cache items
                const items = await this._getAllItems();
                let removedCount = 0;
                
                // Delete items one by one if they're expired
                const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(this.STORE_NAME);
                
                for (const item of items) {
                    if (this.isExpired(item)) {
                        store.delete(item.tabId);
                        removedCount++;
                    }
                }
                
                // Wait for transaction to complete
                await new Promise((resolve, reject) => {
                    transaction.oncomplete = () => resolve();
                    transaction.onerror = (event) => {
                        console.error('Transaction error in cleanExpiredCache:', event.target.error);
                        reject(event.target.error);
                    };
                    transaction.onabort = (event) => {
                        console.error('Transaction aborted in cleanExpiredCache:', event.target.error);
                        reject(new Error('Transaction aborted'));
                    };
                });
                
                if (removedCount > 0) {
                    console.log(`Cleaned ${removedCount} expired cache entries due to inactivity`);
                }
                
                return removedCount;
            } catch (error) {
                console.error('Error cleaning expired cache:', error);
                return 0;
            }
        }, 'cleanExpiredCache', 0);
    }
    
    /**
     * Enhanced manageCacheSize that prioritizes keeping recent items
     * @returns {Promise<number>} - Number of items removed
     */
    async manageCacheSize() {
        return await this._safeOperation(async () => {
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
                
                // Calculate how many items to remove to get back to a safe level
                // We'll remove more aggressively if storage is critical
                let targetCount = this.MAX_CACHE_ITEMS;
                if (this.storageQuota && this.storageQuota.usageRatio > this.SIZE_THRESHOLD_CRITICAL) {
                    // Remove extra items if we're critically close to quota limits
                    targetCount = Math.floor(this.MAX_CACHE_ITEMS * 0.7); // Target 70% of max when critical
                }
                
                // Items to remove to get back to target count
                const itemsToRemove = sortedItems.slice(0, Math.max(0, sortedItems.length - targetCount));
                
                if (itemsToRemove.length === 0) {
                    return 0;
                }
                
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
                });
                
                console.log(`Removed ${itemsToRemove.length} oldest items from cache due to size limit`);
                return itemsToRemove.length;
            } catch (error) {
                console.error('Error managing cache size:', error);
                return 0;
            }
        }, 'manageCacheSize', 0);
    }
    
    /**
     * Clean up resources when extension is unloaded
     */
    dispose() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// Export as a class
export default SmartCacheManager;
