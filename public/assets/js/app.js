const AUTH_TOKEN_KEY = 'vyomAuthToken';
const AUTH_USER_KEY = 'vyomAuthUser';
const DEFAULT_LOCAL_BACKEND_PORT = '3000';

function getConfiguredBackendOrigin() {
    const metaOrigin = document.querySelector('meta[name="vyom-api-origin"]')?.content?.trim();
    const windowOrigin = typeof window.VYOM_API_ORIGIN === 'string' ? window.VYOM_API_ORIGIN.trim() : '';
    return metaOrigin || windowOrigin;
}

function getBackendOrigin() {
    const configuredOrigin = getConfiguredBackendOrigin();
    if (configuredOrigin) {
        return configuredOrigin.replace(/\/+$/, '');
    }

    if (window.location.protocol === 'file:') {
        return `http://localhost:${DEFAULT_LOCAL_BACKEND_PORT}`;
    }

    if (window.location.port === DEFAULT_LOCAL_BACKEND_PORT) {
        return window.location.origin;
    }

    if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_LOCAL_BACKEND_PORT}`;
    }

    return window.location.origin;
}

const BACKEND_ORIGIN = getBackendOrigin();

function buildBackendUrl(path) {
    const normalizedPath = String(path || '');
    if (/^https?:\/\//i.test(normalizedPath)) {
        return normalizedPath;
    }

    return new URL(normalizedPath, `${BACKEND_ORIGIN}/`).toString();
}

function getStoredToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY);
}

function getStoredUser() {
    try {
        const raw = localStorage.getItem(AUTH_USER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function saveSession(token, user) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

function clearSession() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDateTime(value) {
    if (!value) {
        return '—';
    }

    const date = new Date(value);
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function formatDate(value) {
    if (!value) {
        return '—';
    }

    const date = new Date(value);
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(date);
}

function formatMeetingDuration(startedAt, endedAt) {
    if (!startedAt || !endedAt) {
        return '—';
    }

    const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    const durationMinutes = Math.max(1, Math.round(durationMs / 60000));
    return `${durationMinutes} min`;
}

let preferredSpeakerOutputDeviceId = '';

async function applySpeakerOutputToElement(mediaElement) {
    if (!mediaElement || typeof mediaElement.setSinkId !== 'function') {
        return;
    }

    if (!preferredSpeakerOutputDeviceId) {
        return;
    }

    try {
        await mediaElement.setSinkId(preferredSpeakerOutputDeviceId);
    } catch (error) {
        console.warn('Speaker output selection failed:', error.message);
    }
}

async function requestJson(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = options.token ?? getStoredToken();

    if (token && options.auth !== false) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string') {
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(body);
    }

    const response = await fetch(buildBackendUrl(path), {
        method: options.method || 'GET',
        headers,
        body
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.message || 'Request failed.');
        error.status = response.status;
        throw error;
    }

    return data;
}

function initializeTheme() {
    const themeToggleButtons = document.querySelectorAll('#theme-toggle');
    const savedTheme = localStorage.getItem('vyomTheme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');

    function setTheme(theme) {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem('vyomTheme', theme);
        themeToggleButtons.forEach((button) => {
            button.textContent = theme === 'dark' ? '☀️' : '🌙';
        });
    }

    setTheme(initialTheme);

    themeToggleButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const currentTheme = document.documentElement.dataset.theme || 'light';
            setTheme(currentTheme === 'dark' ? 'light' : 'dark');
        });
    });
}

async function verifySession() {
    const token = getStoredToken();
    if (!token) {
        return null;
    }

    try {
        const data = await requestJson('/api/me', { token });
        saveSession(token, data.user);
        return data.user;
    } catch (error) {
        console.warn('Session verification failed:', error.message);
        clearSession();
        return null;
    }
}

function redirectToDashboard() {
    window.location.replace('dashboard.html');
}

function normalizeRoomCodeInput(rawValue) {
    let value = String(rawValue || '').trim();
    if (!value) {
        return '';
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            value = decodeURIComponent(value);
        } catch (error) {
            break;
        }
    }

    const candidates = [value];
    if (!/^https?:\/\//i.test(value) && value.includes('meeting.html?')) {
        candidates.push(`http://${value}`);
    }

    for (const candidate of candidates) {
        try {
            const parsed = new URL(candidate, window.location.origin);
            const fromQuery = parsed.searchParams.get('room');
            if (fromQuery) {
                return normalizeRoomCodeInput(fromQuery);
            }
        } catch (error) {
            // Ignore parsing issues and continue with fallback extraction.
        }
    }

    const roomMatch = value.match(/[?&]room=([^&#]+)/i);
    if (roomMatch?.[1]) {
        return normalizeRoomCodeInput(roomMatch[1]);
    }

    return value.replace(/^\/+|\/+$/g, '');
}

function redirectToMeeting(roomCode) {
    const normalizedRoomCode = normalizeRoomCodeInput(roomCode);
    window.location.replace(`meeting.html?room=${encodeURIComponent(normalizedRoomCode)}`);
}

async function handleSignOut() {
    try {
        await requestJson('/api/auth/logout', { method: 'POST' });
    } catch (error) {
        // Clear local state even if the session token is already expired.
    } finally {
        clearSession();
        window.location.replace('sign-in.html');
    }
}

function isAuthPage() {
    return Boolean(document.querySelector('.registration-form') || document.getElementById('sign-in-form'));
}

function isDashboardPage() {
    return document.body.classList.contains('dashboard-page');
}

function isMeetingPage() {
    return document.body.classList.contains('meeting-room-page');
}

async function submitAuthForm(endpoint, payload) {
    const data = await requestJson(endpoint, {
        method: 'POST',
        auth: false,
        body: payload
    });
    saveSession(data.token, data.user);
    redirectToDashboard();
}

function openCenteredPopup(url, name) {
    const width = 480;
    const height = 640;
    const left = Math.max(0, Math.round((window.screen.width - width) / 2));
    const top = Math.max(0, Math.round((window.screen.height - height) / 2));
    const features = [
        `width=${width}`,
        `height=${height}`,
        `left=${left}`,
        `top=${top}`,
        'popup=yes',
        'resizable=yes',
        'scrollbars=yes'
    ].join(',');

    return window.open(url, name, features);
}

function wireAuthPage() {
    const signupForm = document.querySelector('.registration-form');
    const socialAuthModal = document.getElementById('social-auth-modal');
    const socialAuthTitle = document.getElementById('social-auth-title');
    const socialAuthDescription = document.getElementById('social-auth-description');
    const socialAuthForm = document.getElementById('social-auth-form');
    const socialAuthEmail = document.getElementById('social-auth-email');
    const socialAuthName = document.getElementById('social-auth-name');
    const socialAuthCancel = document.getElementById('social-auth-cancel');
    const socialAuthClose = document.getElementById('social-auth-close');
    const providerFeedback = document.querySelector('.provider-feedback');
    let pendingSocialProvider = '';
    let pendingSocialPopup = null;
    let pendingSocialFlowId = '';

    function openSocialAuth(provider) {
        pendingSocialProvider = provider;
        if (socialAuthTitle) {
            socialAuthTitle.textContent = `Continue with ${provider}`;
        }
        if (socialAuthDescription) {
            socialAuthDescription.textContent = `Use your ${provider} account email to continue into Vyom.`;
        }
        if (socialAuthEmail) {
            socialAuthEmail.value = '';
            socialAuthEmail.focus();
        }
        if (socialAuthName) {
            socialAuthName.value = '';
        }
        if (providerFeedback) {
            providerFeedback.textContent = `Enter your ${provider} details to continue.`;
        }
        socialAuthModal?.classList.remove('is-hidden');
        socialAuthModal?.setAttribute('aria-hidden', 'false');
    }

    function closeSocialAuth() {
        pendingSocialProvider = '';
        socialAuthModal?.classList.add('is-hidden');
        socialAuthModal?.setAttribute('aria-hidden', 'true');
    }

    function openSocialAuthPopup(provider) {
        const mode = signupForm ? 'signup' : 'signin';
        const providerSlug = String(provider || '').toLowerCase();
        pendingSocialProvider = provider;
        pendingSocialFlowId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const popupUrl = buildBackendUrl(
            `/auth/oauth/${encodeURIComponent(providerSlug)}?flowId=${encodeURIComponent(pendingSocialFlowId)}&mode=${encodeURIComponent(mode)}&returnUrl=${encodeURIComponent(window.location.href)}`
        );
        pendingSocialPopup = openCenteredPopup(popupUrl, 'vyom-social-auth');

        if (pendingSocialPopup) {
            if (providerFeedback) {
                providerFeedback.textContent = `${provider} popup opened.`;
            }
            pendingSocialPopup.focus();
            return;
        }


        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (pendingSocialPopup) {
                    try {
                        pendingSocialPopup.close();
                        pendingSocialPopup = null;
                        if (providerFeedback) providerFeedback.textContent = 'Sign-in cancelled.';
                    } catch (err) {}
                }
                const anyModal = document.querySelector('.modal[style*="display: flex"]');
                if (anyModal) anyModal.style.display = 'none';
            }
        });

        if (providerFeedback) {
            providerFeedback.textContent = 'Popup blocked. Redirecting to secure social sign-in...';
        }
        window.location.href = popupUrl;
    }

    window.addEventListener('message', async (event) => {
        if (event.origin !== window.location.origin && event.origin !== BACKEND_ORIGIN) {
            return;
        }

        const data = event.data || {};
        if (data.type !== 'vyom-social-auth-success' && data.type !== 'vyom-social-auth-error') {
            return;
        }

        if (!pendingSocialFlowId || data.flowId !== pendingSocialFlowId) {
            return;
        }

        pendingSocialFlowId = '';
        pendingSocialProvider = '';

        if (providerFeedback) {
            providerFeedback.textContent = `Signing in with ${data.user?.provider || data.user?.email || 'social account'}...`;
        }

        try {
            pendingSocialPopup?.close();
        } catch (error) {
            // Ignore popup close issues.
        } finally {
            pendingSocialPopup = null;
        }

        if (data.type === 'vyom-social-auth-error') {
            if (providerFeedback) {
                providerFeedback.textContent = data.message || 'Social sign-in failed.';
            }
            return;
        }

        saveSession(data.token, data.user);
        redirectToDashboard();
    });

    if (signupForm) {
        signupForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const firstName = signupForm.querySelector('input[name="fname"]').value.trim();
            const lastName = signupForm.querySelector('input[name="lname"]').value.trim();
            const email = signupForm.querySelector('input[name="email"]').value.trim();
            const password = signupForm.querySelector('input[name="password"]').value;
            const confirmPassword = signupForm.querySelector('input[name="confirm-password"]')?.value;
            const termsAccepted = signupForm.querySelector('input[name="terms"]').checked;

            if (confirmPassword !== undefined && password !== confirmPassword) {
                alert('Passwords do not match. Please try again.');
                return;
            }

            if (!termsAccepted) {
                alert('Please agree to the Terms and Conditions.');
                return;
            }

            try {
                await submitAuthForm('/api/auth/register', {
                    firstName,
                    lastName,
                    email,
                    password
                });
            } catch (error) {
                if (error.message.includes('already exists')) {
                    alert('You are already signed up! Please sign in to continue.');
                    window.location.replace('sign-in.html');
                } else {
                    alert(error.message);
                }
            }
        });
    }

    const signInForm = document.getElementById('sign-in-form');
    if (signInForm) {
        signInForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const email = document.getElementById('sign-in-email').value.trim();
            const password = document.getElementById('sign-in-password').value;

            try {
                await submitAuthForm('/api/auth/login', { email, password });
            } catch (error) {
                alert(error.message || 'Invalid credentials. Please try again.');
            }
        });
    }

    const socialButtons = document.querySelectorAll('.social-button');
    socialButtons.forEach((button) => {
        button.addEventListener('click', async () => {
            const provider = button.dataset.provider || 'Social';
            openSocialAuthPopup(provider);
        });
    });

    if (socialAuthForm) {
        socialAuthForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const provider = pendingSocialProvider;
            const email = socialAuthEmail?.value.trim();
            const displayName = socialAuthName?.value.trim();
            if (!provider || !email || !displayName) {
                if (providerFeedback) {
                    providerFeedback.textContent = 'Please enter your name and email.';
                }
                return;
            }

            if (['google', 'linkedin', 'facebook'].includes(String(provider).toLowerCase())) {
                if (providerFeedback) {
                    providerFeedback.textContent = `Continue using secure ${provider} sign-in to fetch your profile photo.`;
                }
                closeSocialAuth();
                openSocialAuthPopup(provider);
                return;
            }

            if (providerFeedback) {
                providerFeedback.textContent = `Signing in with ${provider}...`;
            }

            closeSocialAuth();
            await submitAuthForm('/api/auth/social', {
                provider,
                displayName,
                email
            });
        });
    }

    socialAuthCancel?.addEventListener('click', closeSocialAuth);
    socialAuthClose?.addEventListener('click', closeSocialAuth);
    socialAuthModal?.addEventListener('click', (event) => {
        if (event.target === socialAuthModal) {
            closeSocialAuth();
        }
    });

    const passwordToggle = document.getElementById('password-visibility-toggle');
    const passwordInput = document.getElementById('password-input-field');
    if (passwordToggle && passwordInput) {
        passwordToggle.addEventListener('click', () => {
            const isHidden = passwordInput.type === 'password';
            passwordInput.type = isHidden ? 'text' : 'password';
            passwordToggle.textContent = isHidden ? '🔒' : '👁️';
        });
    }
}

function renderTeamList(teams) {
    const teamList = document.getElementById('team-list');
    if (!teamList) {
        return;
    }

    if (!teams.length) {
        teamList.innerHTML = '<div class="empty-state-card">No teams yet.</div>';
        return;
    }

    teamList.innerHTML = teams
        .map((team) => `
            <article class="team-card">
                <strong>${escapeHtml(team.name)}</strong>
                <span>${escapeHtml(team.description || 'No description')}</span>
                <small>${team.meetingCount} meetings</small>
            </article>
        `)
        .join('');
}

function renderOverview(data) {
    const teamCount = document.getElementById('dashboard-team-count');
    const upcomingCount = document.getElementById('dashboard-upcoming-count');
    const historyCount = document.getElementById('dashboard-history-count');

    if (teamCount) {
        teamCount.textContent = data.teams.length;
    }
    if (upcomingCount) {
        upcomingCount.textContent = data.upcomingMeetings.length;
    }
    if (historyCount) {
        historyCount.textContent = data.meetingHistory.length;
    }
}

