const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const {
    createUser,
    createSocialUser,
    updateUserProfile,
    authenticateUser,
    createSession,
    getUserBySessionToken,
    revokeSession,
    getDashboardData,
    createMeeting,
    getMeetingByRoomCode,
    joinMeetingRoom,
    getDatabase,
    updateParticipantState,
    leaveMeetingRoom,
    endMeeting,
    getMeetingChatMessages,
    saveMeetingChatMessage
} = require('../database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: true,
        credentials: true
    }
});

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return;
    }

    const fileContents = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of fileContents.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
            continue;
        }

        let value = line.slice(separatorIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        process.env[key] = value;
    }
}

loadEnvFile(path.join(__dirname, '../../.env'));

const PORT = process.env.PORT || 3000;
const roomPresence = new Map();
const roomWhiteboards = new Map();
const oauthStateStore = new Map();

const oauthProviders = {
    google: {
        label: 'Google',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
        clientIdEnv: 'GOOGLE_CLIENT_ID',
        clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
        redirectPath: '/auth/oauth/google/callback',
        scopes: ['openid', 'email', 'profile']
    },
    linkedin: {
        label: 'LinkedIn',
        authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
        tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
        userInfoUrl: 'https://api.linkedin.com/v2/userinfo',
        clientIdEnv: 'LINKEDIN_CLIENT_ID',
        clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
        redirectPath: '/auth/oauth/linkedin/callback',
        scopes: ['openid', 'profile', 'email']
    },
    facebook: {
        label: 'Facebook',
        authUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
        tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
        userInfoUrl: 'https://graph.facebook.com/me?fields=id,name,email,picture.type(large)',
        clientIdEnv: 'FACEBOOK_CLIENT_ID',
        clientSecretEnv: 'FACEBOOK_CLIENT_SECRET',
        redirectPath: '/auth/oauth/facebook/callback',
        scopes: ['email', 'public_profile']
    }
};

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
    const requestOrigin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Vyom-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    return next();
});

function getAppOrigin(req) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || req.protocol;
    return `${protocol}://${req.get('host')}`;
}

function getOAuthProvider(providerName) {
    return oauthProviders[String(providerName || '').toLowerCase()] || null;
}

function getOAuthRedirectUri(req, providerName) {
    const provider = getOAuthProvider(providerName);
    if (!provider) {
        return null;
    }

    const explicitRedirectUri = process.env[`${providerName.toUpperCase()}_OAUTH_REDIRECT_URI`];
    if (explicitRedirectUri) {
        return explicitRedirectUri;
    }

    return `${getAppOrigin(req)}${provider.redirectPath}`;
}

function getOAuthClientConfig(providerName) {
    const provider = getOAuthProvider(providerName);
    if (!provider) {
        return null;
    }

    return {
        ...provider,
        clientId: process.env[provider.clientIdEnv] || '',
        clientSecret: process.env[provider.clientSecretEnv] || ''
    };
}

function cleanupExpiredOAuthStates() {
    const now = Date.now();
    for (const [state, entry] of oauthStateStore.entries()) {
        if (now - entry.createdAt > 10 * 60 * 1000) {
            oauthStateStore.delete(state);
        }
    }
}

function createOAuthStateEntry(data) {
    cleanupExpiredOAuthStates();
    const state = crypto.randomBytes(18).toString('hex');
    oauthStateStore.set(state, {
        ...data,
        createdAt: Date.now()
    });
    return state;
}

