/**
 * Cloud Storage Sync Module
 * Supports Box, OneDrive, and Google Drive
 */

class CloudStorageSync {
    constructor() {
        this.provider = null;
        this.accessToken = null;
        this.fileName = 'planner-data.json';
        this.settingsFileName = 'planner-settings.json';
    }

    /**
     * Initialize cloud provider
     * @param {string} provider - 'box', 'onedrive', or 'gdrive'
     */
    async initialize(provider) {
        this.provider = provider;
        
        // Load saved token
        const savedToken = localStorage.getItem(`${provider}_access_token`);
        if (savedToken) {
            this.accessToken = savedToken;
            return true;
        }
        
        return false;
    }

    /**
     * Authenticate with cloud provider
     */
    async authenticate() {
        const configs = {
            box: {
                clientId: 'hg3q6etueooioxakdss6utwnj2qb9gty', // Replace with your Box app client ID
                authUrl: 'https://account.box.com/api/oauth2/authorize',
                redirectUri: window.location.origin + window.location.pathname
            },
            onedrive: {
                clientId: 'YOUR_ONEDRIVE_CLIENT_ID', // Replace with your OneDrive app client ID
                authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
                redirectUri: window.location.origin + window.location.pathname
            },
            gdrive: {
                clientId: 'YOUR_GDRIVE_CLIENT_ID', // Replace with your Google Drive client ID
                authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
                redirectUri: window.location.origin + window.location.pathname
            }
        };

        const config = configs[this.provider];
        if (!config) {
            throw new Error('Invalid provider');
        }

        // OAuth2 parameters
        const params = new URLSearchParams({
            client_id: config.clientId,
            response_type: 'token',
            redirect_uri: config.redirectUri,
            scope: this.getScope()
        });

        // Open OAuth window
        const authUrl = `${config.authUrl}?${params.toString()}`;
        window.location.href = authUrl;
    }

    /**
     * Get OAuth scope based on provider
     */
    getScope() {
        const scopes = {
            box: 'root_readwrite',
            onedrive: 'files.readwrite offline_access',
            gdrive: 'https://www.googleapis.com/auth/drive.file'
        };
        return scopes[this.provider];
    }

    /**
     * Handle OAuth redirect callback
     */
    handleAuthCallback() {
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        
        if (accessToken) {
            this.accessToken = accessToken;
            localStorage.setItem(`${this.provider}_access_token`, accessToken);
            
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
            return true;
        }
        
        return false;
    }

    /**
     * Upload data to cloud
     */
    async uploadData(data, isSettings = false) {
        const fileName = isSettings ? this.settingsFileName : this.fileName;
        
        switch (this.provider) {
            case 'box':
                return await this.uploadToBox(data, fileName);
            case 'onedrive':
                return await this.uploadToOneDrive(data, fileName);
            case 'gdrive':
                return await this.uploadToGDrive(data, fileName);
            default:
                throw new Error('No provider configured');
        }
    }

    /**
     * Download data from cloud
     */
    async downloadData(isSettings = false) {
        const fileName = isSettings ? this.settingsFileName : this.fileName;
        
        switch (this.provider) {
            case 'box':
                return await this.downloadFromBox(fileName);
            case 'onedrive':
                return await this.downloadFromOneDrive(fileName);
            case 'gdrive':
                return await this.downloadFromGDrive(fileName);
            default:
                throw new Error('No provider configured');
        }
    }

    /**
     * Box API methods
     */
    async uploadToBox(data, fileName) {
        const fileId = await this.findBoxFile(fileName);
        const content = JSON.stringify(data);
        
        const formData = new FormData();
        formData.append('attributes', JSON.stringify({
            name: fileName,
            parent: { id: '0' }
        }));
        formData.append('file', new Blob([content], { type: 'application/json' }));

        const url = fileId 
            ? `https://upload.box.com/api/2.0/files/${fileId}/content`
            : 'https://upload.box.com/api/2.0/files/content';

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error('Failed to upload to Box');
        }

        return await response.json();
    }

    async downloadFromBox(fileName) {
        const fileId = await this.findBoxFile(fileName);
        if (!fileId) return null;

        const response = await fetch(`https://api.box.com/2.0/files/${fileId}/content`, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to download from Box');
        }

        return await response.json();
    }

    async findBoxFile(fileName) {
        const response = await fetch(`https://api.box.com/2.0/search?query=${fileName}&type=file`, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            }
        });

        if (!response.ok) return null;

        const data = await response.json();
        return data.entries?.[0]?.id || null;
    }

    /**
     * OneDrive API methods
     */
    async uploadToOneDrive(data, fileName) {
        const content = JSON.stringify(data);
        const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${fileName}:/content`;

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: content
        });

        if (!response.ok) {
            throw new Error('Failed to upload to OneDrive');
        }

        return await response.json();
    }

    async downloadFromOneDrive(fileName) {
        const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${fileName}:/content`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            }
        });

        if (response.status === 404) return null;
        if (!response.ok) {
            throw new Error('Failed to download from OneDrive');
        }

        return await response.json();
    }

    /**
     * Google Drive API methods
     */
    async uploadToGDrive(data, fileName) {
        const fileId = await this.findGDriveFile(fileName);
        const content = JSON.stringify(data);
        
        const metadata = {
            name: fileName,
            mimeType: 'application/json'
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', new Blob([content], { type: 'application/json' }));

        const url = fileId
            ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
            : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

        const response = await fetch(url, {
            method: fileId ? 'PATCH' : 'POST',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            },
            body: form
        });

        if (!response.ok) {
            throw new Error('Failed to upload to Google Drive');
        }

        return await response.json();
    }

    async downloadFromGDrive(fileName) {
        const fileId = await this.findGDriveFile(fileName);
        if (!fileId) return null;

        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to download from Google Drive');
        }

        return await response.json();
    }

    async findGDriveFile(fileName) {
        const query = `name='${fileName}' and trashed=false`;
        const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            }
        });

        if (!response.ok) return null;

        const data = await response.json();
        return data.files?.[0]?.id || null;
    }

    /**
     * Sync local data with cloud
     */
    async syncData() {
        try {
            // Download from cloud
            const cloudData = await this.downloadData();
            const cloudSettings = await this.downloadData(true);
            
            // Get local data
            const localData = JSON.parse(localStorage.getItem('advanced-planner-data-v4') || '{}');
            const localSettings = JSON.parse(localStorage.getItem('planner-settings') || '{}');
            
            // Merge data (cloud takes precedence for conflicts)
            const mergedData = { ...localData, ...cloudData };
            const mergedSettings = { ...localSettings, ...cloudSettings };
            
            // Save merged data locally
            localStorage.setItem('advanced-planner-data-v4', JSON.stringify(mergedData));
            localStorage.setItem('planner-settings', JSON.stringify(mergedSettings));
            
            // Upload to cloud
            await this.uploadData(mergedData);
            await this.uploadData(mergedSettings, true);
            
            return { success: true, data: mergedData };
        } catch (error) {
            console.error('Sync error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Disconnect from cloud provider
     */
    disconnect() {
        localStorage.removeItem(`${this.provider}_access_token`);
        this.accessToken = null;
    }
}

// Export for use in main app
window.CloudStorageSync = CloudStorageSync;