function renderUpcomingMeetings(meetings) {
    const container = document.getElementById('upcoming-meetings-list');
    if (!container) {
        return;
    }

    if (!meetings.length) {
        container.innerHTML = '<div class="empty-state-card">No upcoming meetings.</div>';
        return;
    }

    container.innerHTML = meetings
        .map((meeting, index) => `
            <article class="meeting-card">
                <div class="meeting-card-top">
                    <span class="meeting-icon ${['blue', 'green', 'purple'][index % 3]}">📅</span>
                    <span class="meeting-badge">${escapeHtml(meeting.teamName)}</span>
                </div>
                <h3>${escapeHtml(meeting.title)}</h3>
                <p class="meeting-description">${escapeHtml(meeting.description || 'Ready to start.')}</p>
                <div class="meeting-meta">
                    <span>${formatDateTime(meeting.scheduledAt)}</span>
                    <span>Room: ${escapeHtml(meeting.roomCode)}</span>
                </div>
                <div class="meeting-footer">
                    <div class="avatar-stack">Live meeting</div>
                    <button class="secondary-button small-button" type="button" data-room-code="${escapeHtml(meeting.roomCode)}">Join</button>
                </div>
            </article>
        `)
        .join('');

    container.querySelectorAll('[data-room-code]').forEach((button) => {
        button.addEventListener('click', async () => {
            const roomCode = button.dataset.roomCode;
            await requestJson(`/api/meetings/${encodeURIComponent(roomCode)}/join`, { method: 'POST' });
            redirectToMeeting(roomCode);
        });
    });
}

function renderMeetingHistory(rows) {
    const body = document.getElementById('meeting-history-body');
    if (!body) {
        return;
    }

    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="5">No meeting history yet.</td></tr>';
        return;
    }

    body.innerHTML = rows
        .map((meeting) => `
            <tr>
                <td>${escapeHtml(meeting.title)}</td>
                <td>${escapeHtml(meeting.teamName)}</td>
                <td>${formatDateTime(meeting.endedAt || meeting.startedAt || meeting.scheduledAt)}</td>
                <td>${escapeHtml(meeting.status)}</td>
                <td>
                    <button class="icon-button small-button" type="button" data-room-code="${escapeHtml(meeting.roomCode)}">▶</button>
                </td>
            </tr>
        `)
        .join('');

    body.querySelectorAll('[data-room-code]').forEach((button) => {
        button.addEventListener('click', async () => {
            const roomCode = button.dataset.roomCode;
            await requestJson(`/api/meetings/${encodeURIComponent(roomCode)}/join`, { method: 'POST' });
            redirectToMeeting(roomCode);
        });
    });
}



function getParticipantKey(participant) {
    return participant.socketId || participant.userId || participant.email || participant.name;
}

function getParticipantInitials(name) {
    return String(name || '')
        .split(' ')
        .map((part) => part[0] || '')
        .join('')
        .slice(0, 2)
        .toUpperCase() || 'V';
}

function createParticipantCard(participant, variant = 'default', stream = null, isSpeaking = false, isSelf = false) {
    const card = document.createElement('article');
    card.className = `participant-card participant-card--${variant}`;
    if (isSpeaking) {
        card.classList.add('is-speaking');
    }
    if (participant.handRaised) {
        card.classList.add('is-hand-raised');
    }
    if (isSelf) {
        card.classList.add('is-self');
    }
    card.dataset.participantKey = getParticipantKey(participant);

    const initials = getParticipantInitials(participant.name);
    const hasStream = Boolean(stream);

    card.innerHTML = `
        <video class="participant-card__video ${hasStream ? '' : 'is-hidden'}" autoplay playsinline></video>
        <div class="participant-avatar participant-avatar--fallback ${hasStream ? 'is-hidden' : ''}">${escapeHtml(initials)}</div>
        ${participant.handRaised ? '<span class="raised-hand-badge" title="Hand raised" aria-label="Hand raised">✋</span>' : ''}
        ${isSelf ? '<button class="bg-effect-toggle" type="button" data-action="toggle-bg" title="Replace background" aria-label="Replace background" aria-pressed="false">🪄</button>' : ''}
        <div class="participant-card__footer">
            <strong>${escapeHtml(participant.name)}</strong>
            <span>${participant.isHost ? 'Host' : participant.handRaised ? 'Hand raised' : 'Participant'}</span>
        </div>
        <div class="participant-card__actions">
            <span>${participant.audioEnabled ? '🎙️' : '🔇'}</span>
            <span>${participant.videoEnabled ? '📷' : '🚫'}</span>
        </div>
    `;

    const video = card.querySelector('video');
    if (video && stream) {
        video.srcObject = stream;
        video.classList.add('is-mirrored');
        video.play().catch(() => {});
        applySpeakerOutputToElement(video);
    }

    return card;
}

function createPlaceholderParticipant(label) {
    return {
        name: label,
        isHost: false,
        audioEnabled: true,
        videoEnabled: false,
        handRaised: false
    };
}

function updateSpeakerStage(state, currentUser, localStream, activeStream, shouldMirror = true) {
    const speakerName = document.getElementById('active-speaker-name');
    const speakerStatus = document.getElementById('active-speaker-status');
    const speakerAvatar = document.getElementById('active-speaker-avatar');
    const speakerVideo = document.getElementById('active-speaker-video');
    const speakerHandBadge = document.getElementById('stage-hand-badge');

    const activeSpeaker = state.activeSpeaker || state.participants[0] || {
        name: currentUser.name,
        audioEnabled: true,
        videoEnabled: false,
        handRaised: false
    };

    if (speakerHandBadge) {
        speakerHandBadge.classList.toggle('is-hidden', !activeSpeaker.handRaised);
    }

    if (speakerName) {
        speakerName.textContent = activeSpeaker.name;
    }
    if (speakerStatus) {
        speakerStatus.textContent = state.participantCount
            ? `${state.participantCount} participant${state.participantCount === 1 ? '' : 's'} in the room`
            : 'Waiting for participants to join.';
    }

    const stageStream = activeStream || localStream || null;
    if (stageStream && speakerVideo && speakerAvatar) {
        speakerVideo.srcObject = stageStream;
        speakerVideo.classList.toggle('is-mirrored', shouldMirror);
        speakerVideo.classList.remove('is-hidden');
        speakerAvatar.classList.add('is-hidden');
        applySpeakerOutputToElement(speakerVideo);
    } else if (speakerVideo && speakerAvatar) {
        speakerVideo.srcObject = null;
        speakerVideo.classList.add('is-hidden');
        speakerAvatar.classList.remove('is-hidden');
    }
}

async function setupLocalMedia() {
    if (!navigator.mediaDevices?.getUserMedia) {
        return null;
    }

    try {
        return await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true
        });
    } catch (error) {
        console.warn('Local media access failed:', error.message);
        return null;
    }
}

