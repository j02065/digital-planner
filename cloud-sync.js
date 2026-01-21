/**
 * Cloud Storage Sync Module - WITH FOLDER SUPPORT
 * Supports Box, OneDrive, and Google Drive
 * Saves files in a dedicated "Digital Planner" folder
 */

class CloudStorageSync {
    constructor() {
        this.provider = null;
        this.accessToken = null;
        this.fileName = 'planner-data.json';
        this.settingsFileName = 'planner-settings.json';
        this.folderName = 'Digital Planner'; // Folder to store files
        this.folderId = null; // Will be set after finding/creating folder
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
                clientId: 'nya3rh3jh0mhtxp4cx45gaam7kmg1zrb', // ← PUT YOUR CLIENT ID HERE
                authUrl: 'https://account.box.com/api/oauth2/authorize',
                // ↓↓↓ CHANGE THIS TO YOUR EXACT GITHUB PAGES URL ↓↓↓
                redirectUri: 'https://j02065.github.io/digital-planner/'
                // Example: 'https://john123.github.io/digital-planner'
            },
            onedrive: {
                clientId: 'YOUR_ONEDRIVE_CLIENT_ID',
                authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
                redirectUri: 'https://YOUR-GITHUB-USERNAME.github.io/digital-planner'
            },
            gdrive: {
                clientId: 'YOUR_GDRIVE_CLIENT_ID',
                authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
                redirectUri: 'https://YOUR-GITHUB-USERNAME.github.io/digital-planner'
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
     * ========================================
     * BOX API METHODS - WITH FOLDER SUPPORT
     * ========================================
     */

    /**
     * Find or create the Digital Planner folder in Box
     */
    async ensureBoxFolder() {
        if (this.folderId) return this.folderId;

        // Search for existing folder
        const searchResponse = await fetch(
            `https://api.box.com/2.0/search?query=${encodeURIComponent(this.folderName)}&type=folder`,
            {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            }
        );

        if (searchResponse.ok) {
            const data = await searchResponse.json();
            if (data.entries && data.entries.length > 0) {
                this.folderId = data.entries[0].id;
                console.log(`✅ Found existing folder: ${this.folderName}`);
                return this.folderId;
            }
        }

        // Create new folder if not found
        const createResponse = await fetch('https://api.box.com/2.0/folders', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: this.folderName,
                parent: { id: '0' } // 0 = root folder
            })
        });

        if (!createResponse.ok) {
            throw new Error('Failed to create folder in Box');
        }

        const folder = await createResponse.json();
        this.folderId = folder.id;
        console.log(`✅ Created new folder: ${this.folderName}`);
        return this.folderId;
    }

    async uploadToBox(data, fileName) {
        // Ensure folder exists
        const folderId = await this.ensureBoxFolder();
        
        // Check if file already exists in folder
        const fileId = await this.findBoxFile(fileName, folderId);
        const content = JSON.stringify(data);
        
        const formData = new FormData();
        formData.append('attributes', JSON.stringify({
            name: fileName,
            parent: { id: folderId } // Save in our folder
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

        console.log(`✅ Saved ${fileName} to Box folder: ${this.folderName}`);
        return await response.json();
    }

    async downloadFromBox(fileName) {
        // Ensure folder exists
        const folderId = await this.ensureBoxFolder();
        
        const fileId = await this.findBoxFile(fileName, folderId);
        if (!fileId) return null;

        const response = await fetch(`https://api.box.com/2.0/files/${fileId}/content`, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to download from Box');
        }

        console.log(`✅ Downloaded ${fileName} from Box folder: ${this.folderName}`);
        return await response.json();
    }

    async findBoxFile(fileName, folderId) {
        // Search for file in specific folder
        const response = await fetch(
            `https://api.box.com/2.0/folders/${folderId}/items?fields=id,name&limit=1000`,
            {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            }
        );

        if (!response.ok) return null;

        const data = await response.json();
        const file = data.entries.find(item => item.name === fileName && item.type === 'file');
        return file ? file.id : null;
    }

    /**
     * OneDrive API methods - WITH FOLDER SUPPORT
     */
    async uploadToOneDrive(data, fileName) {
        const content = JSON.stringify(data);
        // Save in "Digital Planner" folder
        const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${this.folderName}/${fileName}:/content`;

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

        console.log(`✅ Saved ${fileName} to OneDrive folder: ${this.folderName}`);
        return await response.json();
    }

    async downloadFromOneDrive(fileName) {
        const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${this.folderName}/${fileName}:/content`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            }
        });

        if (response.status === 404) return null;
        if (!response.ok) {
            throw new Error('Failed to download from OneDrive');
        }

        console.log(`✅ Downloaded ${fileName} from OneDrive folder: ${this.folderName}`);
        return await response.json();
    }

    /**
     * Google Drive API methods - WITH FOLDER SUPPORT
     */
    async ensureGDriveFolder() {
        if (this.folderId) return this.folderId;

        // Search for existing folder
        const query = `name='${this.folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const searchResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`,
            {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            }
        );

        if (searchResponse.ok) {
            const data = await searchResponse.json();
            if (data.files && data.files.length > 0) {
                this.folderId = data.files[0].id;
                console.log(`✅ Found existing folder: ${this.folderName}`);
                return this.folderId;
            }
        }

        // Create new folder
        const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: this.folderName,
                mimeType: 'application/vnd.google-apps.folder'
            })
        });

        if (!createResponse.ok) {
            throw new Error('Failed to create folder in Google Drive');
        }

        const folder = await createResponse.json();
        this.folderId = folder.id;
        console.log(`✅ Created new folder: ${this.folderName}`);
        return this.folderId;
    }

    async uploadToGDrive(data, fileName) {
        const folderId = await this.ensureGDriveFolder();
        const fileId = await this.findGDriveFile(fileName, folderId);
        const content = JSON.stringify(data);
        
        const metadata = {
            name: fileName,
            mimeType: 'application/json',
            parents: [folderId] // Save in our folder
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

        console.log(`✅ Saved ${fileName} to Google Drive folder: ${this.folderName}`);
        return await response.json();
    }

    async downloadFromGDrive(fileName) {
        const folderId = await this.ensureGDriveFolder();
        const fileId = await this.findGDriveFile(fileName, folderId);
        if (!fileId) return null;

        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to download from Google Drive');
        }

        console.log(`✅ Downloaded ${fileName} from Google Drive folder: ${this.folderName}`);
        return await response.json();
    }

    async findGDriveFile(fileName, folderId) {
        const query = `name='${fileName}' and '${folderId}' in parents and trashed=false`;
        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`,
            {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            }
        );

        if (!response.ok) return null;

        const data = await response.json();
        return data.files?.[0]?.id || null;
    }

    /**
     * Sync local data with cloud
     */
    async syncData() {
        try {
            console.log('🔄 Starting sync...');
            
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
            
            console.log('✅ Sync complete!');
            return { success: true, data: mergedData };
        } catch (error) {
            console.error('❌ Sync error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Disconnect from cloud provider
     */
    disconnect() {
        localStorage.removeItem(`${this.provider}_access_token`);
        this.accessToken = null;
        this.folderId = null;
    }
}

// Export for use in main app
window.CloudStorageSync = CloudStorageSync;
