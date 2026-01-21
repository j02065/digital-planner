/**
 * Outlook Calendar Integration Module
 * Fetches calendar events from Microsoft Outlook via Graph API
 */

class OutlookCalendar {
    constructor() {
        this.accessToken = null;
        this.clientId = 'YOUR_MICROSOFT_CLIENT_ID'; // You'll need to replace this
        this.redirectUri = window.location.origin;
    }

    /**
     * Check if authenticated
     */
    isAuthenticated() {
        const savedToken = localStorage.getItem('outlook_access_token');
        if (savedToken) {
            this.accessToken = savedToken;
            return true;
        }
        return false;
    }

    /**
     * Authenticate with Microsoft
     */
    async authenticate() {
        const authUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
        
        const params = new URLSearchParams({
            client_id: this.clientId,
            response_type: 'token',
            redirect_uri: this.redirectUri,
            scope: 'Calendars.Read offline_access',
            response_mode: 'fragment'
        });

        window.location.href = `${authUrl}?${params.toString()}`;
    }

    /**
     * Handle OAuth callback
     */
    handleAuthCallback() {
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        
        if (accessToken) {
            this.accessToken = accessToken;
            localStorage.setItem('outlook_access_token', accessToken);
            
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
            return true;
        }
        
        return false;
    }

    /**
     * Fetch calendar events for a date range
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     */
    async fetchEvents(startDate, endDate) {
        if (!this.accessToken) {
            throw new Error('Not authenticated');
        }

        const startISO = startDate.toISOString();
        const endISO = endDate.toISOString();

        const url = `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${startISO}&endDateTime=${endISO}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Prefer': 'outlook.timezone="UTC"'
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                // Token expired
                this.disconnect();
                throw new Error('Authentication expired. Please sign in again.');
            }
            throw new Error('Failed to fetch calendar events');
        }

        const data = await response.json();
        
        // Convert to our format
        return data.value.map(event => ({
            subject: event.subject,
            start: new Date(event.start.dateTime),
            end: new Date(event.end.dateTime),
            location: event.location?.displayName,
            isAllDay: event.isAllDay,
            organizer: event.organizer?.emailAddress?.name,
            color: this.getEventColor(event)
        }));
    }

    /**
     * Get color for event (you can customize this)
     */
    getEventColor(event) {
        // Default color scheme
        if (event.showAs === 'busy') return '#d4775d';
        if (event.showAs === 'tentative') return '#4a90e2';
        if (event.showAs === 'outOfOffice') return '#9b59b6';
        return '#2c5f4f'; // default planner color
    }

    /**
     * Disconnect
     */
    disconnect() {
        localStorage.removeItem('outlook_access_token');
        this.accessToken = null;
    }
}

// Export for use in main app
window.OutlookCalendar = OutlookCalendar;