async function loadMeetingPage(user) {
    const params = new URLSearchParams(window.location.search);
    const rawRoomCode = params.get('room');
    const roomCode = normalizeRoomCodeInput(rawRoomCode);

    if (!roomCode) {
        redirectToDashboard();
        return;
    }

    if (rawRoomCode && roomCode !== rawRoomCode) {
        const nextUrl = `${window.location.pathname}?room=${encodeURIComponent(roomCode)}`;
        window.history.replaceState({}, '', nextUrl);
    }

    const roomData = await requestJson(`/api/meetings/${encodeURIComponent(roomCode)}`);
    if (roomData.meeting.status === 'ended') {
        const error = new Error('This meeting has ended.');
        error.status = 409;
        throw error;
    }

    // Prevent navigating back to dashboard unintentionally while in meeting.
    window.history.pushState({ inMeeting: true }, '', window.location.href);
    const handleMeetingBackNavigation = () => {
        if (activeRoomCode) {
            alert('You are still in the meeting. Please use the "End" or "Leave" button to exit.');
            window.history.pushState({ inMeeting: true }, '', window.location.href);
        }
    };
    window.addEventListener('popstate', handleMeetingBackNavigation);

    const meetingTitle = document.getElementById('meeting-room-title');
    const meetingSubtitle = document.getElementById('meeting-room-subtitle');
    if (meetingTitle) {
        meetingTitle.textContent = roomData.meeting.title;
    }
    if (meetingSubtitle) {
        meetingSubtitle.textContent = `${roomData.meeting.teamName} • ${roomData.meeting.roomCode}`;
    }

    const downloadAttendanceBtn = document.getElementById('download-attendance-button');
    if (downloadAttendanceBtn && roomData.meeting.hostUserId === user.id) {
        downloadAttendanceBtn.style.display = '';
    }

    let localStream = await setupLocalMedia();
    const socket = window.io(BACKEND_ORIGIN, {
        auth: {
            token: getStoredToken()
        }
    });

    const leftStack = document.getElementById('left-participant-stack');
    const rightStack = document.getElementById('right-participant-stack');
    const participantsDrawer = document.getElementById('participants-drawer');
    const participantsDrawerList = document.getElementById('participants-drawer-list');
    const participantsDrawerClose = document.getElementById('participants-drawer-close');
    const participantsDrawerCount = document.getElementById('participants-drawer-count');
    const participantsSearchInput = document.getElementById('participants-search');
    const chatDrawer = document.getElementById('chat-drawer');
    const chatDrawerClose = document.getElementById('chat-drawer-close');
    const chatMessageList = document.getElementById('chat-message-list');
    const chatComposer = document.getElementById('chat-composer');
    const chatMessageInput = document.getElementById('chat-message-input');
    const devicePanel = document.getElementById('device-panel');
    const devicePanelClose = document.getElementById('device-panel-close');
    const microphoneSelect = document.getElementById('microphone-device-select');
    const cameraSelect = document.getElementById('camera-device-select');
    const speakerOutputSelect = document.getElementById('speaker-output-device-select');
    const refreshDeviceListButton = document.getElementById('refresh-device-list-button');
    const participantsButton = document.getElementById('participants-button');
    const chatButton = document.getElementById('chat-button');
    const moreButton = document.getElementById('more-button');
    const speakerSettingsButton = document.getElementById('speaker-settings-button');
    const participantsBadge = document.getElementById('participants-count-badge');
    const chatUnreadBadge = document.getElementById('chat-unread-badge');
    const participantsRoomTitle = document.getElementById('participants-room-title');
    const participantsRoomCode = document.getElementById('participants-room-code');
    const meetingCopyLinkButton = document.getElementById('meeting-copy-link-button');
    const meetingFullscreenButton = document.getElementById('meeting-fullscreen-button');
    const meetingExitFullscreenButton = document.getElementById('meeting-exit-fullscreen-button');
    const meetingRoomShell = document.querySelector('.meeting-room-shell');
    const morePanel = document.getElementById('more-panel');
    const morePanelClose = document.getElementById('more-panel-close');
    const shareScreenOptionButton = document.getElementById('share-screen-option');
    const shareWindowOptionButton = document.getElementById('share-window-option');
    const shareTabOptionButton = document.getElementById('share-tab-option');
    const stopShareOptionButton = document.getElementById('stop-share-option');
    const openWhiteboardButton = document.getElementById('open-whiteboard-button');
    const aiSuggestionsButton = document.getElementById('ai-suggestions-button');
    const stageBgToggle = document.getElementById('stage-bg-toggle');
    const handsChip = document.getElementById('meeting-hands-chip');
    const handsChipCount = document.getElementById('meeting-hands-count');
    const captionsButton = document.getElementById('captions-button');
    const downloadAttendanceButton = document.getElementById('download-attendance-button');
    const captionsOverlay = document.getElementById('captions-overlay');
    const captionsDrawer = document.getElementById('captions-drawer');
    const captionsDrawerClose = document.getElementById('captions-drawer-close');
    const captionsLanguageSelect = document.getElementById('captions-language-select');
    const captionsTranslationLanguageSelect = document.getElementById('captions-translation-language-select');
    const captionsTranslation = document.getElementById('captions-translation');
    const chatCreatePollButton = document.getElementById('chat-create-poll-button');
    const aiSuggestionsList = document.getElementById('ai-suggestions-list');
    const chatAttachImageButton = document.getElementById('chat-attach-image-button');
    const chatAttachFileButton = document.getElementById('chat-attach-file-button');
    const imageShareInput = document.getElementById('image-share-input');
    const fileShareInput = document.getElementById('file-share-input');
    const whiteboardPanel = document.getElementById('whiteboard-panel');
    const whiteboardCloseButton = document.getElementById('whiteboard-close-button');
    const whiteboardCanvas = document.getElementById('whiteboard-canvas');
    const whiteboardClearButton = document.getElementById('whiteboard-clear-button');
    const whiteboardStatus = document.getElementById('whiteboard-status');
    const whiteboardSizeInput = document.getElementById('whiteboard-size');
    const whiteboardColorButtons = Array.from(document.querySelectorAll('[data-whiteboard-color]'));
    const timerElement = document.getElementById('meeting-timer');
    const muteToggleButton = document.getElementById('mute-toggle-button');
    const cameraToggleButton = document.getElementById('camera-toggle-button');
    const screenShareButton = document.getElementById('screen-share-button');
    const raiseHandButton = document.getElementById('raise-hand-button');
    const leaveMeetingButton = document.getElementById('leave-meeting-button');

    const remoteStreams = new Map();
    const peerConnections = new Map();
    const pendingOfferPeers = new Set();
    const audioAnalyzers = new Map();
    const participantAudioLevels = new Map();
    const chatMessages = [];
    const roomState = {
        participants: [],
        activeSpeaker: null,
        selectedDrawer: null,
        unreadChatCount: 0,
        whiteboard: {
            strokes: []
        }
    };
    let currentRoomParticipants = [];
    let activeRoomCode = roomCode;
    let currentLocalSocketId = null;
    let screenShareStream = null;
    let audioEnabled = true;
    let videoEnabled = Boolean(localStream);
    let localAudioDeviceId = '';
    let localVideoDeviceId = '';
    let localSpeakerOutputDeviceId = '';
    let audioContext = null;
    let audioLevelTimer = null;
    let whiteboardContext = null;
    let whiteboardResizeTimer = null;
    let isCaptionsEnabled = false;
    let recognition = null;
    let transcriptText = '';
    let finalTranscriptText = '';
    let translationRequestId = 0;
    const isLocalHost = roomData?.meeting?.hostUserId === user.id;
    const virtualBackground = {
        enabled: false,
        busy: false,
        running: false,
        sending: false,
        lastResultAt: 0,
        watchdog: null,
        segmenter: null,
        sourceVideo: null,
        canvas: null,
        ctx: null,
        rawTrack: null,
        outputTrack: null
    };
    const whiteboardState = {
        isOpen: false,
        activeColor: '#3af6ff',
        lineWidth: 4,
        currentStroke: null
    };

    function getPeerKey(participant) {
        if (!participant) {
            return '';
        }

        return participant.socketId || participant.userId || participant.email || participant.name;
    }

    function isSelfParticipant(participant) {
        if (!participant) {
            return false;
        }

        return (currentLocalSocketId && participant.socketId === currentLocalSocketId)
            || (Boolean(participant.email) && participant.email === user.email);
    }

    function refreshBackgroundToggleUi() {
        const label = virtualBackground.enabled ? 'Restore real background' : 'Replace background';
        document.querySelectorAll('[data-action="toggle-bg"]').forEach((toggle) => {
            toggle.classList.toggle('is-active', virtualBackground.enabled);
            toggle.setAttribute('aria-pressed', String(virtualBackground.enabled));
            toggle.setAttribute('title', label);
            toggle.setAttribute('aria-label', label);
        });
    }

    function swapLocalVideoTrack(nextTrack) {
        const audioTracks = localStream ? localStream.getAudioTracks() : [];
        localStream = new MediaStream(nextTrack ? [...audioTracks, nextTrack] : audioTracks);
        refreshOutgoingVideoTrack();
        renderMeetingState();
    }

    async function ensureSegmenter() {
        if (virtualBackground.segmenter) {
            return virtualBackground.segmenter;
        }

        if (typeof SelfieSegmentation === 'undefined') {
            throw new Error('Background effects could not load. Check your connection and try again.');
        }

        const segmenter = new SelfieSegmentation({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/${file}`
        });
        segmenter.setOptions({ modelSelection: 1, selfieMode: false });
        segmenter.onResults(drawSegmentedFrame);
        virtualBackground.segmenter = segmenter;
        return segmenter;
    }

    // Keeps the segmented person pixels and paints a clean white plate behind them.
    function drawSegmentedFrame(results) {
        const { canvas, ctx } = virtualBackground;
        if (!canvas || !ctx || !results?.image || !results?.segmentationMask) {
            return;
        }

        virtualBackground.lastResultAt = Date.now();
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-in';
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
    }

    // Falls back to the untouched camera frame so the tile is never blank while the model warms up.
    function drawPassthroughFrame() {
        const { canvas, ctx, sourceVideo } = virtualBackground;
        if (!canvas || !ctx || !sourceVideo || sourceVideo.readyState < 2) {
            return;
        }

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
        ctx.restore();
    }

    async function pumpSegmentationFrames() {
        if (!virtualBackground.running) {
            return;
        }

        const { segmenter, sourceVideo } = virtualBackground;
        if (Date.now() - virtualBackground.lastResultAt > 300) {
            drawPassthroughFrame();
        }

        try {
            if (segmenter && sourceVideo && sourceVideo.readyState >= 2 && !virtualBackground.sending) {
                virtualBackground.sending = true;
                await segmenter.send({ image: sourceVideo });
            }
        } catch (error) {
            console.warn('Background segmentation frame failed:', error.message);
        } finally {
            virtualBackground.sending = false;
        }

        if (virtualBackground.running) {
            requestAnimationFrame(() => {
                pumpSegmentationFrames();
            });
        }
    }

    async function enableVirtualBackground() {
        const rawTrack = localStream?.getVideoTracks()?.[0];
        if (!rawTrack) {
            throw new Error('Turn your camera on before changing the background.');
        }

        const segmenter = await ensureSegmenter();
        const sourceVideo = document.createElement('video');
        sourceVideo.className = 'vb-source-video';
        sourceVideo.playsInline = true;
        sourceVideo.muted = true;
        sourceVideo.autoplay = true;
        sourceVideo.srcObject = new MediaStream([rawTrack]);
        document.body.appendChild(sourceVideo);
        await sourceVideo.play();
        await waitForVideoFrame(sourceVideo);

        const canvas = document.createElement('canvas');
        canvas.width = sourceVideo.videoWidth || 640;
        canvas.height = sourceVideo.videoHeight || 480;

        virtualBackground.segmenter = segmenter;
        virtualBackground.rawTrack = rawTrack;
        virtualBackground.sourceVideo = sourceVideo;
        virtualBackground.canvas = canvas;
        virtualBackground.ctx = canvas.getContext('2d');
        virtualBackground.lastResultAt = 0;
        virtualBackground.sending = false;
        virtualBackground.running = true;
        drawPassthroughFrame();
        pumpSegmentationFrames();

        const outputTrack = canvas.captureStream(24).getVideoTracks()[0];
        outputTrack.enabled = videoEnabled;
        virtualBackground.outputTrack = outputTrack;
        virtualBackground.enabled = true;
        swapLocalVideoTrack(outputTrack);

        virtualBackground.watchdog = window.setTimeout(() => {
            if (virtualBackground.enabled && !virtualBackground.lastResultAt) {
                disableVirtualBackground();
                refreshBackgroundToggleUi();
                alert('Background effects could not start on this device, so your normal camera is back on.');
            }
        }, 8000);
    }

    function waitForVideoFrame(video) {
        if (video.readyState >= 2 && video.videoWidth) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            const done = () => {
                video.removeEventListener('loadeddata', done);
                resolve();
            };
            video.addEventListener('loadeddata', done);
            window.setTimeout(done, 3000);
        });
    }

    function disableVirtualBackground() {
        virtualBackground.running = false;
        virtualBackground.enabled = false;
        virtualBackground.sending = false;
        virtualBackground.lastResultAt = 0;
        if (virtualBackground.watchdog) {
            window.clearTimeout(virtualBackground.watchdog);
            virtualBackground.watchdog = null;
        }
        virtualBackground.outputTrack?.stop();
        virtualBackground.outputTrack = null;

        if (virtualBackground.sourceVideo) {
            virtualBackground.sourceVideo.pause();
            virtualBackground.sourceVideo.srcObject = null;
            virtualBackground.sourceVideo.remove();
            virtualBackground.sourceVideo = null;
        }

        const rawTrack = virtualBackground.rawTrack;
        virtualBackground.rawTrack = null;
        virtualBackground.canvas = null;
        virtualBackground.ctx = null;

        if (rawTrack && rawTrack.readyState === 'live') {
            rawTrack.enabled = videoEnabled;
            swapLocalVideoTrack(rawTrack);
        }
    }

    async function toggleVirtualBackground() {
        if (virtualBackground.busy) {
            return;
        }

        virtualBackground.busy = true;
        try {
            if (virtualBackground.enabled) {
                disableVirtualBackground();
            } else {
                await enableVirtualBackground();
            }
        } catch (error) {
            disableVirtualBackground();
            alert(error.message || 'Unable to change the background.');
        } finally {
            virtualBackground.busy = false;
            refreshBackgroundToggleUi();
        }
    }

    function getStreamForParticipant(participant) {
        if (!participant) {
            return null;
        }

        if (participant.socketId === currentLocalSocketId) {
            return screenShareStream || localStream || null;
        }

        return remoteStreams.get(participant.socketId) || null;
    }

    function ensureAudioContext() {
        if (!audioContext && (window.AudioContext || window.webkitAudioContext)) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().catch(() => {});
        }
    }

    function disconnectAudioAnalyzer(key) {
        const entry = audioAnalyzers.get(key);
        if (!entry) {
            return;
        }

        try {
            entry.source.disconnect();
            entry.analyser.disconnect();
        } catch (error) {
            console.warn('Audio analyzer cleanup failed:', error.message);
        }
        audioAnalyzers.delete(key);
        participantAudioLevels.delete(key);
    }

    function connectAudioAnalyzer(key, stream) {
        if (!audioContext || !stream || !stream.getAudioTracks().length) {
            disconnectAudioAnalyzer(key);
            return;
        }

        disconnectAudioAnalyzer(key);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.85;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        audioAnalyzers.set(key, {
            source,
            analyser,
            data: new Uint8Array(analyser.fftSize)
        });
    }

    function refreshLocalAudioAnalyser() {
        if (!audioContext || !localStream) {
            return;
        }

        connectAudioAnalyzer(currentLocalSocketId || 'local-user', localStream);
    }

    function sampleParticipantAudioLevels() {
        let changed = false;

        audioAnalyzers.forEach((entry, key) => {
            entry.analyser.getByteTimeDomainData(entry.data);
            let sum = 0;
            for (let i = 0; i < entry.data.length; i += 1) {
                const centered = (entry.data[i] - 128) / 128;
                sum += centered * centered;
            }
            const level = Math.min(1, Math.sqrt(sum / entry.data.length));
            const previous = participantAudioLevels.get(key) || 0;
            if (Math.abs(previous - level) > 0.01) {
                changed = true;
            }
            participantAudioLevels.set(key, level);
        });

        const nextActiveSpeaker = getMostActiveSpeaker(currentRoomParticipants);
        if (getPeerKey(nextActiveSpeaker) !== getPeerKey(roomState.activeSpeaker)) {
            roomState.activeSpeaker = nextActiveSpeaker;
            changed = true;
        }

        if (changed) {
            renderMeetingState();
        }
    }

    function getParticipantAudioLevel(participant) {
        return participantAudioLevels.get(getPeerKey(participant)) || 0;
    }

    function getMostActiveSpeaker(participants) {
        const scored = participants.map((participant) => ({
            participant,
            score: getParticipantAudioLevel(participant) + (participant.videoEnabled ? 0.05 : 0) + (participant.isHost ? 0.02 : 0)
        }));

        scored.sort((left, right) => right.score - left.score);
        const best = scored[0]?.participant || null;
        if (best && scored[0].score >= 0.05) {
            return best;
        }

        return participants.find((participant) => participant.socketId === currentLocalSocketId)
            || participants.find((participant) => participant.isHost)
            || participants[0]
            || null;
    }

    function getScreenShareConstraints(mode = 'screen') {
        const video = mode === 'window'
            ? {
                displaySurface: 'window',
                logicalSurface: true,
                surfaceSwitching: 'include'
            }
            : mode === 'tab'
                ? {
                    displaySurface: 'browser',
                    preferCurrentTab: true,
                    selfBrowserSurface: 'include',
                    logicalSurface: true,
                    surfaceSwitching: 'include'
                }
                : {
                    displaySurface: 'monitor',
                    logicalSurface: true,
                    surfaceSwitching: 'include'
                };

        return {
            video,
            audio: mode === 'tab'
        };
    }

    function updateScreenShareButtonLabel() {
        if (!screenShareButton) {
            return;
        }

        const isSharing = Boolean(screenShareStream);
        screenShareButton.innerHTML = `<span>${isSharing ? '🛑' : '🖥️'}</span><strong>${isSharing ? 'Stop' : 'Share'}</strong>`;
    }

    function closeMeetingSidePanels() {
        setDrawerState('participants', false);
        setDrawerState('chat', false);
        setDrawerState('devices', false);
        setDrawerState('more', false);
    }

    function openMorePanel() {
        closeMeetingSidePanels();
        setDrawerState('more', true);
    }

    function closeMorePanel() {
        setDrawerState('more', false);
    }

    function updateWhiteboardStatus(text) {
        if (whiteboardStatus) {
            whiteboardStatus.textContent = text;
        }
    }

    function updateWhiteboardToolbar() {
        whiteboardColorButtons.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.whiteboardColor === whiteboardState.activeColor);
            button.style.background = button.dataset.whiteboardColor;
        });

        if (whiteboardSizeInput) {
            whiteboardSizeInput.value = String(whiteboardState.lineWidth);
        }
    }

    function getWhiteboardCanvasContext() {
        if (!whiteboardCanvas) {
            return null;
        }

        if (!whiteboardContext) {
            whiteboardContext = whiteboardCanvas.getContext('2d');
        }

        return whiteboardContext;
    }

    function resizeWhiteboardCanvas() {
        if (!whiteboardCanvas) {
            return;
        }

        const ratio = window.devicePixelRatio || 1;
        const { width, height } = whiteboardCanvas.getBoundingClientRect();
        if (!width || !height) {
            return;
        }

        whiteboardCanvas.width = Math.round(width * ratio);
        whiteboardCanvas.height = Math.round(height * ratio);
        const context = getWhiteboardCanvasContext();
        if (context) {
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
        redrawWhiteboardCanvas();
    }

    function normalizeWhiteboardPoint(event) {
        if (!whiteboardCanvas) {
            return null;
        }

        const rect = whiteboardCanvas.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return null;
        }

        return {
            x: (event.clientX - rect.left) / rect.width,
            y: (event.clientY - rect.top) / rect.height
        };
    }

    function drawWhiteboardStroke(context, stroke) {
        if (!context || !stroke?.points?.length) {
            return;
        }

        context.strokeStyle = stroke.color;
        context.fillStyle = stroke.color;
        context.lineWidth = stroke.size;
        context.lineCap = 'round';
        context.lineJoin = 'round';

        const firstPoint = stroke.points[0];
        context.beginPath();
        context.moveTo(firstPoint.x * whiteboardCanvas.clientWidth, firstPoint.y * whiteboardCanvas.clientHeight);
        for (let index = 1; index < stroke.points.length; index += 1) {
            const point = stroke.points[index];
            context.lineTo(point.x * whiteboardCanvas.clientWidth, point.y * whiteboardCanvas.clientHeight);
        }
        if (stroke.points.length === 1) {
            context.arc(
                firstPoint.x * whiteboardCanvas.clientWidth,
                firstPoint.y * whiteboardCanvas.clientHeight,
                stroke.size / 2,
                0,
                Math.PI * 2
            );
            context.fill();
            return;
        }
        context.stroke();
    }

    function redrawWhiteboardCanvas() {
        const context = getWhiteboardCanvasContext();
        if (!context || !whiteboardCanvas) {
            return;
        }

        context.clearRect(0, 0, whiteboardCanvas.clientWidth, whiteboardCanvas.clientHeight);
        roomState.whiteboard.strokes.forEach((stroke) => drawWhiteboardStroke(context, stroke));
        if (whiteboardState.currentStroke) {
            drawWhiteboardStroke(context, whiteboardState.currentStroke);
        }
        if (whiteboardState.isOpen) {
            updateWhiteboardStatus(`${roomState.whiteboard.strokes.length} stroke${roomState.whiteboard.strokes.length === 1 ? '' : 's'} shared`);
        }
    }

    function emitWhiteboardState(eventName, payload = {}) {
        socket.emit(eventName, {
            roomCode: activeRoomCode,
            ...payload
        });
    }

    function openWhiteboard() {
        if (!whiteboardPanel) {
            return;
        }

        closeMeetingSidePanels();
        whiteboardState.isOpen = true;
        whiteboardPanel.classList.add('meeting-whiteboard-panel--open');
        whiteboardPanel.setAttribute('aria-hidden', 'false');
        updateWhiteboardStatus('Ready to draw with the room.');
        updateWhiteboardToolbar();
        requestAnimationFrame(() => {
            resizeWhiteboardCanvas();
        });
    }

    function closeWhiteboard() {
        if (!whiteboardPanel) {
            return;
        }

        whiteboardState.isOpen = false;
        whiteboardPanel.classList.remove('meeting-whiteboard-panel--open');
        whiteboardPanel.setAttribute('aria-hidden', 'true');
        updateWhiteboardStatus('Ready to draw with the room.');
    }

    function generateAiSuggestions() {
        const participantCount = currentRoomParticipants.length || roomState.participants.length || 1;
        const suggestions = [
            `Summarize the meeting for ${roomData.meeting.title}.`,
            `Ask each of the ${participantCount} participants for blockers.`,
            `Capture clear action items before ending the call.`,
            `Use the whiteboard to collect decisions and next steps.`
        ];

        if (aiSuggestionsList) {
            aiSuggestionsList.innerHTML = suggestions.map((suggestion) => `
                <button class="drawer-detail-card ai-suggestion-chip" type="button" data-ai-suggestion="${escapeHtml(suggestion)}">
                    ${escapeHtml(suggestion)}
                </button>
            `).join('');

            aiSuggestionsList.querySelectorAll('[data-ai-suggestion]').forEach((button) => {
                button.addEventListener('click', () => {
                    if (chatMessageInput) {
                        chatMessageInput.value = button.dataset.aiSuggestion;
                    }
                    setDrawerState('chat', true);
                    setDrawerState('more', false);
                    chatMessageInput?.focus();
                });
            });
        }

        return suggestions;
    }

    function parseAttachmentMessage(message) {
        try {
            const parsed = JSON.parse(message);
            if (parsed && parsed.kind === 'attachment') {
                return parsed;
            }
        } catch (error) {
            return null;
        }

        return null;
    }

    function formatAttachmentSize(size) {
        if (!Number.isFinite(size)) {
            return 'Unknown size';
        }

        if (size < 1024) {
            return `${size} B`;
        }

        if (size < 1024 * 1024) {
            return `${Math.round(size / 1024)} KB`;
        }

        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    function renderAttachmentCard(message, isSelf) {
        const kind = message.attachmentType || (message.mimeType?.startsWith('image/') ? 'image' : 'file');
        const safeFileName = escapeHtml(message.fileName || 'Attachment');
        const sizeLabel = formatAttachmentSize(message.size);
        if (kind === 'image') {
            return `
                <div class="chat-message__attachment">
                    <strong>${safeFileName}</strong>
                    <img src="${message.dataUrl}" alt="${safeFileName}">
                    <span>${escapeHtml(message.mimeType || 'Image')} • ${escapeHtml(sizeLabel)}</span>
                    <a href="${message.dataUrl}" download="${safeFileName}" style="display: block; margin-top: 4px; font-size: 0.8rem; font-weight: 500;">Download Image</a>
                </div>
            `;
        }

        return `
            <div class="chat-message__attachment">
                <strong>${safeFileName}</strong>
                <span>${escapeHtml(message.mimeType || 'File')} • ${escapeHtml(sizeLabel)}</span>
                <a href="${message.dataUrl}" download="${safeFileName}">Download file</a>
            </div>
        `;
    }

    function sendAttachment(file, attachmentType) {
        if (!file) {
            return;
        }

        const maxSize = 2 * 1024 * 1024;
        if (file.size > maxSize) {
            alert('Please share files under 2 MB so everyone in the meeting can open them quickly.');
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const payload = {
                kind: 'attachment',
                attachmentType,
                fileName: file.name,
                mimeType: file.type || (attachmentType === 'image' ? 'image/*' : 'application/octet-stream'),
                size: file.size,
                dataUrl: reader.result,
                senderName: user.name,
                createdAt: new Date().toISOString()
            };

            socket.emit('meeting:chat-message', {
                roomCode: activeRoomCode,
                message: JSON.stringify(payload)
            });
        };
        reader.readAsDataURL(file);
    }

    async function startScreenShare(mode = 'screen') {
        if (screenShareStream) {
            return;
        }

        if (!navigator.mediaDevices?.getDisplayMedia) {
            alert('Screen sharing is not supported in this browser.');
            return;
        }

        try {
            screenShareStream = await navigator.mediaDevices.getDisplayMedia(getScreenShareConstraints(mode));
            updateScreenShareButtonLabel();
            refreshOutgoingVideoTrack();
            renderMeetingState();
            const [track] = screenShareStream.getVideoTracks();
            if (track) {
                track.addEventListener('ended', () => {
                    stopScreenShare();
                });
            }
        } catch (error) {
            screenShareStream = null;
            updateScreenShareButtonLabel();
            console.warn('Screen share failed:', error.message);
        }
    }

    function stopScreenShare() {
        if (!screenShareStream) {
            return;
        }

        screenShareStream.getTracks().forEach((track) => track.stop());
        screenShareStream = null;
        updateScreenShareButtonLabel();
        refreshOutgoingVideoTrack();
        renderMeetingState();
    }

    function toggleWhiteboardStroke(point) {
        if (!whiteboardState.currentStroke) {
            return;
        }

        whiteboardState.currentStroke.points.push(point);
        redrawWhiteboardCanvas();
    }

    function beginWhiteboardStroke(event) {
        if (!whiteboardState.isOpen || !whiteboardCanvas) {
            return;
        }

        const point = normalizeWhiteboardPoint(event);
        if (!point) {
            return;
        }

        whiteboardState.currentStroke = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            color: whiteboardState.activeColor,
            size: whiteboardState.lineWidth,
            points: [point]
        };
        whiteboardCanvas.setPointerCapture?.(event.pointerId);
        redrawWhiteboardCanvas();
    }

    function continueWhiteboardStroke(event) {
        if (!whiteboardState.currentStroke) {
            return;
        }

        const point = normalizeWhiteboardPoint(event);
        if (!point) {
            return;
        }

        toggleWhiteboardStroke(point);
    }

    function finishWhiteboardStroke(event) {
        if (!whiteboardState.currentStroke) {
            return;
        }

        const point = normalizeWhiteboardPoint(event);
        if (point) {
            toggleWhiteboardStroke(point);
        }

        const stroke = whiteboardState.currentStroke;
        whiteboardState.currentStroke = null;
        if (stroke.points.length) {
            roomState.whiteboard.strokes.push(stroke);
            emitWhiteboardState('meeting:whiteboard-stroke', { stroke });
        }
        redrawWhiteboardCanvas();
    }

    function setDrawerState(drawerName, isOpen) {
        roomState.selectedDrawer = isOpen ? drawerName : null;
        if (participantsDrawer) {
            participantsDrawer.classList.toggle('meeting-drawer--open', drawerName === 'participants' && isOpen);
            participantsDrawer.setAttribute('aria-hidden', String(!(drawerName === 'participants' && isOpen)));
        }
        if (chatDrawer) {
            chatDrawer.classList.toggle('meeting-drawer--open', drawerName === 'chat' && isOpen);
            chatDrawer.setAttribute('aria-hidden', String(!(drawerName === 'chat' && isOpen)));
        }
        if (devicePanel) {
            devicePanel.classList.toggle('meeting-device-panel--open', drawerName === 'devices' && isOpen);
            devicePanel.setAttribute('aria-hidden', String(!(drawerName === 'devices' && isOpen)));
        }
        if (morePanel) {
            morePanel.classList.toggle('meeting-drawer--open', drawerName === 'more' && isOpen);
            morePanel.setAttribute('aria-hidden', String(!(drawerName === 'more' && isOpen)));
        }
        if (captionsDrawer) {
            captionsDrawer.classList.toggle('meeting-drawer--open', drawerName === 'captions' && isOpen);
            captionsDrawer.setAttribute('aria-hidden', String(!(drawerName === 'captions' && isOpen)));
            if (!(drawerName === 'captions' && isOpen)) {
                // Keep the button toggle in sync when drawer is closed via other means
                if (isCaptionsEnabled) {
                    isCaptionsEnabled = false;
                    captionsButton.classList.remove('is-active');
                    if (recognition) recognition.stop();
                    if (captionsOverlay) captionsOverlay.textContent = '';
                }
            }
        }

        if (isOpen) {
            closeWhiteboard();
        }

        if (drawerName === 'chat' && isOpen) {
            roomState.unreadChatCount = 0;
            updateDrawerBadges();
            renderChatDrawer();
        }
    }

    function updateFullscreenButton() {
        if (!meetingFullscreenButton) {
            return;
        }

        const isFullscreen = Boolean(document.fullscreenElement);
        meetingFullscreenButton.textContent = isFullscreen ? '❐' : '⛶';
        meetingFullscreenButton.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
        meetingFullscreenButton.setAttribute('title', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');

        if (meetingExitFullscreenButton) {
            meetingExitFullscreenButton.classList.toggle('is-hidden', !isFullscreen);
        }
    }

    async function toggleFullscreen() {
        const fullscreenTarget = meetingRoomShell || document.documentElement;
        if (!document.fullscreenElement) {
            if (fullscreenTarget.requestFullscreen) {
                await fullscreenTarget.requestFullscreen();
            }
            return;
        }

        if (document.exitFullscreen) {
            await document.exitFullscreen();
        }
    }

    async function copyMeetingLink() {
        const meetingLink = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(normalizeRoomCodeInput(activeRoomCode))}`;
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(meetingLink);
        } else {
            const tempInput = document.createElement('input');
            tempInput.value = meetingLink;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand('copy');
            tempInput.remove();
        }

        alert('Meeting link copied.');
    }

    function wireDrawerSwipeToClose(drawerElement, drawerName) {
        if (!drawerElement) {
            return;
        }

        let localSwipeStartY = null;
        const startHandler = (event) => {
            localSwipeStartY = event.touches[0].clientY;
        };

        const endHandler = (event) => {
            if (localSwipeStartY === null) {
                return;
            }

            const deltaY = event.changedTouches[0].clientY - localSwipeStartY;
            localSwipeStartY = null;
            if (deltaY > 60) {
                setDrawerState(drawerName, false);
            }
        };

        drawerElement.addEventListener('touchstart', startHandler, { passive: true });
        drawerElement.addEventListener('touchend', endHandler);
    }

    function updateDrawerBadges() {
        if (participantsBadge) {
            participantsBadge.textContent = String(currentRoomParticipants.length);
        }
        if (participantsDrawerCount) {
            participantsDrawerCount.textContent = `${currentRoomParticipants.length} people in room`;
        }
        if (chatUnreadBadge) {
            chatUnreadBadge.textContent = String(roomState.unreadChatCount);
        }
        const handsRaisedBadge = document.getElementById('hands-raised-badge');
        const raisedCount = currentRoomParticipants.filter((participant) => participant.handRaised).length;
        if (handsRaisedBadge) {
            handsRaisedBadge.textContent = String(raisedCount);
            handsRaisedBadge.style.display = raisedCount > 0 ? '' : 'none';
        }
        if (handsChip) {
            handsChip.classList.toggle('is-hidden', !isLocalHost || raisedCount === 0);
        }
        if (handsChipCount) {
            handsChipCount.textContent = String(raisedCount);
        }
    }

    function renderParticipantsDrawer() {
        if (!participantsDrawerList) {
            return;
        }

        if (participantsRoomTitle) {
            participantsRoomTitle.textContent = roomData.meeting.title;
        }
        if (participantsRoomCode) {
            participantsRoomCode.textContent = roomData.meeting.roomCode;
        }

        const query = String(participantsSearchInput?.value || '').trim().toLowerCase();
        const filtered = currentRoomParticipants.filter((participant) => {
            const haystack = [participant.name, participant.email, participant.isHost ? 'host' : '', participant.handRaised ? 'hand raised' : '']
                .join(' ')
                .toLowerCase();
            return !query || haystack.includes(query);
        });

        if (!filtered.length) {
            participantsDrawerList.innerHTML = '<div class="drawer-detail-card">No participants found.</div>';
            return;
        }

        participantsDrawerList.innerHTML = filtered.map((participant) => {
            const speaking = getPeerKey(roomState.activeSpeaker) === getPeerKey(participant);
            const micIcon = participant.audioEnabled ? '🎙️' : '🔇';
            const cameraIcon = participant.videoEnabled ? '📷' : '🚫';
            return `
                <div class="participant-row ${speaking ? 'is-speaking' : ''}">
                    <div>
                        <strong>${escapeHtml(participant.name)}</strong>
                        <span>${escapeHtml(participant.email || 'No email')}</span>
                    </div>
                    <div class="participant-row__status">
                        <span>${participant.isHost ? 'Host' : 'Member'}</span>
                        <span>${micIcon}</span>
                        <span>${cameraIcon}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderChatDrawer() {
        if (!chatMessageList) {
            return;
        }

        if (!chatMessages.length) {
            chatMessageList.innerHTML = '<div class="drawer-detail-card">No chat yet. Start the conversation.</div>';
            return;
        }

        chatMessageList.innerHTML = chatMessages.map((item) => {
            const isSelf = item.author.email === user.email;
            const attachmentMessage = parseAttachmentMessage(item.message);

            let bubble = '';
            if (item.message.startsWith('[POLL]: ')) {
                try {
                    const pollData = JSON.parse(item.message.slice(8));
                    bubble = `
                        <div class="chat-message__bubble chat-message__poll" style="background-color: var(--color-gray-100); border: 1px solid var(--color-gray-300);">
                                    <strong>📊 ${escapeHtml(pollData.question)}</strong>
                                    <span class="chat-message__poll-mode">${pollData.selectionMode === 'multi' ? 'Choose multiple' : 'Choose one'}</span>
                                    <div class="poll-options" data-poll-id="${item.id}">
                                        ${pollData.options.map((opt, i) => `
                                            <label class="poll-option">
                                                <input type="${pollData.selectionMode === 'multi' ? 'checkbox' : 'radio'}" name="poll-${item.id}" value="${i}">
                                                <span>${escapeHtml(opt)}</span>
                                                ${roomData.meeting.hostUserId === user.id ? `<span class="control-badge poll-vote-count">${pollData.votes?.[i] || 0}</span>` : ''}
                                            </label>
                                        `).join('')}
                                        <button class="secondary-button poll-vote-button" type="button" data-poll-id="${item.id}">Vote</button>
                            </div>
                                    ${roomData.meeting.hostUserId === user.id && pollData.voters?.length ? `<div class="poll-voters"><strong>Responses</strong>${pollData.voters.map((voter) => `<div>${escapeHtml(voter.name)}: ${escapeHtml(voter.selections.map((index) => pollData.options[index]).join(', '))}</div>`).join('')}</div>` : ''}
                        </div>
                    `;
                } catch(e) {
                    bubble = `<div class="chat-message__bubble">${escapeHtml(item.message)}</div>`;
                }
            } else {
                bubble = attachmentMessage
                    ? renderAttachmentCard(attachmentMessage, isSelf)
                    : `<div class="chat-message__bubble">${escapeHtml(item.message)}</div>`;
            }

            return `
                <div class="chat-message ${isSelf ? 'chat-message--self' : ''}">
                    <div class="chat-message__name">${escapeHtml(item.author.name)}</div>
                    ${bubble}
                    <div class="chat-message__meta">${formatDateTime(item.createdAt)}</div>
                </div>
            `;
        }).join('');

        if (roomState.selectedDrawer === 'chat') {
            chatMessageList.scrollTop = chatMessageList.scrollHeight;
        }

        chatMessageList.querySelectorAll('.poll-vote-button').forEach((button) => {
            button.addEventListener('click', () => {
                const pollOptions = chatMessageList.querySelector(`[data-poll-id="${button.dataset.pollId}"]`);
                const selections = Array.from(pollOptions.querySelectorAll('input:checked')).map((input) => Number(input.value));
                if (!selections.length) {
                    alert('Choose at least one option.');
                    return;
                }
                socket.emit('meeting:poll-vote', {
                    roomCode: activeRoomCode,
                    messageId: Number(button.dataset.pollId),
                    selections
                });
            });
        });
    }

    function updateDeviceSelectors() {
        if (!microphoneSelect || !cameraSelect || !speakerOutputSelect) {
            return;
        }

        navigator.mediaDevices.enumerateDevices().then((devices) => {
            const audioInputs = devices.filter((device) => device.kind === 'audioinput');
            const videoInputs = devices.filter((device) => device.kind === 'videoinput');
            const audioOutputs = devices.filter((device) => device.kind === 'audiooutput');

            microphoneSelect.innerHTML = audioInputs.map((device, index) => `
                <option value="${escapeHtml(device.deviceId)}">${escapeHtml(device.label || `Microphone ${index + 1}`)}</option>
            `).join('');

            cameraSelect.innerHTML = videoInputs.map((device, index) => `
                <option value="${escapeHtml(device.deviceId)}">${escapeHtml(device.label || `Camera ${index + 1}`)}</option>
            `).join('');

            speakerOutputSelect.innerHTML = audioOutputs.length
                ? audioOutputs.map((device, index) => `
                    <option value="${escapeHtml(device.deviceId)}">${escapeHtml(device.label || `Speaker ${index + 1}`)}</option>
                `).join('')
                : '<option value="">Default output</option>';
            speakerOutputSelect.disabled = typeof HTMLMediaElement.prototype.setSinkId !== 'function';

            if (localAudioDeviceId) {
                microphoneSelect.value = localAudioDeviceId;
            }
            if (localVideoDeviceId) {
                cameraSelect.value = localVideoDeviceId;
            }
            if (localSpeakerOutputDeviceId) {
                speakerOutputSelect.value = localSpeakerOutputDeviceId;
            }
        }).catch((error) => {
            console.warn('Device enumeration failed:', error.message);
        });
    }

    function replaceLocalStream(nextStream) {
        localStream = nextStream;
        refreshLocalAudioAnalyser();
        attachLocalTracksToPeers();
        refreshOutgoingVideoTrack();
        renderMeetingState();
    }

    async function switchAudioDevice(deviceId) {
        const audioConstraints = deviceId ? { deviceId: { exact: deviceId } } : true;
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
        const newAudioTrack = audioStream.getAudioTracks()[0];
        const preservedVideoTracks = localStream ? localStream.getVideoTracks() : [];

        localStream?.getAudioTracks().forEach((track) => track.stop());
        localAudioDeviceId = deviceId || '';
        replaceLocalStream(new MediaStream([...preservedVideoTracks, newAudioTrack]));
    }

    async function switchVideoDevice(deviceId) {
        const wasVirtualBackgroundOn = virtualBackground.enabled;
        if (wasVirtualBackgroundOn) {
            disableVirtualBackground();
        }

        const videoConstraints = deviceId ? { deviceId: { exact: deviceId } } : true;
        const videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
        const newVideoTrack = videoStream.getVideoTracks()[0];
        const preservedAudioTracks = localStream ? localStream.getAudioTracks() : [];

        localStream?.getVideoTracks().forEach((track) => track.stop());
        localVideoDeviceId = deviceId || '';
        replaceLocalStream(new MediaStream([...preservedAudioTracks, newVideoTrack]));

        if (wasVirtualBackgroundOn) {
            await enableVirtualBackground();
            refreshBackgroundToggleUi();
        }
    }

    async function setSpeakerOutputDevice(deviceId) {
        localSpeakerOutputDeviceId = deviceId || '';
        preferredSpeakerOutputDeviceId = localSpeakerOutputDeviceId;
        const mediaElements = Array.from(document.querySelectorAll('video'));
        await Promise.all(mediaElements.map((mediaElement) => applySpeakerOutputToElement(mediaElement)));
    }

    function ensurePeerConnection(remoteSocketId) {
        if (peerConnections.has(remoteSocketId)) {
            return peerConnections.get(remoteSocketId);
        }

        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        peerConnections.set(remoteSocketId, peerConnection);
        remoteStreams.set(remoteSocketId, new MediaStream());

        if (localStream) {
            localStream.getTracks().forEach((track) => {
                peerConnection.addTrack(track, localStream);
            });
        }

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc:signal', {
                    roomCode: activeRoomCode,
                    targetSocketId: remoteSocketId,
                    data: {
                        type: 'ice-candidate',
                        candidate: event.candidate
                    }
                });
            }
        };

        peerConnection.ontrack = (event) => {
            const remoteStream = remoteStreams.get(remoteSocketId) || new MediaStream();
            event.streams[0].getTracks().forEach((track) => {
                if (!remoteStream.getTracks().some((existingTrack) => existingTrack.id === track.id)) {
                    remoteStream.addTrack(track);
                }
            });
            remoteStreams.set(remoteSocketId, remoteStream);
            connectAudioAnalyzer(remoteSocketId, remoteStream);
            renderMeetingState();
        };

        peerConnection.onconnectionstatechange = () => {
            if (['failed', 'closed', 'disconnected'].includes(peerConnection.connectionState)) {
                disconnectAudioAnalyzer(remoteSocketId);
                remoteStreams.delete(remoteSocketId);
                if (peerConnection.connectionState === 'closed') {
                    peerConnections.delete(remoteSocketId);
                }
                renderMeetingState();
            }
        };

        return peerConnection;
    }

    function closePeerConnection(remoteSocketId) {
        const connection = peerConnections.get(remoteSocketId);
        if (connection) {
            connection.close();
            peerConnections.delete(remoteSocketId);
        }
        disconnectAudioAnalyzer(remoteSocketId);
        remoteStreams.delete(remoteSocketId);
        pendingOfferPeers.delete(remoteSocketId);
    }

    function attachLocalTracksToPeers() {
        if (!localStream) {
            return;
        }

        peerConnections.forEach((connection) => {
            const existingTrackIds = new Set(connection.getSenders().map((sender) => sender.track && sender.track.id));
            localStream.getTracks().forEach((track) => {
                if (!existingTrackIds.has(track.id)) {
                    connection.addTrack(track, localStream);
                }
            });
        });
    }

    function replaceOutgoingVideoTrack(track) {
        peerConnections.forEach((connection) => {
            connection.getSenders().forEach((sender) => {
                if (sender.track && sender.track.kind === 'video') {
                    sender.replaceTrack(track || null);
                }
            });
        });
    }

    function refreshOutgoingVideoTrack() {
        if (screenShareStream?.getVideoTracks()?.[0]) {
            replaceOutgoingVideoTrack(screenShareStream.getVideoTracks()[0]);
            return;
        }

        if (localStream?.getVideoTracks()?.[0]) {
            replaceOutgoingVideoTrack(localStream.getVideoTracks()[0]);
            return;
        }

        replaceOutgoingVideoTrack(null);
    }

    async function sendOffer(remoteSocketId) {
        if (pendingOfferPeers.has(remoteSocketId)) {
            return;
        }

        pendingOfferPeers.add(remoteSocketId);
        const peerConnection = ensurePeerConnection(remoteSocketId);
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        await peerConnection.setLocalDescription(offer);
        socket.emit('webrtc:signal', {
            roomCode: activeRoomCode,
            targetSocketId: remoteSocketId,
            data: {
                type: 'offer',
                sdp: peerConnection.localDescription
            }
        });
    }

    function isInitiatorFor(remoteSocketId) {
        if (!currentLocalSocketId || !remoteSocketId) {
            return false;
        }

        return currentLocalSocketId > remoteSocketId;
    }

    function syncPeerConnections(participants) {
        const remoteParticipants = participants.filter((participant) => participant.socketId && participant.socketId !== currentLocalSocketId);
        const activePeerIds = new Set(remoteParticipants.map((participant) => participant.socketId));

        [...peerConnections.keys()].forEach((remoteSocketId) => {
            if (!activePeerIds.has(remoteSocketId)) {
                closePeerConnection(remoteSocketId);
            }
        });

        remoteParticipants.forEach((participant) => {
            ensurePeerConnection(participant.socketId);
        });

        attachLocalTracksToPeers();
        refreshOutgoingVideoTrack();

        remoteParticipants.forEach((participant) => {
            if (isInitiatorFor(participant.socketId)) {
                const connection = peerConnections.get(participant.socketId);
                if (connection && connection.signalingState === 'stable' && !connection.localDescription) {
                    sendOffer(participant.socketId).catch((error) => console.warn('Offer failed:', error.message));
                }
            }
        });
    }

    function renderParticipantTiles() {
        const participants = roomState.participants.length ? [...roomState.participants] : currentRoomParticipants;
        const activeSpeaker = roomState.activeSpeaker
            || getMostActiveSpeaker(participants)
            || {
                name: user.name,
                email: user.email,
                socketId: currentLocalSocketId,
                audioEnabled: true,
                videoEnabled: Boolean(localStream),
                handRaised: false,
                isHost: true
            };

        const others = participants.filter((participant) => getPeerKey(participant) !== getPeerKey(activeSpeaker));
        const splitIndex = Math.ceil(others.length / 2);
        const leftParticipants = others.slice(0, splitIndex);
        const rightParticipants = others.slice(splitIndex);

        if (leftStack) {
            leftStack.innerHTML = '';
            leftParticipants.forEach((participant) => {
                leftStack.appendChild(createParticipantCard(participant, 'left', getStreamForParticipant(participant), getPeerKey(participant) === getPeerKey(activeSpeaker), isSelfParticipant(participant)));
            });
        }

        if (rightStack) {
            rightStack.innerHTML = '';
            rightParticipants.forEach((participant) => {
                rightStack.appendChild(createParticipantCard(participant, 'right', getStreamForParticipant(participant), getPeerKey(participant) === getPeerKey(activeSpeaker), isSelfParticipant(participant)));
            });
        }

        const activeStream = getStreamForParticipant(activeSpeaker);
        updateSpeakerStage(
            {
                participants,
                activeSpeaker,
                participantCount: participants.length
            },
            user,
            localStream,
            activeStream,
            activeStream !== screenShareStream
        );

        if (stageBgToggle) {
            stageBgToggle.classList.toggle('is-hidden', !isSelfParticipant(activeSpeaker) || activeStream === screenShareStream);
        }

        renderParticipantsDrawer();
        updateDrawerBadges();
        refreshBackgroundToggleUi();
    }

    function renderMeetingState() {
        renderParticipantTiles();
        renderChatDrawer();
        updateScreenShareButtonLabel();
        document.querySelectorAll('video').forEach((mediaElement) => {
            applySpeakerOutputToElement(mediaElement);
        });
        if (whiteboardState.isOpen) {
            redrawWhiteboardCanvas();
        }
        updateDrawerBadges();
    }

    function updateParticipantRoster(participants) {
        currentRoomParticipants = participants.map((participant) => ({
            ...participant
        }));

        syncPeerConnections(currentRoomParticipants);
        renderMeetingState();
    }

    async function loadAndApplyDevices() {
        updateDeviceSelectors();
        if (microphoneSelect && !microphoneSelect.value && localAudioDeviceId) {
            microphoneSelect.value = localAudioDeviceId;
        }
        if (cameraSelect && !cameraSelect.value && localVideoDeviceId) {
            cameraSelect.value = localVideoDeviceId;
        }
    }

    const meetingStart = roomData.meeting.startedAt || new Date().toISOString();
    const startTime = new Date(meetingStart).getTime();

    const updateTimer = () => {
        if (!timerElement) {
            return;
        }

        const elapsedMs = Math.max(0, Date.now() - startTime);
        const totalSeconds = Math.floor(elapsedMs / 1000);
        const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        timerElement.textContent = `${minutes}:${seconds}`;
    };

    function pushStatePatch(patch) {
        socket.emit('meeting:update-state', {
            roomCode: activeRoomCode,
            ...patch
        });
    }

    function appendChatMessage(message) {
        chatMessages.push(message);
        if (roomState.selectedDrawer !== 'chat') {
            if (message.author.email !== user.email) {
                roomState.unreadChatCount += 1;
            }
        }
        renderChatDrawer();
        updateDrawerBadges();
    }

    function replaceChatMessage(message) {
        const index = chatMessages.findIndex((item) => item.id === message.id);
        if (index === -1) {
            appendChatMessage(message);
            return;
        }

        chatMessages[index] = message;
        renderChatDrawer();
    }

    function applyRaiseHandToggle(nextRaised, shouldEmit = true) {
        const handRaised = Boolean(nextRaised);
        if (raiseHandButton) {
            raiseHandButton.classList.toggle('is-active', handRaised);
            raiseHandButton.setAttribute('aria-label', handRaised ? 'Lower hand' : 'Raise hand');
            raiseHandButton.setAttribute('title', handRaised ? 'Lower hand' : 'Raise hand');
        }

        if (shouldEmit) {
            pushStatePatch({ handRaised });
        }
    }

    function syncLocalRaiseHandFromRoster() {
        const localParticipant = currentRoomParticipants.find((participant) => participant.socketId === currentLocalSocketId)
            || currentRoomParticipants.find((participant) => participant.email === user.email);
        applyRaiseHandToggle(Boolean(localParticipant?.handRaised), false);
    }

    function applyAudioToggle(nextEnabled, shouldEmit = true) {
        audioEnabled = Boolean(nextEnabled);
        if (localStream) {
            localStream.getAudioTracks().forEach((track) => {
                track.enabled = audioEnabled;
            });
            refreshLocalAudioAnalyser();
        }

        if (muteToggleButton) {
            muteToggleButton.innerHTML = `<span>${audioEnabled ? '🎙️' : '🔇'}</span><strong>${audioEnabled ? 'Mute' : 'Unmute'}</strong>`;
        }

        if (shouldEmit) {
            pushStatePatch({ audioEnabled });
        }
        renderMeetingState();
    }

    function applyVideoToggle(nextEnabled, shouldEmit = true) {
        videoEnabled = Boolean(nextEnabled);
        if (localStream) {
            localStream.getVideoTracks().forEach((track) => {
                track.enabled = videoEnabled;
            });
        }
        if (virtualBackground.rawTrack) {
            virtualBackground.rawTrack.enabled = videoEnabled;
        }

        if (cameraToggleButton) {
            cameraToggleButton.innerHTML = `<span>${videoEnabled ? '📷' : '🚫'}</span><strong>${videoEnabled ? 'Video' : 'Enable'}</strong>`;
        }
        refreshOutgoingVideoTrack();
        if (shouldEmit) {
            pushStatePatch({ videoEnabled });
        }
        renderMeetingState();
    }

    function navigateToDashboardWithoutMeetingHistory() {
        activeRoomCode = '';
        window.removeEventListener('popstate', handleMeetingBackNavigation);
        window.location.replace('dashboard.html');
    }

    async function translateTranscript(text) {
        const targetLanguage = captionsTranslationLanguageSelect?.value || 'off';
        if (!captionsTranslation || targetLanguage === 'off' || !String(text || '').trim()) {
            if (captionsTranslation) captionsTranslation.textContent = '';
            return;
        }

        const requestId = ++translationRequestId;
        captionsTranslation.textContent = 'Translating...';
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLanguage)}&dt=t&q=${encodeURIComponent(text)}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Translation service unavailable.');
            }
            const data = await response.json();
            if (requestId === translationRequestId) {
                captionsTranslation.textContent = Array.isArray(data?.[0])
                    ? data[0].map((part) => part[0]).join('')
                    : 'Translation unavailable.';
            }
        } catch (error) {
            if (requestId === translationRequestId) {
                captionsTranslation.textContent = 'Translation unavailable. Check your connection.';
            }
        }
    }

    socket.on('connect', () => {
        currentLocalSocketId = socket.id;
        ensureAudioContext();
        if (audioLevelTimer) {
            clearInterval(audioLevelTimer);
        }
        audioLevelTimer = setInterval(sampleParticipantAudioLevels, 250);
        socket.emit('meeting:join', { roomCode: activeRoomCode });
        updateTimer();
        renderMeetingState();
    });

    socket.on('meeting:joined', (state) => {
        if (state?.title && meetingTitle) {
            meetingTitle.textContent = state.title;
        }
        if (state?.teamName && meetingSubtitle) {
            meetingSubtitle.textContent = `${state.teamName} • ${state.roomCode}`;
        }
        roomState.activeSpeaker = null;
        if (state?.whiteboard?.strokes) {
            roomState.whiteboard.strokes = state.whiteboard.strokes;
            redrawWhiteboardCanvas();
        }
        renderMeetingState();
    });

    socket.on('meeting:chat-history', ({ messages = [] }) => {
        chatMessages.splice(0, chatMessages.length, ...messages);
        renderChatDrawer();
        updateDrawerBadges();
    });

    socket.on('meeting:chat-message', ({ message, replace = false }) => {
        if (message) {
            replace ? replaceChatMessage(message) : appendChatMessage(message);
        }
    });

    socket.on('room:participants', ({ participants = [] }) => {
        roomState.participants = participants;
        currentRoomParticipants = participants;
        syncPeerConnections(currentRoomParticipants);
        roomState.activeSpeaker = getMostActiveSpeaker(currentRoomParticipants);
        syncLocalRaiseHandFromRoster();
        renderMeetingState();
    });

    socket.on('meeting:state', ({ participants = [], activeSpeaker = null } = {}) => {
        roomState.participants = participants;
        roomState.activeSpeaker = activeSpeaker;
        if (participants.length) {
            currentRoomParticipants = participants;
        }
        syncLocalRaiseHandFromRoster();
        renderMeetingState();
    });

    socket.on('meeting:whiteboard-state', ({ strokes = [] } = {}) => {
        roomState.whiteboard.strokes = strokes;
        if (whiteboardState.isOpen) {
            redrawWhiteboardCanvas();
        }
    });

    socket.on('meeting:whiteboard-stroke', ({ stroke } = {}) => {
        if (!stroke) {
            return;
        }

        if (roomState.whiteboard.strokes.some((existingStroke) => existingStroke.id === stroke.id)) {
            return;
        }
        roomState.whiteboard.strokes.push(stroke);
        if (whiteboardState.isOpen) {
            redrawWhiteboardCanvas();
        }
    });

    socket.on('meeting:whiteboard-clear', () => {
        roomState.whiteboard.strokes = [];
        if (whiteboardState.isOpen) {
            redrawWhiteboardCanvas();
        }
    });

    socket.on('webrtc:signal', async ({ sourceSocketId, data }) => {
        if (!sourceSocketId || !data) {
            return;
        }

        const peerConnection = ensurePeerConnection(sourceSocketId);

        if (data.type === 'offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            attachLocalTracksToPeers();
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('webrtc:signal', {
                roomCode: activeRoomCode,
                targetSocketId: sourceSocketId,
                data: {
                    type: 'answer',
                    sdp: peerConnection.localDescription
                }
            });
            return;
        }

        if (data.type === 'answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            return;
        }

        if (data.type === 'ice-candidate' && data.candidate) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (error) {
                console.warn('ICE candidate failed:', error.message);
            }
        }
    });

    socket.on('meeting:error', (message) => {
        alert(message);
        if (/ended/i.test(String(message || ''))) {
            navigateToDashboardWithoutMeetingHistory();
        }
    });

    socket.on('meeting:ended', ({ message }) => {
        alert(message || 'The host ended this meeting.');
        navigateToDashboardWithoutMeetingHistory();
    });

    updateTimer();
    setInterval(updateTimer, 1000);

    if (participantsDrawerClose) {
        participantsDrawerClose.addEventListener('click', () => setDrawerState('participants', false));
    }
    if (chatDrawerClose) {
        chatDrawerClose.addEventListener('click', () => setDrawerState('chat', false));
    }
    if (devicePanelClose) {
        devicePanelClose.addEventListener('click', () => setDrawerState('devices', false));
    }
    if (captionsDrawerClose) {
        captionsDrawerClose.addEventListener('click', () => setDrawerState('captions', false));
    }
    if (morePanelClose) {
        morePanelClose.addEventListener('click', closeMorePanel);
    }
    if (participantsSearchInput) {
        participantsSearchInput.addEventListener('input', renderParticipantsDrawer);
    }
    if (meetingCopyLinkButton) {
        meetingCopyLinkButton.addEventListener('click', () => {
            copyMeetingLink().catch((error) => alert(error.message || 'Unable to copy the meeting link.'));
        });
    }
    if (meetingFullscreenButton) {
        meetingFullscreenButton.addEventListener('click', () => {
            toggleFullscreen().catch((error) => alert(error.message || 'Unable to toggle fullscreen.'));
        });
        updateFullscreenButton();
        document.addEventListener('fullscreenchange', updateFullscreenButton);
    }
    if (meetingExitFullscreenButton) {
        meetingExitFullscreenButton.addEventListener('click', () => {
            if (document.fullscreenElement) {
                toggleFullscreen().catch((error) => alert(error.message || 'Unable to exit fullscreen.'));
            }
        });
    }
    if (participantsButton) {
        participantsButton.addEventListener('click', () => setDrawerState('participants', roomState.selectedDrawer !== 'participants'));
    }
    if (chatButton) {
        chatButton.addEventListener('click', () => setDrawerState('chat', roomState.selectedDrawer !== 'chat'));
    }
    if (moreButton) {
        moreButton.addEventListener('click', () => setDrawerState('more', roomState.selectedDrawer !== 'more'));
    }
    if (speakerSettingsButton) {
        speakerSettingsButton.addEventListener('click', () => setDrawerState('devices', roomState.selectedDrawer !== 'devices'));
    }
    if (shareScreenOptionButton) {
        shareScreenOptionButton.addEventListener('click', async () => {
            closeMorePanel();
            await startScreenShare('screen');
        });
    }
    if (shareWindowOptionButton) {
        shareWindowOptionButton.addEventListener('click', async () => {
            closeMorePanel();
            await startScreenShare('window');
        });
    }
    if (shareTabOptionButton) {
        shareTabOptionButton.addEventListener('click', async () => {
            closeMorePanel();
            await startScreenShare('tab');
        });
    }
    if (stopShareOptionButton) {
        stopShareOptionButton.addEventListener('click', () => {
            stopScreenShare();
            closeMorePanel();
        });
    }
    if (openWhiteboardButton) {
        openWhiteboardButton.addEventListener('click', () => {
            closeMorePanel();
            openWhiteboard();
        });
    }
    if (aiSuggestionsButton) {
        aiSuggestionsButton.addEventListener('click', () => {
            generateAiSuggestions();
        });
    }
    if (chatAttachImageButton) {
        chatAttachImageButton.addEventListener('click', () => {
            imageShareInput?.click();
        });
    }
    if (chatCreatePollButton) {
        chatCreatePollButton.addEventListener('click', () => {
            const question = prompt('Enter your poll question:')?.trim();
            if (!question) return;
            const quantity = Math.min(8, Math.max(2, Number(prompt('How many options? (2-8)', '3')) || 0));
            if (!quantity) return;
            const options = Array.from({ length: quantity }, (_, index) => prompt(`Option ${index + 1}:`)?.trim()).filter(Boolean);
            if (options.length < 2) {
                alert('A poll needs at least two options.');
                return;
            }
            const selectionMode = prompt('Type single for one choice or multi for multiple choices:', 'single')?.trim().toLowerCase() === 'multi' ? 'multi' : 'single';
            if (question && options.length >= 2) {
                const pollData = JSON.stringify({
                    type: 'poll',
                    question,
                    options,
                    selectionMode,
                    votes: options.map(() => 0),
                    voters: []
                });
                socket.emit('meeting:chat-message', {
                    roomCode: activeRoomCode,
                    message: `[POLL]: ${pollData}`
                });
            }
        });
    }
    if (downloadAttendanceButton) {
        downloadAttendanceButton.addEventListener('click', () => {
            const csvRows = ['Name,Email,Status,Joined At'];
            currentRoomParticipants.forEach(p => {
                csvRows.push(`"${p.name}","${p.email || ''}","${p.isHost ? 'Host' : 'Participant'}","${new Date().toLocaleString()}"`);
            });
            const blob = new Blob([csvRows.join('\\n')], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.setAttribute('hidden', '');
            a.setAttribute('href', url);
            a.setAttribute('download', `attendance-${activeRoomCode}.csv`);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    }
    if (captionsButton) {
        captionsButton.addEventListener('click', () => {
            if (isCaptionsEnabled) {
                // It was on, turn it off by closing drawer
                setDrawerState('captions', false);
            } else {
                // It was off, turn it on
                isCaptionsEnabled = true;
                captionsButton.classList.add('is-active');
                setDrawerState('captions', true);
                if (captionsOverlay) captionsOverlay.textContent = 'Listening...';

                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (SpeechRecognition) {
                    recognition = new SpeechRecognition();
                    recognition.lang = captionsLanguageSelect?.value || 'en-US';
                    recognition.continuous = true;
                    recognition.interimResults = true;
                    recognition.onresult = (event) => {
                        finalTranscriptText = Array.from(event.results)
                            .filter((result) => result.isFinal)
                            .map((result) => result[0].transcript)
                            .join(' ');
                        const interimTranscript = Array.from(event.results)
                            .filter((result) => !result.isFinal)
                            .map((result) => result[0].transcript)
                            .join(' ');
                        transcriptText = `${finalTranscriptText} ${interimTranscript}`.trim();
                        if (captionsOverlay) captionsOverlay.textContent = transcriptText || 'Listening...';
                        translateTranscript(transcriptText);
                    };
                    recognition.onerror = (event) => {
                        if (captionsOverlay) captionsOverlay.textContent = `Transcription error: ${event.error}`;
                    };
                    recognition.onend = () => {
                        if (isCaptionsEnabled) {
                            try { recognition.start(); } catch (error) { /* Browser may already be restarting. */ }
                        }
                    };
                    recognition.start();
                } else {
                    alert('Speech Recognition API is not supported in this browser.');
                    setDrawerState('captions', false);
                }
            }
        });
    }
    if (captionsLanguageSelect) {
        captionsLanguageSelect.addEventListener('change', () => {
            if (recognition && isCaptionsEnabled) {
                recognition.lang = captionsLanguageSelect.value;
                recognition.stop();
            }
        });
    }
    if (captionsTranslationLanguageSelect) {
        captionsTranslationLanguageSelect.addEventListener('change', () => translateTranscript(transcriptText));
    }
    document.addEventListener('click', (event) => {
        if (event.target.closest('[data-action="toggle-bg"]')) {
            toggleVirtualBackground();
        }
    });

    if (handsChip) {
        handsChip.addEventListener('click', () => setDrawerState('participants', true));
    }

    if (chatAttachFileButton) {
        chatAttachFileButton.addEventListener('click', () => {
            fileShareInput?.click();
        });
    }
    if (imageShareInput) {
        imageShareInput.addEventListener('change', () => {
            const [file] = imageShareInput.files || [];
            if (file) {
                sendAttachment(file, 'image');
            }
            imageShareInput.value = '';
        });
    }
    if (fileShareInput) {
        fileShareInput.addEventListener('change', () => {
            const [file] = fileShareInput.files || [];
            if (file) {
                sendAttachment(file, 'file');
            }
            fileShareInput.value = '';
        });
    }
    if (whiteboardCloseButton) {
        whiteboardCloseButton.addEventListener('click', closeWhiteboard);
    }
    if (whiteboardClearButton) {
        whiteboardClearButton.addEventListener('click', () => {
            roomState.whiteboard.strokes = [];
            whiteboardState.currentStroke = null;
            redrawWhiteboardCanvas();
            emitWhiteboardState('meeting:whiteboard-clear');
        });
    }
    whiteboardColorButtons.forEach((button) => {
        button.addEventListener('click', () => {
            whiteboardState.activeColor = button.dataset.whiteboardColor || whiteboardState.activeColor;
            updateWhiteboardToolbar();
        });
    });
    if (whiteboardSizeInput) {
        whiteboardSizeInput.addEventListener('input', () => {
            whiteboardState.lineWidth = Number(whiteboardSizeInput.value) || whiteboardState.lineWidth;
        });
    }
    if (whiteboardCanvas) {
        whiteboardCanvas.addEventListener('pointerdown', beginWhiteboardStroke);
        whiteboardCanvas.addEventListener('pointermove', continueWhiteboardStroke);
        whiteboardCanvas.addEventListener('pointerup', finishWhiteboardStroke);
        whiteboardCanvas.addEventListener('pointercancel', finishWhiteboardStroke);
        whiteboardCanvas.addEventListener('pointerleave', (event) => {
            if (event.buttons === 0) {
                finishWhiteboardStroke(event);
            }
        });
    }

    if (chatComposer) {
        chatComposer.addEventListener('submit', (event) => {
            event.preventDefault();
            const message = chatMessageInput?.value.trim();
            if (!message) {
                return;
            }
            socket.emit('meeting:chat-message', { roomCode: activeRoomCode, message });
            if (chatMessageInput) {
                chatMessageInput.value = '';
            }
        });
    }

    if (microphoneSelect) {
        microphoneSelect.addEventListener('change', async () => {
            try {
                await switchAudioDevice(microphoneSelect.value);
            } catch (error) {
                alert(error.message || 'Unable to switch microphone.');
            }
        });
    }

    if (cameraSelect) {
        cameraSelect.addEventListener('change', async () => {
            try {
                await switchVideoDevice(cameraSelect.value);
            } catch (error) {
                alert(error.message || 'Unable to switch camera.');
            }
        });
    }

    if (speakerOutputSelect) {
        speakerOutputSelect.addEventListener('change', async () => {
            try {
                await setSpeakerOutputDevice(speakerOutputSelect.value);
            } catch (error) {
                alert(error.message || 'Unable to switch speaker output.');
            }
        });
    }

    if (refreshDeviceListButton) {
        refreshDeviceListButton.addEventListener('click', loadAndApplyDevices);
    }

    if (muteToggleButton) {
        muteToggleButton.addEventListener('click', () => {
            applyAudioToggle(!audioEnabled);
        });
    }

    if (cameraToggleButton) {
        cameraToggleButton.addEventListener('click', () => {
            applyVideoToggle(!videoEnabled);
        });
    }

    if (screenShareButton) {
        screenShareButton.addEventListener('click', async () => {
            if (screenShareStream) {
                stopScreenShare();
                return;
            }
            await startScreenShare('screen');
        });
    }

    if (raiseHandButton) {
        raiseHandButton.addEventListener('click', () => {
            applyRaiseHandToggle(!raiseHandButton.classList.contains('is-active'));
        });
    }

    if (leaveMeetingButton) {
        leaveMeetingButton.addEventListener('click', async () => {
            currentRoomParticipants = [];
            roomState.participants = [];
            peerConnections.forEach((connection, remoteSocketId) => {
                closePeerConnection(remoteSocketId);
            });

            const isHost = roomData.meeting.hostUserId === user.id;
            if (isHost) {
                try {
                    await requestJson(`/api/meetings/${encodeURIComponent(activeRoomCode)}/end`, { method: 'POST' });
                } catch (error) {
                    alert(error.message || 'Unable to end meeting.');
                }
            }

            socket.emit('meeting:leave', { roomCode: activeRoomCode });
            if (screenShareStream) {
                screenShareStream.getTracks().forEach((track) => track.stop());
            }
            if (audioLevelTimer) {
                clearInterval(audioLevelTimer);
            }
            setTimeout(navigateToDashboardWithoutMeetingHistory, 150);
        });
    }

    wireDrawerSwipeToClose(participantsDrawer, 'participants');
    wireDrawerSwipeToClose(chatDrawer, 'chat');
    wireDrawerSwipeToClose(devicePanel, 'devices');
    wireDrawerSwipeToClose(morePanel, 'more');

    window.addEventListener('resize', () => {
        if (whiteboardState.isOpen) {
            clearTimeout(whiteboardResizeTimer);
            whiteboardResizeTimer = setTimeout(() => {
                resizeWhiteboardCanvas();
            }, 80);
        }
    });

    socket.on('disconnect', () => {
        if (audioLevelTimer) {
            clearInterval(audioLevelTimer);
        }
    });

    await loadAndApplyDevices();
    ensureAudioContext();
    if (localStream) {
        refreshLocalAudioAnalyser();
    }
    closeMeetingSidePanels();
    closeWhiteboard();
    updateScreenShareButtonLabel();
    updateWhiteboardToolbar();
    generateAiSuggestions();
    applyAudioToggle(audioEnabled, false);
    applyVideoToggle(videoEnabled, false);
    applyRaiseHandToggle(false, false);
    renderMeetingState();
}

async function loadDashboardPage(user) {
    let dashboardData = await requestJson('/api/dashboard');
    let currentWorkspaceView = 'dashboard';

    const userName = document.getElementById('dashboard-user-name');
    const userEmail = document.getElementById('dashboard-user-email');
    const userAvatar = document.getElementById('dashboard-user-avatar');
    const profileButton = document.getElementById('dashboard-profile-button');
    const profileModal = document.getElementById('profile-modal');
    const profileModalCloseButton = document.getElementById('profile-modal-close');
    const profileCancelButton = document.getElementById('profile-cancel-button');
    const profileForm = document.getElementById('profile-form');
    const profileFormStatus = document.getElementById('profile-form-status');
    const profileAvatarInput = document.getElementById('profile-avatar-input');
    const profileAvatarPreview = document.getElementById('profile-modal-avatar');
    const profileFirstNameInput = document.getElementById('profile-first-name');
    const profileLastNameInput = document.getElementById('profile-last-name');
    const profileEmailInput = document.getElementById('profile-email');
    const profileAgeInput = document.getElementById('profile-age');
    const profileOccupationInput = document.getElementById('profile-occupation');
    const profileCurrentPasswordInput = document.getElementById('profile-current-password');
    const profileNewPasswordInput = document.getElementById('profile-new-password');
    const profileConfirmPasswordInput = document.getElementById('profile-confirm-password');
    const sidebar = document.querySelector('.dashboard-sidebar');
    const sidebarBackdrop = document.getElementById('dashboard-sidebar-backdrop');
    const menuButton = document.getElementById('dashboard-menu-button');
    const sidebarCloseButton = document.getElementById('dashboard-sidebar-close');
    const dashboardTitle = document.querySelector('.dashboard-title');
    const dashboardLabel = document.querySelector('.dashboard-label');
    const dashboardOverview = document.getElementById('dashboard-overview');
    const upcomingSection = document.querySelector('.upcoming-section');
    const historyPanel = document.querySelector('.history-panel');
    let profileAvatarDataUrl = dashboardData.profile.avatarUrl || '';

    function ensureWorkspacePanel() {
        let panel = document.getElementById('dashboard-workspace-panel');
        if (!panel) {
            panel = document.createElement('section');
            panel.id = 'dashboard-workspace-panel';
            panel.className = 'upcoming-section';
            panel.style.display = 'none';
            document.querySelector('.dashboard-content')?.insertBefore(panel, dashboardOverview?.nextSibling || null);
        }
        return panel;
    }

    const workspacePanel = ensureWorkspacePanel();

    function showWorkspaceMessage(message) {
        const banner = workspacePanel?.querySelector('[data-workspace-banner]');
        if (banner) {
            banner.textContent = message;
        }
    }

    function updateProfileImage(source) {
        const resolvedSource = source || 'assets/images/logo.png';
        if (userAvatar) {
            userAvatar.src = resolvedSource;
        }
        if (profileAvatarPreview) {
            profileAvatarPreview.src = resolvedSource;
        }
    }

    function syncProfileFields(profile) {
        if (profileFirstNameInput) {
            profileFirstNameInput.value = profile.firstName || '';
        }
        if (profileLastNameInput) {
            profileLastNameInput.value = profile.lastName || '';
        }
        if (profileEmailInput) {
            profileEmailInput.value = profile.email || '';
        }
        if (profileAgeInput) {
            profileAgeInput.value = profile.age ?? '';
        }
        if (profileOccupationInput) {
            profileOccupationInput.value = profile.occupation || '';
        }
        if (profileCurrentPasswordInput) {
            profileCurrentPasswordInput.value = '';
        }
        if (profileNewPasswordInput) {
            profileNewPasswordInput.value = '';
        }
        if (profileConfirmPasswordInput) {
            profileConfirmPasswordInput.value = '';
        }

        profileAvatarDataUrl = profile.avatarUrl || '';
        updateProfileImage(profileAvatarDataUrl || 'assets/images/logo.png');

        if (profileFormStatus) {
            profileFormStatus.textContent = '';
            profileFormStatus.className = 'profile-form-status';
        }
    }

    function openProfileModal() {
        syncProfileFields(dashboardData.profile);
        profileModal?.classList.remove('is-hidden');
        profileModal?.setAttribute('aria-hidden', 'false');
        profileButton?.setAttribute('aria-expanded', 'true');
    }

    function closeProfileModal() {
        profileModal?.classList.add('is-hidden');
        profileModal?.setAttribute('aria-hidden', 'true');
        profileButton?.setAttribute('aria-expanded', 'false');
    }

    function setProfileStatus(message, isError = false) {
        if (!profileFormStatus) {
            return;
        }

        profileFormStatus.textContent = message;
        profileFormStatus.className = `profile-form-status${isError ? ' is-error' : ''}`;
    }

    async function refreshDashboardData() {
        dashboardData = await requestJson('/api/dashboard');
        renderOverview(dashboardData);
        renderTeamList(dashboardData.teams);
        renderUpcomingMeetings(dashboardData.upcomingMeetings);
        renderMeetingHistory(dashboardData.meetingHistory);
    }

    async function joinRoomAndRedirect(roomCode) {
        const normalizedRoomCode = normalizeRoomCodeInput(roomCode);
        await requestJson(`/api/meetings/${encodeURIComponent(normalizedRoomCode)}/join`, { method: 'POST' });
        redirectToMeeting(normalizedRoomCode);
    }

    function renderMeetingsWorkspace() {
        if (!workspacePanel) {
            return;
        }

        workspacePanel.innerHTML = `
            <div class="section-header"><div><h2>Meetings Workspace</h2><p>Schedule a session or jump into an active room.</p></div></div>
            <div class="empty-state-card" data-workspace-banner>Create your next meeting in one step.</div>
            <form id="dashboard-workspace-meeting-form" class="join-card" style="margin-top:14px;">
                <input type="text" id="workspace-meeting-title" placeholder="Meeting title" required>
                <input type="text" id="workspace-meeting-description" placeholder="Description (optional)">
                <select id="workspace-meeting-team" class="workspace-select">
                    <option value="">No team</option>
                    ${dashboardData.teams.map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`).join('')}
                </select>
                <input type="datetime-local" id="workspace-meeting-time">
                <label style="display:flex; gap:8px; align-items:center; font-size:13px; color:var(--muted);"><input type="checkbox" id="workspace-meeting-auto-join" checked>Join immediately after creating</label>
                <button type="submit" class="primary-button">Schedule Meeting</button>
            </form>
            <div class="panel-header" style="margin-top:24px;"><h2>Upcoming Queue</h2></div>
            <div class="upcoming-cards" id="workspace-upcoming-list"></div>
        `;

        const upcomingList = document.getElementById('workspace-upcoming-list');
        if (upcomingList) {
            upcomingList.innerHTML = dashboardData.upcomingMeetings.length
                ? dashboardData.upcomingMeetings.map((meeting, index) => `
                    <article class="meeting-card">
                        <div class="meeting-card-top">
                            <span class="meeting-icon ${['blue', 'green', 'purple'][index % 3]}">📅</span>
                            <span class="meeting-badge">${escapeHtml(meeting.teamName)}</span>
                        </div>
                        <h3>${escapeHtml(meeting.title)}</h3>
                        <p class="meeting-description">${escapeHtml(meeting.description || 'Ready to start.')}</p>
                        <div class="meeting-meta"><span>${formatDateTime(meeting.scheduledAt)}</span><span>Room: ${escapeHtml(meeting.roomCode)}</span></div>
                        <button class="secondary-button small-button" type="button" data-room-code="${escapeHtml(meeting.roomCode)}">Join</button>
                    </article>
                `).join('')
                : '<div class="empty-state-card">No upcoming meetings yet.</div>';

            upcomingList.querySelectorAll('[data-room-code]').forEach((button) => {
                button.addEventListener('click', async () => {
                    await joinRoomAndRedirect(button.dataset.roomCode);
                });
            });
        }

        document.getElementById('dashboard-workspace-meeting-form')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const title = document.getElementById('workspace-meeting-title')?.value.trim();
            const description = document.getElementById('workspace-meeting-description')?.value.trim() || '';
            const teamId = document.getElementById('workspace-meeting-team')?.value || null;
            const scheduledLocal = document.getElementById('workspace-meeting-time')?.value;
            const autoJoin = document.getElementById('workspace-meeting-auto-join')?.checked;

            if (!title) {
                showWorkspaceMessage('Meeting title is required.');
                return;
            }

            const response = await requestJson('/api/meetings', {
                method: 'POST',
                body: {
                    title,
                    description,
                    teamId,
                    scheduledAt: scheduledLocal ? new Date(scheduledLocal).toISOString() : new Date().toISOString()
                }
            });

            if (autoJoin) {
                await joinRoomAndRedirect(response.meeting.roomCode);
                return;
            }

            showWorkspaceMessage('Meeting created successfully.');
            await refreshDashboardData();
            renderMeetingsWorkspace();
        });
    }

    function renderTeamsWorkspace() {
        if (!workspacePanel) {
            return;
        }

        workspacePanel.innerHTML = `
            <div class="section-header"><div><h2>Teams Workspace</h2><p>Create and organize teams for focused collaboration.</p></div></div>
            <div class="empty-state-card" data-workspace-banner>Create a team to group meetings and members.</div>
            <form id="dashboard-workspace-team-form" class="join-card" style="margin-top:14px;">
                <input type="text" id="workspace-team-name" placeholder="Team name" required>
                <input type="text" id="workspace-team-description" placeholder="Team description">
                <button type="submit" class="primary-button">Create Team</button>
            </form>
            <div class="panel-header" style="margin-top:24px;"><h2>Your Teams</h2></div>
            <div class="team-list" id="workspace-team-list"></div>
        `;

        const list = document.getElementById('workspace-team-list');
        if (list) {
            list.innerHTML = dashboardData.teams.length
                ? dashboardData.teams.map((team) => `
                    <article class="team-card">
                        <strong>${escapeHtml(team.name)}</strong>
                        <span>${escapeHtml(team.description || 'No description')}</span>
                        <small>${team.meetingCount} meetings</small>
                    </article>
                `).join('')
                : '<div class="empty-state-card">No teams yet.</div>';
        }

        document.getElementById('dashboard-workspace-team-form')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const name = document.getElementById('workspace-team-name')?.value.trim();
            const description = document.getElementById('workspace-team-description')?.value.trim() || '';
            if (!name) {
                showWorkspaceMessage('Team name is required.');
                return;
            }

            await requestJson('/api/teams', {
                method: 'POST',
                body: { name, description }
            });

            showWorkspaceMessage('Team created successfully.');
            await refreshDashboardData();
            renderTeamsWorkspace();
        });
    }

    function renderHistoryWorkspace() {
        if (!workspacePanel) {
            return;
        }

        workspacePanel.innerHTML = `
            <div class="section-header"><div><h2>Meeting History Workspace</h2><p>Review outcomes and relaunch previous rooms.</p></div></div>
            <div class="empty-state-card" data-workspace-banner>Click relaunch to re-enter a previous room.</div>
            <div class="history-list" style="margin-top:14px;">
                <table class="history-table">
                    <thead><tr><th>Meeting</th><th>Team</th><th>Ended</th><th>Duration</th><th>Action</th></tr></thead>
                    <tbody id="workspace-history-body"></tbody>
                </table>
            </div>
        `;

        const body = document.getElementById('workspace-history-body');
        if (!body) {
            return;
        }

        body.innerHTML = dashboardData.meetingHistory.length
            ? dashboardData.meetingHistory.map((meeting) => `
                <tr>
                    <td>${escapeHtml(meeting.title)}</td>
                    <td>${escapeHtml(meeting.teamName)}</td>
                    <td>${formatDateTime(meeting.endedAt || meeting.startedAt || meeting.scheduledAt)}</td>
                    <td>${formatMeetingDuration(meeting.startedAt, meeting.endedAt)}</td>
                    <td><button class="secondary-button small-button" type="button" data-room-code="${escapeHtml(meeting.roomCode)}">Relaunch</button></td>
                </tr>
            `).join('')
            : '<tr><td colspan="5">No history yet.</td></tr>';

        body.querySelectorAll('[data-room-code]').forEach((button) => {
            button.addEventListener('click', async () => {
                await joinRoomAndRedirect(button.dataset.roomCode);
            });
        });
    }

    function renderSettingsWorkspace() {
        if (!workspacePanel) {
            return;
        }

        const compactEnabled = localStorage.getItem('vyomDashboardCompactView') === 'true';
        const autoJoinEnabled = localStorage.getItem('vyomDashboardAutoJoin') !== 'false';

        workspacePanel.innerHTML = `
            <div class="section-header"><div><h2>Workspace Settings</h2><p>Customize your dashboard behavior.</p></div></div>
            <div class="empty-state-card" data-workspace-banner>Preferences are saved in your browser.</div>
            <div class="join-card" style="margin-top:14px;">
                <label style="display:flex; gap:8px; align-items:center; font-size:14px; color:var(--text);"><input type="checkbox" id="workspace-compact-toggle" ${compactEnabled ? 'checked' : ''}>Compact dashboard cards</label>
                <label style="display:flex; gap:8px; align-items:center; font-size:14px; color:var(--text);"><input type="checkbox" id="workspace-auto-join-toggle" ${autoJoinEnabled ? 'checked' : ''}>Auto-join when using New Meeting</label>
                <button id="workspace-theme-toggle" class="secondary-button" type="button">Toggle Theme</button>
            </div>
        `;

        document.getElementById('workspace-compact-toggle')?.addEventListener('change', (event) => {
            const enabled = Boolean(event.target.checked);
            localStorage.setItem('vyomDashboardCompactView', String(enabled));
            document.body.classList.toggle('dashboard-compact', enabled);
            showWorkspaceMessage('Compact view preference saved.');
        });

        document.getElementById('workspace-auto-join-toggle')?.addEventListener('change', (event) => {
            localStorage.setItem('vyomDashboardAutoJoin', String(Boolean(event.target.checked)));
            showWorkspaceMessage('New meeting auto-join preference saved.');
        });

        document.getElementById('workspace-theme-toggle')?.addEventListener('click', () => {
            document.getElementById('theme-toggle')?.click();
            showWorkspaceMessage('Theme updated.');
        });
    }

    function applyWorkspaceView(view) {
        currentWorkspaceView = view;
        const showBase = view === 'dashboard';

        if (dashboardOverview) {
            dashboardOverview.style.display = showBase ? '' : 'none';
        }
        if (upcomingSection) {
            upcomingSection.style.display = showBase ? '' : 'none';
        }
        if (historyPanel) {
            historyPanel.style.display = showBase ? '' : 'none';
        }
        if (workspacePanel) {
            workspacePanel.style.display = showBase ? 'none' : '';
        }

        if (dashboardTitle) {
            dashboardTitle.textContent = showBase
                ? 'Create, join and manage your meetings'
                : `${view.charAt(0).toUpperCase()}${view.slice(1)} workspace`;
        }
        if (dashboardLabel) {
            dashboardLabel.textContent = showBase ? 'Workspace' : 'Focused View';
        }

        if (view === 'meetings') {
            renderMeetingsWorkspace();
        } else if (view === 'teams') {
            renderTeamsWorkspace();
        } else if (view === 'history') {
            renderHistoryWorkspace();
        } else if (view === 'settings') {
            renderSettingsWorkspace();
        }
    }

    if (userName) {
        userName.textContent = dashboardData.profile.name;
    }
    if (userEmail) {
        userEmail.textContent = dashboardData.profile.email;
    }
    updateProfileImage(dashboardData.profile.avatarUrl || 'assets/images/logo.png');

    renderOverview(dashboardData);
    renderTeamList(dashboardData.teams);
    renderUpcomingMeetings(dashboardData.upcomingMeetings);
    renderMeetingHistory(dashboardData.meetingHistory);

    if (localStorage.getItem('vyomDashboardCompactView') === 'true') {
        document.body.classList.add('dashboard-compact');
    }

    profileButton?.addEventListener('click', openProfileModal);
    profileModalCloseButton?.addEventListener('click', closeProfileModal);
    profileCancelButton?.addEventListener('click', closeProfileModal);
    profileModal?.addEventListener('click', (event) => {
        if (event.target === profileModal) {
            closeProfileModal();
        }
    });

    profileAvatarInput?.addEventListener('change', () => {
        const file = profileAvatarInput.files?.[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            profileAvatarDataUrl = String(reader.result || '');
            updateProfileImage(profileAvatarDataUrl);
            setProfileStatus('Profile photo selected. Save changes to apply it.');
        };
        reader.readAsDataURL(file);
    });

    profileForm?.addEventListener('submit', async (event) => {
        event.preventDefault();

        const firstName = profileFirstNameInput?.value.trim();
        const lastName = profileLastNameInput?.value.trim();
        const age = profileAgeInput?.value || '';
        const occupation = profileOccupationInput?.value || '';
        const currentPassword = profileCurrentPasswordInput?.value || '';
        const newPassword = profileNewPasswordInput?.value || '';
        const confirmPassword = profileConfirmPasswordInput?.value || '';

        if (newPassword || confirmPassword) {
            if (newPassword !== confirmPassword) {
                setProfileStatus('New passwords do not match.', true);
                return;
            }

            if (!currentPassword) {
                setProfileStatus('Current password is required to change your password.', true);
                return;
            }
        }

        try {
            const response = await requestJson('/api/me', {
                method: 'PATCH',
                body: {
                    firstName,
                    lastName,
                    avatarUrl: profileAvatarDataUrl || null,
                    age,
                    occupation,
                    currentPassword,
                    newPassword
                }
            });

            dashboardData.profile = response.user;
            updateProfileImage(response.user.avatarUrl || 'assets/images/logo.png');
            if (userName) {
                userName.textContent = response.user.name;
            }
            if (userEmail) {
                userEmail.textContent = response.user.email;
            }

            const token = getStoredToken();
            if (token) {
                saveSession(token, response.user);
            }

            setProfileStatus('Profile updated successfully.');
            closeProfileModal();
        } catch (error) {
            setProfileStatus(error.message, true);
        }
    });

    document.getElementById('dashboard-sign-out-button')?.addEventListener('click', handleSignOut);

    const searchButton = document.getElementById('meeting-search-button');
    const searchInput = document.getElementById('meeting-search');
    if (searchButton && searchInput) {
        searchButton.addEventListener('click', () => {
            const query = searchInput.value.trim().toLowerCase();
            if (!query) {
                renderUpcomingMeetings(dashboardData.upcomingMeetings);
                renderMeetingHistory(dashboardData.meetingHistory);
                applyWorkspaceView('dashboard');
                return;
            }

            const filteredUpcoming = dashboardData.upcomingMeetings.filter((meeting) =>
                [meeting.title, meeting.teamName, meeting.roomCode, meeting.description].join(' ').toLowerCase().includes(query)
            );
            const filteredHistory = dashboardData.meetingHistory.filter((meeting) =>
                [meeting.title, meeting.teamName, meeting.roomCode, meeting.description].join(' ').toLowerCase().includes(query)
            );

            renderUpcomingMeetings(filteredUpcoming);
            renderMeetingHistory(filteredHistory);
            applyWorkspaceView('dashboard');
        });

        searchInput.addEventListener('input', () => {
            if (!searchInput.value.trim()) {
                renderUpcomingMeetings(dashboardData.upcomingMeetings);
                renderMeetingHistory(dashboardData.meetingHistory);
            }
        });
    }

    document.getElementById('new-meeting-button')?.addEventListener('click', async () => {
        const title = prompt('Meeting title', 'Instant Meeting') || 'Instant Meeting';
        const response = await requestJson('/api/meetings', {
            method: 'POST',
            body: { title }
        });

        const autoJoin = localStorage.getItem('vyomDashboardAutoJoin') !== 'false';
        if (autoJoin) {
            await joinRoomAndRedirect(response.meeting.roomCode);
            return;
        }

        await refreshDashboardData();
        applyWorkspaceView(currentWorkspaceView);
    });

    const joinMeetingButton = document.getElementById('join-meeting-button');
    const meetingCodeInput = document.getElementById('meeting-code');
    if (joinMeetingButton && meetingCodeInput) {
        joinMeetingButton.addEventListener('click', async () => {
            const roomCode = normalizeRoomCodeInput(meetingCodeInput.value.trim());
            if (!roomCode) {
                alert('Please enter a meeting code or link.');
                return;
            }

            await joinRoomAndRedirect(roomCode);
        });
    }

    document.getElementById('dashboard-view-calendar-button')?.addEventListener('click', () => {
        applyWorkspaceView('meetings');
        document.querySelectorAll('.sidebar-nav .nav-link').forEach((item) => item.classList.remove('active'));
        document.querySelector('.sidebar-nav .nav-link[data-target="meetings"]')?.classList.add('active');
    });

    document.getElementById('view-all-meetings-link')?.addEventListener('click', (event) => {
        event.preventDefault();
        applyWorkspaceView('history');
        document.querySelectorAll('.sidebar-nav .nav-link').forEach((item) => item.classList.remove('active'));
        document.querySelector('.sidebar-nav .nav-link[data-target="history"]')?.classList.add('active');
    });

    document.querySelectorAll('.sidebar-nav .nav-link').forEach((link) => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            document.querySelectorAll('.sidebar-nav .nav-link').forEach((item) => item.classList.remove('active'));
            link.classList.add('active');
            applyWorkspaceView(link.dataset.target || 'dashboard');

            if (window.innerWidth <= 760) {
                sidebar?.classList.remove('dashboard-sidebar--open');
                sidebarBackdrop?.classList.remove('dashboard-sidebar-backdrop--open');
                sidebarBackdrop?.setAttribute('aria-hidden', 'true');
            }
        });
    });

    function toggleSidebar(open) {
        if (!sidebar || !sidebarBackdrop) {
            return;
        }

        sidebar.classList.toggle('dashboard-sidebar--open', open);
        sidebarBackdrop.classList.toggle('dashboard-sidebar-backdrop--open', open);
        sidebarBackdrop.setAttribute('aria-hidden', String(!open));
        if (menuButton) {
            menuButton.textContent = open ? '✕' : '☰';
            menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
            menuButton.setAttribute('title', open ? 'Close navigation' : 'Open navigation');
        }
    }

    menuButton?.addEventListener('click', () => {
        toggleSidebar(!sidebar?.classList.contains('dashboard-sidebar--open'));
    });

    sidebarBackdrop?.addEventListener('click', () => toggleSidebar(false));
    sidebarCloseButton?.addEventListener('click', () => toggleSidebar(false));
    window.addEventListener('resize', () => {
        if (window.innerWidth > 760) {
            toggleSidebar(false);
        }
    });

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && profileModal && !profileModal.classList.contains('is-hidden')) {
            closeProfileModal();
        }
    });

    applyWorkspaceView('dashboard');
}
async function bootstrap() {
    initializeTheme();

    const currentUser = await verifySession();
    const hasAuthForms = isAuthPage();

    if (hasAuthForms) {
        if (currentUser) {
            redirectToDashboard();
            return;
        }

        wireAuthPage();
        return;
    }

    if (isDashboardPage()) {
        if (!currentUser) {
            window.location.replace('sign-in.html');
            return;
        }

        await loadDashboardPage(currentUser);
        return;
    }

    if (isMeetingPage()) {
        if (!currentUser) {
            window.location.replace('sign-in.html');
            return;
        }

        try {
            await loadMeetingPage(currentUser);
        } catch (error) {
            if (error.status === 409 || /ended/i.test(String(error.message || ''))) {
                alert('This meeting has ended. Returning to your dashboard.');
                window.location.replace('dashboard.html');
                return;
            }
            throw error;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    bootstrap().catch((error) => {
        console.error(error);
        alert(error.message || 'Unable to load the page.');
    });
});
