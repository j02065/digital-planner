/**
 * Google Calendar Integration Module
 * Fetches calendar events from Google Calendar via the Calendar API v3
 * Supports multiple calendars with user-selectable picker
 */

class GoogleCalendar {
    constructor() {
        this.accessToken = null;
        this.clientId = 'YOUR_GOOGLE_CLIENT_ID'; // Replace with your Google OAuth client ID
        this.redirectUri = window.location.origin + window.location.pathname;
        this.calendarList = [];  // all available calendars
    }

    /**
     * Check if authenticated
     */
    isAuthenticated() {
        const savedToken = localStorage.getItem('google_calendar_access_token');
        const expiry = localStorage.getItem('google_calendar_token_expiry');

        if (savedToken && expiry && Date.now() < parseInt(expiry)) {
            this.accessToken = savedToken;
            return true;
        }

        // Token expired — clean up
        if (savedToken) {
            this.disconnect();
        }
        return false;
    }

    /**
     * Authenticate with Google via OAuth 2.0 implicit flow
     */
    authenticate() {
        const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth';

        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: 'token',
            scope: 'https://www.googleapis.com/auth/calendar.readonly',
            include_granted_scopes: 'true',
            prompt: 'consent'
        });

        window.location.href = `${authUrl}?${params.toString()}`;
    }

    /**
     * Handle OAuth callback — extract token from URL hash
     */
    handleAuthCallback() {
        const hash = window.location.hash.substring(1);
        if (!hash) return false;

        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        const expiresIn = params.get('expires_in');

        if (accessToken) {
            this.accessToken = accessToken;
            localStorage.setItem('google_calendar_access_token', accessToken);

            if (expiresIn) {
                const expiry = Date.now() + parseInt(expiresIn) * 1000;
                localStorage.setItem('google_calendar_token_expiry', expiry.toString());
            }

            window.history.replaceState({}, document.title, window.location.pathname);
            return true;
        }

        return false;
    }

    /**
     * Fetch all calendars the user has access to
     * @returns {Array} list of { id, summary, backgroundColor, primary }
     */
    async fetchCalendarList() {
        if (!this.accessToken) {
            throw new Error('Not authenticated');
        }

        const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                this.disconnect();
                throw new Error('Authentication expired. Please sign in again.');
            }
            throw new Error('Failed to fetch calendar list');
        }

        const data = await response.json();

        this.calendarList = (data.items || []).map(cal => ({
            id: cal.id,
            summary: cal.summary || cal.id,
            description: cal.description || '',
            backgroundColor: cal.backgroundColor || '#2c5f4f',
            primary: cal.primary || false
        }));

        return this.calendarList;
    }

    /**
     * Get the user's saved calendar selections from localStorage.
     * Returns null if nothing saved yet (first time).
     */
    getSelectedCalendarIds() {
        const saved = localStorage.getItem('google_calendar_selected');
        if (saved) {
            try { return JSON.parse(saved); } catch (e) { /* fall through */ }
        }
        return null;
    }

    /**
     * Save the user's calendar selections
     * @param {Array<string>} calendarIds
     */
    saveSelectedCalendarIds(calendarIds) {
        localStorage.setItem('google_calendar_selected', JSON.stringify(calendarIds));
    }

    /**
     * Fetch events from multiple calendars and merge them
     * @param {Date} startDate
     * @param {Date} endDate
     * @param {Array<string>} calendarIds - list of calendar IDs to fetch from
     */
    async fetchEvents(startDate, endDate, calendarIds) {
        if (!this.accessToken) {
            throw new Error('Not authenticated');
        }

        if (!calendarIds || calendarIds.length === 0) {
            calendarIds = ['primary'];
        }

        const timeMin = startDate.toISOString();
        const timeMax = endDate.toISOString();

        // Build a color lookup from calendarList
        const colorMap = {};
        this.calendarList.forEach(cal => {
            colorMap[cal.id] = cal.backgroundColor;
        });

        // Fetch all calendars in parallel
        const fetches = calendarIds.map(async (calId) => {
            const params = new URLSearchParams({
                timeMin,
                timeMax,
                singleEvents: 'true',
                orderBy: 'startTime',
                maxResults: '250'
            });

            const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params.toString()}`;

            try {
                const response = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`
                    }
                });

                if (!response.ok) {
                    if (response.status === 401) {
                        this.disconnect();
                        throw new Error('Authentication expired. Please sign in again.');
                    }
                    console.warn(`Failed to fetch calendar ${calId}:`, response.status);
                    return [];
                }

                const data = await response.json();
                const calColor = colorMap[calId] || '#2c5f4f';

                return (data.items || []).map(event => ({
                    subject: event.summary || '(No title)',
                    start: event.start.dateTime
                        ? new Date(event.start.dateTime)
                        : new Date(event.start.date),
                    end: event.end.dateTime
                        ? new Date(event.end.dateTime)
                        : new Date(event.end.date),
                    location: event.location || null,
                    isAllDay: !event.start.dateTime,
                    organizer: event.organizer?.displayName || event.organizer?.email || null,
                    calendarId: calId,
                    color: event.colorId ? this.getEventColor(event) : calColor
                }));
            } catch (err) {
                console.warn(`Error fetching calendar ${calId}:`, err);
                return [];
            }
        });

        const results = await Promise.all(fetches);

        // Merge and sort by start time
        const allEvents = results.flat();
        allEvents.sort((a, b) => a.start - b.start);

        return allEvents;
    }

    /**
     * Map Google Calendar colorId to a display color
     */
    getEventColor(event) {
        const colorMap = {
            '1': '#7986cb', '2': '#33b679', '3': '#8e24aa',
            '4': '#e67c73', '5': '#f6c026', '6': '#f5511d',
            '7': '#039be5', '8': '#616161', '9': '#3f51b5',
            '10': '#0b8043', '11': '#d60000'
        };
        return colorMap[event.colorId] || '#2c5f4f';
    }

    /**
     * Disconnect and clear stored tokens and selections
     */
    disconnect() {
        localStorage.removeItem('google_calendar_access_token');
        localStorage.removeItem('google_calendar_token_expiry');
        localStorage.removeItem('google_calendar_selected');
        this.accessToken = null;
        this.calendarList = [];
    }
}

window.GoogleCalendar = GoogleCalendar;
