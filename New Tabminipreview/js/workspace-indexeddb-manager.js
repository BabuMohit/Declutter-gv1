/**
 * Workspace IndexedDB Manager
 * Handles saving, loading, and managing tab workspaces in IndexedDB
 */
export default class WorkspaceIndexedDBManager {
    constructor() {
        this.DB_NAME = 'declutterWorkspacesDB';
        this.STORE_NAME = 'workspaces';
        this.DB_VERSION = 1;
        this.db = null;
    }

    /**
     * Initialize the database connection
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            
            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                reject(event.target.error);
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('Workspace IndexedDB initialized successfully');
                resolve(true);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create object store for workspaces
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
                    store.createIndex('name', 'name', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                    console.log('Workspace object store created');
                }
            };
        });
    }

    /**
     * Load all workspaces from the database
     */
    async loadWorkspaces() {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
            const store = transaction.objectStore(this.STORE_NAME);
            const request = store.getAll();
            
            request.onsuccess = () => {
                resolve(request.result || []);
            };
            
            request.onerror = (event) => {
                console.error('Error loading workspaces:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * Save a new workspace
     * @param {Object} workspace - Workspace object to save
     */
    async saveWorkspace(workspace) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);
            const request = store.add(workspace);
            
            request.onsuccess = () => {
                console.log('Workspace saved successfully:', workspace.name);
                resolve(workspace);
            };
            
            request.onerror = (event) => {
                console.error('Error saving workspace:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * Delete a workspace by ID
     * @param {string} id - Workspace ID to delete
     */
    async deleteWorkspace(id) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);
            const request = store.delete(id);
            
            request.onsuccess = () => {
                console.log('Workspace deleted successfully:', id);
                resolve(true);
            };
            
            request.onerror = (event) => {
                console.error('Error deleting workspace:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * Get a workspace by ID
     * @param {string} id - Workspace ID
     */
    async getWorkspace(id) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
            const store = transaction.objectStore(this.STORE_NAME);
            const request = store.get(id);
            
            request.onsuccess = () => {
                resolve(request.result);
            };
            
            request.onerror = (event) => {
                console.error('Error getting workspace:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * Rename a workspace
     * @param {string} id - Workspace ID to rename
     * @param {string} newName - New name for the workspace
     */
    async renameWorkspace(id, newName) {
        return new Promise(async (resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            try {
                // Get the workspace first
                const workspace = await this.getWorkspace(id);
                if (!workspace) {
                    reject(new Error('Workspace not found'));
                    return;
                }
                
                // Update the name
                workspace.name = newName;
                
                // Save the updated workspace
                const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(this.STORE_NAME);
                const request = store.put(workspace);
                
                request.onsuccess = () => {
                    console.log('Workspace renamed successfully:', newName);
                    resolve(workspace);
                };
                
                request.onerror = (event) => {
                    console.error('Error renaming workspace:', event.target.error);
                    reject(event.target.error);
                };
            } catch (error) {
                console.error('Error in renameWorkspace:', error);
                reject(error);
            }
        });
    }
} 