function consumeOAuthState(state) {
    cleanupExpiredOAuthStates();
    const entry = oauthStateStore.get(state);
    if (entry) {
        oauthStateStore.delete(state);
    }
    return entry || null;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderOAuthResultPage({ title, message, success = false, flowId = '', provider = '', token = '', user = null, redirectUrl = '', targetOrigin = '*' }) {
    const payload = JSON.stringify({
        type: success ? 'vyom-social-auth-success' : 'vyom-social-auth-error',
        flowId,
        provider,
        token,
        user,
        message
    });

    const safeTitle = escapeHtml(title);
    const safeMessage = escapeHtml(message);
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle}</title>
    <style>
        body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: linear-gradient(180deg, #f5f8ff, #eaf0ff);
            color: #0f172a;
        }

        .card {
            width: min(100% - 32px, 420px);
            background: #fff;
            border-radius: 24px;
            padding: 28px;
            box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
            border: 1px solid rgba(71, 85, 105, 0.14);
            text-align: center;
        }

        h1 {
            margin: 0 0 10px;
            font-size: 24px;
        }

        p {
            margin: 0;
            line-height: 1.55;
            color: #475569;
        }

        .status {
            margin-top: 16px;
            font-size: 13px;
            color: #5b6cff;
            font-weight: 600;
        }

        .actions {
            margin-top: 20px;
        }

        .actions a, .actions button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 44px;
            padding: 0 16px;
            border-radius: 14px;
            border: 0;
            background: #5b6cff;
            color: #fff;
            text-decoration: none;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>${safeTitle}</h1>
        <p>${safeMessage}</p>
        <div class="status" id="status">You can close this window when it finishes.</div>
        <div class="actions">
            <button id="close-button" type="button">Close</button>
        </div>
    </div>
    <script>
        (function () {
            const payload = ${payload};
            const redirectUrl = ${JSON.stringify(redirectUrl)};
            const targetOrigin = ${JSON.stringify(targetOrigin || '*')};

            function finish() {
                if (window.opener) {
                    window.opener.postMessage(payload, targetOrigin);
                    window.close();
                    return;
                }

                if (payload && payload.token && payload.user) {
                    try {
                        localStorage.setItem('vyomAuthToken', payload.token);
                        localStorage.setItem('vyomAuthUser', JSON.stringify(payload.user));
                    } catch (error) {
                        // Ignore localStorage access errors.
                    }
                }

                if (redirectUrl) {
                    window.location.href = redirectUrl;
                }
            }

            document.getElementById('close-button').addEventListener('click', finish);
            window.setTimeout(finish, 350);
        }());
    </script>
</body>
</html>`;
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(data.error_description || data.error || data.message || 'OAuth request failed.');
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

function createOAuthErrorResponse(res, providerLabel, message) {
    res.status(400).send(renderOAuthResultPage({
        title: `${providerLabel} sign-in failed`,
        message,
        success: false,
        redirectUrl: '/index.html'
    }));
}

function getPostMessageTargetOrigin(returnUrl) {
    try {
        const parsedUrl = new URL(returnUrl);
        if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
            return parsedUrl.origin;
        }
    } catch (error) {
        return '*';
    }

    return '*';
}

function resolveOAuthAvatarUrl(profile) {
    const possibleValues = [
        profile?.picture?.data?.url,
        profile?.picture?.url,
        profile?.picture,
        profile?.avatar_url,
        profile?.avatar,
        profile?.profile_picture,
        profile?.profilePicture,
        profile?.image,
        profile?.photos?.[0]?.value
    ];

    for (const value of possibleValues) {
        if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
            // Prefer larger Google avatars when a size token is present.
            return value.replace(/=s\d+-c$/, '=s384-c');
        }
    }

    return null;
}

function buildOAuthUser(providerName, profile) {
    const provider = String(providerName || '').toLowerCase();
    const avatarUrl = resolveOAuthAvatarUrl(profile);

    if (provider === 'facebook') {
        const displayName = profile.name || 'Facebook user';
        const email = profile.email || `${profile.id || 'facebook'}@facebook.vyom.local`;
        return {
            email,
            displayName,
            avatarUrl
        };
    }

    if (provider === 'linkedin') {
        const displayName = profile.name || [profile.given_name, profile.family_name].filter(Boolean).join(' ') || 'LinkedIn user';
        const email = profile.email || `${profile.sub || profile.id || 'linkedin'}@linkedin.vyom.local`;
        return {
            email,
            displayName,
            avatarUrl
        };
    }

    const displayName = profile.name || [profile.given_name, profile.family_name].filter(Boolean).join(' ') || 'Google user';
    const email = profile.email || `${profile.sub || profile.id || 'google'}@google.vyom.local`;
    return {
        email,
        displayName,
        avatarUrl
    };
}

function buildOAuthAuthorizationUrl(req, providerName, state) {
    const provider = getOAuthClientConfig(providerName);
    if (!provider || !provider.clientId) {
        return null;
    }

    const redirectUri = getOAuthRedirectUri(req, providerName);
    const query = new URLSearchParams();
    query.set('client_id', provider.clientId);
    query.set('redirect_uri', redirectUri);
    query.set('response_type', 'code');
    query.set('scope', provider.scopes.join(providerName === 'facebook' ? ',' : ' '));
    query.set('state', state);

    if (providerName === 'google') {
        query.set('access_type', 'online');
        query.set('prompt', 'consent');
    }

    return `${provider.authUrl}?${query.toString()}`;
}

async function exchangeOAuthCode(providerName, code, redirectUri) {
    const provider = getOAuthClientConfig(providerName);
    if (!provider) {
        const error = new Error('Unsupported OAuth provider.');
        error.status = 400;
        throw error;
    }

    const clientId = provider.clientId;
    const clientSecret = provider.clientSecret;
    if (!clientId || !clientSecret) {
        const error = new Error(`${provider.label} OAuth is not configured.`);
        error.status = 500;
        throw error;
    }

    if (providerName === 'facebook') {
        const tokenUrl = new URL(provider.tokenUrl);
        tokenUrl.searchParams.set('client_id', clientId);
        tokenUrl.searchParams.set('client_secret', clientSecret);
        tokenUrl.searchParams.set('redirect_uri', redirectUri);
        tokenUrl.searchParams.set('code', code);
        return fetchJson(tokenUrl.toString());
    }

    const body = new URLSearchParams();
    body.set('code', code);
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    body.set('redirect_uri', redirectUri);
    body.set('grant_type', 'authorization_code');

    return fetchJson(provider.tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    });
}

async function fetchOAuthProfile(providerName, accessToken) {
    const provider = getOAuthClientConfig(providerName);
    if (!provider) {
        const error = new Error('Unsupported OAuth provider.');
        error.status = 400;
        throw error;
    }

    if (providerName === 'facebook') {
        const profileUrl = new URL(provider.userInfoUrl);
        profileUrl.searchParams.set('access_token', accessToken);
        return fetchJson(profileUrl.toString());
    }

    return fetchJson(provider.userInfoUrl, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });
}

app.get('/auth/oauth/:provider', async (req, res) => {
    try {
        const providerName = String(req.params.provider || '').toLowerCase();
        const provider = getOAuthClientConfig(providerName);
        const flowId = String(req.query.flowId || '');
        const returnUrl = String(req.query.returnUrl || '');
        const targetOrigin = getPostMessageTargetOrigin(returnUrl);

        if (!provider) {
            return res.status(400).send(renderOAuthResultPage({
                title: 'Social sign-in failed',
                message: 'Unsupported social provider.',
                success: false,
                flowId,
                redirectUrl: returnUrl || '/index.html',
                targetOrigin
            }));
        }

        if (!provider.clientId || !provider.clientSecret) {
            return res.status(400).send(renderOAuthResultPage({
                title: `${provider.label} sign-in failed`,
                message: `${provider.label} OAuth is not configured yet. Set ${provider.clientIdEnv} and ${provider.clientSecretEnv} in your environment.`,
                success: false,
                flowId,
                provider: provider.label,
                redirectUrl: returnUrl || '/index.html',
                targetOrigin
            }));
        }

        const mode = String(req.query.mode || 'signin');
        const state = createOAuthStateEntry({ providerName, flowId, mode, returnUrl });
        const authUrl = buildOAuthAuthorizationUrl(req, providerName, state);

        if (!authUrl) {
            return createOAuthErrorResponse(res, provider.label, `${provider.label} OAuth could not be started.`);
        }

        return res.redirect(authUrl);
    } catch (error) {
        return res.status(error.status || 500).send(renderOAuthResultPage({
            title: 'Social sign-in failed',
            message: error.message || 'Unable to start social sign-in.',
            success: false,
            redirectUrl: '/index.html'
        }));
    }
});

app.get('/auth/oauth/:provider/callback', async (req, res) => {
    try {
        const providerName = String(req.params.provider || '').toLowerCase();
        const provider = getOAuthClientConfig(providerName);

        if (!provider) {
            return createOAuthErrorResponse(res, 'Social', 'Unsupported social provider.');
        }

        const state = String(req.query.state || '');
        const stateEntry = state ? consumeOAuthState(state) : null;
        const redirectUrl = stateEntry?.returnUrl || '/index.html';
        const targetOrigin = getPostMessageTargetOrigin(stateEntry?.returnUrl);

        const errorName = req.query.error;
        if (errorName) {
            const errorDescription = req.query.error_description || 'The provider cancelled or rejected the sign-in.';
            return res.status(400).send(renderOAuthResultPage({
                title: `${provider.label} sign-in cancelled`,
                message: errorDescription,
                success: false,
                flowId: stateEntry?.flowId || '',
                provider: provider.label,
                redirectUrl,
                targetOrigin
            }));
        }

        if (!stateEntry || stateEntry.providerName !== providerName) {
            return createOAuthErrorResponse(res, provider.label, 'Your social sign-in session expired. Please try again.');
        }

        const code = String(req.query.code || '');
        if (!code) {
            return createOAuthErrorResponse(res, provider.label, 'Missing authorization code.');
        }

        const redirectUri = getOAuthRedirectUri(req, providerName);
        const tokenData = await exchangeOAuthCode(providerName, code, redirectUri);
        const accessToken = tokenData.access_token;
        if (!accessToken) {
            return createOAuthErrorResponse(res, provider.label, 'The provider did not return an access token.');
        }

        const profile = await fetchOAuthProfile(providerName, accessToken);
        const { email, displayName, avatarUrl } = buildOAuthUser(providerName, profile);
        const user = await createSocialUser({
            provider: provider.label,
            email,
            displayName,
            avatarUrl
        });
        const token = await createSession(user.id);

        return res.send(renderOAuthResultPage({
            title: `${provider.label} sign-in complete`,
            message: `You are signed in with ${provider.label}. Returning to Vyom...`,
            success: true,
            flowId: stateEntry.flowId,
            provider: provider.label,
            token,
            user,
            redirectUrl,
            targetOrigin
        }));
    } catch (error) {
        return res.status(error.status || 500).send(renderOAuthResultPage({
            title: 'Social sign-in failed',
            message: error.message || 'Unable to complete social sign-in.',
            success: false,
            redirectUrl: '/index.html'
        }));
    }
});

function extractToken(req) {
    const authHeader = req.headers.authorization || '';
    if (authHeader.toLowerCase().startsWith('bearer ')) {
        return authHeader.slice(7).trim();
    }

    return req.headers['x-vyom-token'] || req.query.token || null;
}

async function requireAuth(req, res, next) {
    try {
        const token = extractToken(req);
        const user = await getUserBySessionToken(token);

        if (!user) {
            return res.status(401).json({ message: 'Authentication required.' });
        }

        req.user = user;
        req.sessionToken = token;
        return next();
    } catch (error) {
        return next(error);
    }
}

function formatMeetingState(meeting) {
    if (!meeting) {
        return null;
    }

    const participants = [...meeting.participants].sort((left, right) => {
        if (left.isHost !== right.isHost) {
            return left.isHost ? -1 : 1;
        }

        if (left.handRaised !== right.handRaised) {
            return right.handRaised ? 1 : -1;
        }

        return new Date(left.joinedAt).getTime() - new Date(right.joinedAt).getTime();
    });

    return {
        id: meeting.id,
        roomCode: meeting.roomCode,
        title: meeting.title,
        description: meeting.description,
        status: meeting.status,
        teamName: meeting.teamName,
        scheduledAt: meeting.scheduledAt,
        startedAt: meeting.startedAt,
        endedAt: meeting.endedAt,
        host: meeting.host,
        participants,
        participantCount: participants.length,
        activeSpeaker: participants[0] || null
    };
}

function sendMeetingState(ioServer, meeting) {
    if (!meeting) {
        return;
    }

    const formattedMeeting = formatMeetingState(meeting);
    const liveParticipants = formatRoomParticipants(meeting.roomCode);

    ioServer.to(meeting.roomCode).emit('meeting:state', {
        ...formattedMeeting,
        participants: liveParticipants.length ? liveParticipants : formattedMeeting.participants,
        participantCount: liveParticipants.length || formattedMeeting.participantCount,
        activeSpeaker: liveParticipants[0] || formattedMeeting.activeSpeaker
    });
}

function getRoomPresenceMap(roomCode) {
    if (!roomPresence.has(roomCode)) {
        roomPresence.set(roomCode, new Map());
    }

    return roomPresence.get(roomCode);
}

function formatRoomParticipants(roomCode) {
    const participants = [...getRoomPresenceMap(roomCode).values()];
    participants.sort((left, right) => {
        if (left.isHost !== right.isHost) {
            return left.isHost ? -1 : 1;
        }

        return new Date(left.joinedAt).getTime() - new Date(right.joinedAt).getTime();
    });

    return participants;
}

function broadcastRoomParticipants(roomCode) {
    io.to(roomCode).emit('room:participants', {
        roomCode,
        participants: formatRoomParticipants(roomCode)
    });
}

function getRoomWhiteboardState(roomCode) {
    if (!roomWhiteboards.has(roomCode)) {
        roomWhiteboards.set(roomCode, []);
    }

    return roomWhiteboards.get(roomCode);
}

function broadcastWhiteboardState(roomCode) {
    io.to(roomCode).emit('meeting:whiteboard-state', {
        roomCode,
        strokes: getRoomWhiteboardState(roomCode)
    });
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
});

app.post('/api/auth/register', async (req, res, next) => {
    try {
        const { firstName, lastName, email, password } = req.body;
        const user = await createUser({ firstName, lastName, email, password });
        const token = await createSession(user.id);
        return res.status(201).json({ user, token });
    } catch (error) {
        return next(error);
    }
});

app.post('/api/auth/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const user = await authenticateUser({ email, password });
        const token = await createSession(user.id);
        return res.json({ user, token });
    } catch (error) {
        return next(error);
    }
});

app.post('/api/auth/social', async (req, res, next) => {
    try {
        const { provider, email, displayName } = req.body;
        const normalizedProvider = String(provider || '').trim().toLowerCase();
        if (['google', 'linkedin', 'facebook'].includes(normalizedProvider)) {
            return res.status(400).json({
                message: `Use OAuth ${provider} sign-in to continue with your provider profile photo.`
            });
        }

        const socialEmail = email || `${String(provider || 'social').toLowerCase()}@demo.vyom`;
        const user = await createSocialUser({
            provider,
            email: socialEmail,
            displayName: displayName || provider
        });
        const token = await createSession(user.id);
        return res.json({ user, token });
    } catch (error) {
        return next(error);
    }
});

app.post('/api/auth/logout', requireAuth, async (req, res, next) => {
    try {
        await revokeSession(req.sessionToken);
        return res.json({ success: true });
    } catch (error) {
        return next(error);
    }
});

app.get('/api/me', requireAuth, async (req, res) => {
    return res.json({ user: req.user });
});

app.patch('/api/me', requireAuth, async (req, res, next) => {
    try {
        const { firstName, lastName, avatarUrl, age, occupation, currentPassword, newPassword } = req.body;
        const user = await updateUserProfile({
            userId: req.user.id,
            firstName,
            lastName,
            avatarUrl,
            age,
            occupation,
            currentPassword,
            newPassword
        });

        return res.json({ user });
    } catch (error) {
        return next(error);
    }
});

app.get('/api/dashboard', requireAuth, async (req, res, next) => {
    try {
        const dashboard = await getDashboardData(req.user.id);
        return res.json(dashboard);
    } catch (error) {
        return next(error);
    }
});

app.get('/api/teams', requireAuth, async (req, res, next) => {
    try {
        const dashboard = await getDashboardData(req.user.id);
        return res.json({ teams: dashboard.teams });
    } catch (error) {
        return next(error);
    }
});

app.post('/api/teams', requireAuth, async (req, res, next) => {
    try {
        const { name, description } = req.body;
        if (!name) {
            return res.status(400).json({ message: 'Team name is required.' });
        }

        const db = await getDatabase();
        const result = await db.run(
            'INSERT INTO teams (owner_id, name, description) VALUES (?, ?, ?)',
            [req.user.id, name.trim(), description || '']
        );

        const team = await db.get('SELECT * FROM teams WHERE id = ?', [result.lastID]);
        return res.status(201).json({ team });
    } catch (error) {
        return next(error);
    }
});

app.post('/api/meetings', requireAuth, async (req, res, next) => {
    try {
        const { title, description, teamId, scheduledAt } = req.body;
        const meeting = await createMeeting({
            hostUserId: req.user.id,
            title,
            description,
            teamId: teamId || null,
            scheduledAt: scheduledAt || new Date().toISOString()
        });

        return res.status(201).json({
            meeting: {
                id: meeting.id,
                roomCode: meeting.room_code,
                title: meeting.title
            }
        });
    } catch (error) {
        return next(error);
    }
});

app.get('/api/meetings/:roomCode', requireAuth, async (req, res, next) => {
    try {
        const meeting = await getMeetingByRoomCode(req.params.roomCode);
        if (!meeting) {
            return res.status(404).json({ message: 'Meeting not found.' });
        }

        return res.json({ meeting: formatMeetingState(meeting) });
    } catch (error) {
        return next(error);
    }
});

app.post('/api/meetings/:roomCode/join', requireAuth, async (req, res, next) => {
    try {
        const meeting = await joinMeetingRoom({ roomCode: req.params.roomCode, user: req.user });
        return res.json({ meeting: formatMeetingState(meeting) });
    } catch (error) {
        return next(error);
    }
});

app.post('/api/meetings/:roomCode/state', requireAuth, async (req, res, next) => {
    try {
        const meeting = await updateParticipantState(req.params.roomCode, req.user.id, req.body || {});
        return res.json({ meeting: formatMeetingState(meeting) });
    } catch (error) {
        return next(error);
    }
});

app.post('/api/meetings/:roomCode/leave', requireAuth, async (req, res, next) => {
    try {
        const meeting = await leaveMeetingRoom(req.params.roomCode, req.user.id);
        return res.json({ meeting: formatMeetingState(meeting) });
    } catch (error) {
        return next(error);
    }
});

app.post('/api/meetings/:roomCode/end', requireAuth, async (req, res, next) => {
    try {
        const meeting = await endMeeting(req.params.roomCode, req.user.id);
        return res.json({ meeting: formatMeetingState(meeting) });
    } catch (error) {
        return next(error);
    }
});

app.use(express.static(path.join(__dirname, '../../public'), { extensions: ['html'] }));

app.use((error, req, res, next) => {
    console.error(error);
    const status = error.status || 500;
    res.status(status).json({
        message: error.message || 'Something went wrong.'
    });
});

io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token || socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
        const user = await getUserBySessionToken(token);

        if (!user) {
            return next(new Error('Authentication required.'));
        }

        socket.user = user;
        socket.data.joinedRooms = new Set();
        return next();
    } catch (error) {
        return next(error);
    }
});

io.on('connection', (socket) => {
    socket.on('meeting:join', async ({ roomCode }) => {
        try {
            if (!roomCode) {
                throw new Error('A meeting room code is required.');
            }

            const meeting = await joinMeetingRoom({ roomCode, user: socket.user });
            socket.join(roomCode);
            socket.data.joinedRooms.add(roomCode);
            socket.data.currentRoomCode = roomCode;
            const presence = getRoomPresenceMap(roomCode);
            presence.set(socket.id, {
                socketId: socket.id,
                userId: socket.user.id,
                name: socket.user.name,
                email: socket.user.email,
                audioEnabled: true,
                videoEnabled: true,
                handRaised: false,
                isHost: meeting.hostUserId === socket.user.id,
                joinedAt: new Date().toISOString()
            });
            broadcastRoomParticipants(roomCode);
            socket.emit('meeting:joined', formatMeetingState(meeting));
            socket.emit('meeting:chat-history', {
                roomCode,
                messages: await getMeetingChatMessages(roomCode)
            });
            socket.emit('meeting:whiteboard-state', {
                roomCode,
                strokes: getRoomWhiteboardState(roomCode)
            });
            sendMeetingState(io, meeting);
        } catch (error) {
            socket.emit('meeting:error', error.message || 'Unable to join meeting.');
        }
    });

    socket.on('meeting:update-state', async ({ roomCode, ...statePatch }) => {
        try {
            if (!roomCode) {
                throw new Error('A meeting room code is required.');
            }

            const meeting = await updateParticipantState(roomCode, socket.user.id, statePatch);
            const presence = roomPresence.get(roomCode);
            if (presence && presence.has(socket.id)) {
                const current = presence.get(socket.id);
                presence.set(socket.id, {
                    ...current,
                    ...('audioEnabled' in statePatch ? { audioEnabled: Boolean(statePatch.audioEnabled) } : {}),
                    ...('videoEnabled' in statePatch ? { videoEnabled: Boolean(statePatch.videoEnabled) } : {}),
                    ...('handRaised' in statePatch ? { handRaised: Boolean(statePatch.handRaised) } : {})
                });
                broadcastRoomParticipants(roomCode);
            }
            sendMeetingState(io, meeting);
        } catch (error) {
            socket.emit('meeting:error', error.message || 'Unable to update meeting state.');
        }
    });

    socket.on('meeting:leave', async ({ roomCode }) => {
        try {
            if (!roomCode) {
                return;
            }

            const meeting = await leaveMeetingRoom(roomCode, socket.user.id);
            socket.leave(roomCode);
            socket.data.joinedRooms.delete(roomCode);
            const presence = roomPresence.get(roomCode);
            if (presence) {
                presence.delete(socket.id);
                if (presence.size === 0) {
                    roomPresence.delete(roomCode);
                } else {
                    broadcastRoomParticipants(roomCode);
                }
            }
            sendMeetingState(io, meeting);
        } catch (error) {
            socket.emit('meeting:error', error.message || 'Unable to leave meeting.');
        }
    });

    socket.on('meeting:whiteboard-stroke', ({ roomCode, stroke }) => {
        try {
            if (!roomCode || !stroke) {
                throw new Error('A meeting room code and stroke are required.');
            }

            const strokes = getRoomWhiteboardState(roomCode);
            strokes.push(stroke);
            broadcastWhiteboardState(roomCode);
        } catch (error) {
            socket.emit('meeting:error', error.message || 'Unable to update whiteboard.');
        }
    });

    socket.on('meeting:whiteboard-clear', ({ roomCode }) => {
        try {
            if (!roomCode) {
                throw new Error('A meeting room code is required.');
            }

            roomWhiteboards.set(roomCode, []);
            broadcastWhiteboardState(roomCode);
        } catch (error) {
            socket.emit('meeting:error', error.message || 'Unable to clear whiteboard.');
        }
    });

    socket.on('webrtc:signal', async ({ roomCode, targetSocketId, data }) => {
        try {
            if (!roomCode || !targetSocketId || !data) {
                throw new Error('Invalid signaling payload.');
            }

            io.to(targetSocketId).emit('webrtc:signal', {
                roomCode,
                sourceSocketId: socket.id,
                sourceUser: {
                    id: socket.user.id,
                    name: socket.user.name,
                    email: socket.user.email
                },
                data
            });
        } catch (error) {
            socket.emit('meeting:error', error.message || 'Unable to relay signaling data.');
        }
    });

    socket.on('meeting:chat-message', async ({ roomCode, message }) => {
        try {
            if (!roomCode) {
                throw new Error('A meeting room code is required.');
            }

            const savedMessage = await saveMeetingChatMessage(roomCode, socket.user.id, message);
            io.to(roomCode).emit('meeting:chat-message', {
                roomCode,
                message: savedMessage
            });
        } catch (error) {
            socket.emit('meeting:error', error.message || 'Unable to send chat message.');
        }
    });

    socket.on('disconnect', async () => {
        const joinedRooms = [...socket.data.joinedRooms];
        for (const roomCode of joinedRooms) {
            try {
                const meeting = await leaveMeetingRoom(roomCode, socket.user.id);
                const presence = roomPresence.get(roomCode);
                if (presence) {
                    presence.delete(socket.id);
                    if (presence.size === 0) {
                        roomPresence.delete(roomCode);
                    } else {
                        broadcastRoomParticipants(roomCode);
                    }
                }
                sendMeetingState(io, meeting);
            } catch (error) {
                console.error(error);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Vyom server running at http://localhost:${PORT}`);
});
