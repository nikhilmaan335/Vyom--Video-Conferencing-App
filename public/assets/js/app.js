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

    // Pages opened straight from disk have no server of their own to talk to.
    if (window.location.protocol === 'file:') {
        return `http://localhost:${DEFAULT_LOCAL_BACKEND_PORT}`;
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

function toDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toDateTimeLocalValue(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 16);
}

function formatTimeOfDay(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatFileSize(bytes) {
    const size = Number(bytes) || 0;
    if (size < 1024) {
        return `${size} B`;
    }
    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
    }
    if (size < 1024 * 1024 * 1024) {
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSecondsDuration(totalSeconds) {
    const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (!seconds) {
        return '—';
    }

    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

let meetingToastTimer = null;

function showMeetingToast(message) {
    let toast = document.getElementById('meeting-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'meeting-toast';
        toast.className = 'meeting-toast';
        toast.setAttribute('role', 'status');
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(meetingToastTimer);
    meetingToastTimer = setTimeout(() => {
        toast.classList.remove('is-visible');
    }, 4000);
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

function setFieldError(errorElementId, message, inputElement = null) {
    const errorElement = document.getElementById(errorElementId);
    if (errorElement) {
        errorElement.textContent = message || '';
        errorElement.classList.toggle('is-visible', Boolean(message));
    }

    if (inputElement) {
        inputElement.classList.toggle('is-invalid', Boolean(message));
        inputElement.setAttribute('aria-invalid', String(Boolean(message)));
    }
}

function clearFormErrors(formElement, errorElementIds = []) {
    errorElementIds.forEach((id) => setFieldError(id, ''));
    formElement?.querySelectorAll('.is-invalid').forEach((input) => {
        input.classList.remove('is-invalid');
        input.removeAttribute('aria-invalid');
    });
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
        const signupErrorIds = [
            'signup-fname-error',
            'signup-lname-error',
            'signup-email-error',
            'signup-password-error',
            'signup-confirm-password-error',
            'signup-terms-error',
            'signup-form-error'
        ];
        const signupPasswordInput = signupForm.querySelector('input[name="password"]');
        const signupConfirmInput = signupForm.querySelector('input[name="confirm-password"]');

        const validateConfirmPassword = () => {
            if (!signupConfirmInput || !signupPasswordInput) {
                return true;
            }

            if (!signupConfirmInput.value) {
                setFieldError('signup-confirm-password-error', '', signupConfirmInput);
                return false;
            }

            const matches = signupPasswordInput.value === signupConfirmInput.value;
            setFieldError(
                'signup-confirm-password-error',
                matches ? '' : 'Passwords do not match.',
                signupConfirmInput
            );
            return matches;
        };

        signupConfirmInput?.addEventListener('input', validateConfirmPassword);
        signupPasswordInput?.addEventListener('input', () => {
            if (signupConfirmInput?.value) {
                validateConfirmPassword();
            }
        });

        signupForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            clearFormErrors(signupForm, signupErrorIds);

            const firstNameInput = signupForm.querySelector('input[name="fname"]');
            const lastNameInput = signupForm.querySelector('input[name="lname"]');
            const emailInput = signupForm.querySelector('input[name="email"]');
            const termsInput = signupForm.querySelector('input[name="terms"]');

            const firstName = firstNameInput.value.trim();
            const lastName = lastNameInput.value.trim();
            const email = emailInput.value.trim();
            const password = signupPasswordInput.value;
            const confirmPassword = signupConfirmInput?.value;

            let isValid = true;

            if (!firstName) {
                setFieldError('signup-fname-error', 'First name is required.', firstNameInput);
                isValid = false;
            }
            if (!lastName) {
                setFieldError('signup-lname-error', 'Last name is required.', lastNameInput);
                isValid = false;
            }
            if (!email) {
                setFieldError('signup-email-error', 'Email is required.', emailInput);
                isValid = false;
            } else if (!emailInput.checkValidity()) {
                setFieldError('signup-email-error', 'Enter a valid email address.', emailInput);
                isValid = false;
            }
            if (!password) {
                setFieldError('signup-password-error', 'Password is required.', signupPasswordInput);
                isValid = false;
            } else if (password.length < 8) {
                setFieldError('signup-password-error', 'Password must be at least 8 characters.', signupPasswordInput);
                isValid = false;
            }
            if (confirmPassword !== undefined) {
                if (!confirmPassword) {
                    setFieldError('signup-confirm-password-error', 'Confirm your password.', signupConfirmInput);
                    isValid = false;
                } else if (password !== confirmPassword) {
                    setFieldError('signup-confirm-password-error', 'Passwords do not match.', signupConfirmInput);
                    signupConfirmInput.focus();
                    isValid = false;
                }
            }
            if (!termsInput.checked) {
                setFieldError('signup-terms-error', 'Please agree to the Terms and Conditions.', null);
                isValid = false;
            }

            if (!isValid) {
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
                    setFieldError('signup-email-error', 'This email is already registered. Please sign in instead.', emailInput);
                    setFieldError('signup-form-error', 'You already have an account. Redirecting you to sign in...');
                    setTimeout(() => window.location.replace('sign-in.html'), 1800);
                } else {
                    setFieldError('signup-form-error', error.message || 'Unable to create your account.');
                }
            }
        });
    }

    const signInForm = document.getElementById('sign-in-form');
    if (signInForm) {
        const signInErrorIds = ['sign-in-email-error', 'sign-in-password-error', 'sign-in-form-error'];
        const signInEmailInput = document.getElementById('sign-in-email');
        const signInPasswordInput = document.getElementById('sign-in-password');

        signInEmailInput?.addEventListener('input', () => setFieldError('sign-in-email-error', '', signInEmailInput));
        signInPasswordInput?.addEventListener('input', () => setFieldError('sign-in-password-error', '', signInPasswordInput));

        signInForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            clearFormErrors(signInForm, signInErrorIds);

            const email = signInEmailInput.value.trim();
            const password = signInPasswordInput.value;

            let isValid = true;
            if (!email) {
                setFieldError('sign-in-email-error', 'Email is required.', signInEmailInput);
                isValid = false;
            } else if (!signInEmailInput.checkValidity()) {
                setFieldError('sign-in-email-error', 'Enter a valid email address.', signInEmailInput);
                isValid = false;
            }
            if (!password) {
                setFieldError('sign-in-password-error', 'Password is required.', signInPasswordInput);
                isValid = false;
            }

            if (!isValid) {
                return;
            }

            try {
                await submitAuthForm('/api/auth/login', { email, password });
            } catch (error) {
                setFieldError('sign-in-form-error', error.message || 'Invalid credentials. Please try again.');
                setFieldError('sign-in-password-error', 'Check your password and try again.', signInPasswordInput);
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



function buildRecordingDownloadUrl(recordingId) {
    const token = getStoredToken();
    return buildBackendUrl(`/api/recordings/${encodeURIComponent(recordingId)}/download?token=${encodeURIComponent(token || '')}`);
}

function renderRecordingRows(rows, bodyElement, onDelete) {
    if (!bodyElement) {
        return;
    }

    if (!rows.length) {
        bodyElement.innerHTML = '<tr><td colspan="6">No recordings yet. Use “Record” in a meeting’s More menu.</td></tr>';
        return;
    }

    bodyElement.innerHTML = rows
        .map((recording) => `
            <tr>
                <td>${escapeHtml(recording.displayName)}</td>
                <td>${escapeHtml(recording.meetingTitle || recording.roomCode)}</td>
                <td>${formatDateTime(recording.createdAt)}</td>
                <td>${formatSecondsDuration(recording.durationSeconds)}</td>
                <td>${formatFileSize(recording.sizeBytes)}</td>
                <td class="recording-actions">
                    <a class="secondary-button small-button" href="${escapeHtml(buildRecordingDownloadUrl(recording.id))}" download>Download</a>
                    <button class="icon-button small-button" type="button" data-recording-delete="${escapeHtml(recording.id)}" aria-label="Delete recording">🗑️</button>
                </td>
            </tr>
        `)
        .join('');

    bodyElement.querySelectorAll('[data-recording-delete]').forEach((button) => {
        button.addEventListener('click', async () => {
            if (!window.confirm('Delete this recording permanently?')) {
                return;
            }

            try {
                await requestJson(`/api/recordings/${encodeURIComponent(button.dataset.recordingDelete)}`, { method: 'DELETE' });
                await onDelete?.();
            } catch (error) {
                alert(error.message || 'Unable to delete the recording.');
            }
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
    const recordMeetingButton = document.getElementById('record-meeting-button');
    const recordMeetingHint = document.getElementById('record-meeting-hint');
    const recordingIndicator = document.getElementById('meeting-recording-indicator');
    const recordingTimerElement = document.getElementById('meeting-recording-timer');
    const shareInviteButton = document.getElementById('share-invite-button');
    const shareModal = document.getElementById('share-modal');
    const shareModalClose = document.getElementById('share-modal-close');
    const shareLinkInput = document.getElementById('share-link-input');
    const shareCodeInput = document.getElementById('share-code-input');
    const shareCopyLinkButton = document.getElementById('share-copy-link-button');
    const shareCopyCodeButton = document.getElementById('share-copy-code-button');
    const shareNativeButton = document.getElementById('share-target-native');
    const shareModalStatus = document.getElementById('share-modal-status');
    const captionsDetectedLanguage = document.getElementById('captions-detected-language');
    const pollModal = document.getElementById('poll-modal');
    const pollModalClose = document.getElementById('poll-modal-close');
    const pollCancelButton = document.getElementById('poll-cancel-button');
    const pollForm = document.getElementById('poll-form');
    const pollQuestionInput = document.getElementById('poll-question');
    const pollOptionInputs = document.getElementById('poll-option-inputs');
    const pollAddOptionButton = document.getElementById('poll-add-option');
    const hostControlsSection = document.getElementById('host-controls-section');
    const hostMuteAllButton = document.getElementById('host-mute-all-button');
    const hostVideoOffAllButton = document.getElementById('host-video-off-all-button');
    const hostLowerHandsButton = document.getElementById('host-lower-hands-button');
    const hostSettingInputs = {
        muteOnEntry: document.getElementById('host-setting-mute-on-entry'),
        videoOffOnEntry: document.getElementById('host-setting-video-off-on-entry'),
        allowParticipantUnmute: document.getElementById('host-setting-allow-unmute'),
        allowParticipantVideo: document.getElementById('host-setting-allow-video'),
        allowParticipantScreenShare: document.getElementById('host-setting-allow-screen-share'),
        allowParticipantChat: document.getElementById('host-setting-allow-chat'),
        allowParticipantRecording: document.getElementById('host-setting-allow-recording')
    };

    const remoteStreams = new Map();
    const peerConnections = new Map();
    const pendingOfferPeers = new Set();
    const audioAnalyzers = new Map();
    const participantAudioLevels = new Map();
    const chatMessages = [];
    const pollDraftSelections = new Map();
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
    let autoDetectedSpeechLanguage = '';
    let languageDetectionPending = false;
    const isLocalHost = roomData?.meeting?.hostUserId === user.id;
    const meetingSettings = {
        muteOnEntry: true,
        videoOffOnEntry: true,
        allowParticipantUnmute: true,
        allowParticipantVideo: true,
        allowParticipantScreenShare: true,
        allowParticipantChat: true,
        allowParticipantRecording: false
    };
    const recordingState = {
        recorder: null,
        chunks: [],
        stream: null,
        micStream: null,
        audioContext: null,
        startedAt: 0,
        timer: null,
        uploading: false
    };
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

    function getMeetingLink() {
        return `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(normalizeRoomCodeInput(activeRoomCode))}`;
    }

    async function writeToClipboard(text) {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const tempInput = document.createElement('input');
        tempInput.value = text;
        tempInput.setAttribute('readonly', '');
        tempInput.style.position = 'fixed';
        tempInput.style.opacity = '0';
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        tempInput.remove();
    }

    function setShareStatus(message) {
        if (shareModalStatus) {
            shareModalStatus.textContent = message || '';
        }
    }

    function updateShareTargets() {
        const meetingLink = getMeetingLink();
        const roomCodeValue = normalizeRoomCodeInput(activeRoomCode);
        const title = roomData.meeting.title || 'Vyom meeting';
        const inviteText = `${user.name} is inviting you to a Vyom meeting: "${title}".\nJoin here: ${meetingLink}\nMeeting code: ${roomCodeValue}`;

        if (shareLinkInput) {
            shareLinkInput.value = meetingLink;
        }
        if (shareCodeInput) {
            shareCodeInput.value = roomCodeValue;
        }

        const whatsapp = document.getElementById('share-target-whatsapp');
        const telegram = document.getElementById('share-target-telegram');
        const email = document.getElementById('share-target-email');
        const post = document.getElementById('share-target-x');

        if (whatsapp) {
            whatsapp.href = `https://wa.me/?text=${encodeURIComponent(inviteText)}`;
        }
        if (telegram) {
            telegram.href = `https://t.me/share/url?url=${encodeURIComponent(meetingLink)}&text=${encodeURIComponent(inviteText)}`;
        }
        if (email) {
            email.href = `mailto:?subject=${encodeURIComponent(`Join my Vyom meeting: ${title}`)}&body=${encodeURIComponent(inviteText)}`;
        }
        if (post) {
            post.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(inviteText)}`;
        }
        if (shareNativeButton) {
            shareNativeButton.classList.toggle('is-hidden', typeof navigator.share !== 'function');
            shareNativeButton.dataset.shareText = inviteText;
        }
    }

    function openShareModal() {
        updateShareTargets();
        setShareStatus('');
        shareModal?.classList.remove('is-hidden');
        shareModal?.setAttribute('aria-hidden', 'false');
        shareLinkInput?.focus();
        shareLinkInput?.select();
    }

    function closeShareModal() {
        shareModal?.classList.add('is-hidden');
        shareModal?.setAttribute('aria-hidden', 'true');
    }

    async function copyMeetingLink() {
        await writeToClipboard(getMeetingLink());
        setShareStatus('Meeting link copied to your clipboard.');
    }

    function applyMeetingSettings(settings = {}) {
        Object.keys(meetingSettings).forEach((key) => {
            if (typeof settings[key] === 'boolean') {
                meetingSettings[key] = settings[key];
            }
        });

        Object.entries(hostSettingInputs).forEach(([key, input]) => {
            if (input) {
                input.checked = Boolean(meetingSettings[key]);
            }
        });

        updateParticipantPermissionUi();
    }

    function canParticipantUnmute() {
        return isLocalHost || meetingSettings.allowParticipantUnmute;
    }

    function canParticipantStartVideo() {
        return isLocalHost || meetingSettings.allowParticipantVideo;
    }

    function updateParticipantPermissionUi() {
        const lockAudio = !audioEnabled && !canParticipantUnmute();
        if (muteToggleButton) {
            muteToggleButton.disabled = lockAudio;
            muteToggleButton.title = lockAudio ? 'The host has muted you and disabled self-unmute.' : '';
        }

        const lockVideo = !videoEnabled && !canParticipantStartVideo();
        if (cameraToggleButton) {
            cameraToggleButton.disabled = lockVideo;
            cameraToggleButton.title = lockVideo ? 'The host has disabled starting video.' : '';
        }

        const lockShare = !isLocalHost && !meetingSettings.allowParticipantScreenShare;
        if (screenShareButton) {
            screenShareButton.disabled = lockShare && !screenShareStream;
            screenShareButton.title = lockShare ? 'The host has disabled screen sharing.' : '';
        }

        const lockChat = !isLocalHost && !meetingSettings.allowParticipantChat;
        if (chatComposer) {
            chatComposer.classList.toggle('is-locked', lockChat);
            chatComposer.querySelectorAll('textarea, button').forEach((control) => {
                control.disabled = lockChat;
            });
        }

        const lockRecording = !isLocalHost && !meetingSettings.allowParticipantRecording;
        if (recordMeetingButton) {
            recordMeetingButton.disabled = lockRecording && !recordingState.recorder;
        }
        if (recordMeetingHint && lockRecording && !recordingState.recorder) {
            recordMeetingHint.textContent = 'Host has disabled recording';
        }
    }

    function emitHostSettings() {
        if (!isLocalHost) {
            return;
        }

        const patch = {};
        Object.entries(hostSettingInputs).forEach(([key, input]) => {
            if (input) {
                patch[key] = Boolean(input.checked);
                meetingSettings[key] = patch[key];
            }
        });

        socket.emit('meeting:update-room-settings', { roomCode: activeRoomCode, settings: patch });
        updateParticipantPermissionUi();
    }

    function sendHostCommand(action, targetSocketId = null) {
        if (!isLocalHost) {
            return;
        }

        socket.emit('meeting:host-command', { roomCode: activeRoomCode, action, targetSocketId });
    }

    function formatClock(totalSeconds) {
        const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
        const seconds = String(Math.floor(totalSeconds % 60)).padStart(2, '0');
        return `${minutes}:${seconds}`;
    }

    function updateRecordingUi() {
        const isRecording = Boolean(recordingState.recorder);
        recordingIndicator?.classList.toggle('is-hidden', !isRecording);
        if (recordMeetingButton) {
            recordMeetingButton.classList.toggle('is-active', isRecording);
            const label = recordMeetingButton.querySelector('strong');
            if (label) {
                label.textContent = isRecording ? 'Stop recording' : 'Record';
            }
        }
        if (recordMeetingHint) {
            if (recordingState.uploading) {
                recordMeetingHint.textContent = 'Saving to your history...';
            } else if (isRecording) {
                recordMeetingHint.textContent = 'Recording in progress';
            } else if (!isLocalHost && !meetingSettings.allowParticipantRecording) {
                recordMeetingHint.textContent = 'Host has disabled recording';
            } else {
                recordMeetingHint.textContent = 'Save to your history';
            }
        }
    }

    function pickRecordingMimeType() {
        const candidates = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm'
        ];

        return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || '';
    }

    async function uploadRecording(blob, durationSeconds) {
        recordingState.uploading = true;
        updateRecordingUi();

        try {
            const response = await fetch(
                buildBackendUrl(`/api/meetings/${encodeURIComponent(activeRoomCode)}/recordings`),
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'video/webm',
                        Authorization: `Bearer ${getStoredToken()}`,
                        'X-Vyom-Recording-Name': `${roomData.meeting.title} ${new Date().toLocaleString()}`.replace(/[^\w\s.-]/g, ''),
                        'X-Vyom-Recording-Duration': String(Math.round(durationSeconds))
                    },
                    body: blob
                }
            );

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.message || 'Unable to save the recording.');
            }

            alert('Recording saved. You can download it from your dashboard under Recordings.');
        } catch (error) {
            alert(error.message || 'Unable to save the recording.');
        } finally {
            recordingState.uploading = false;
            updateRecordingUi();
        }
    }

    function cleanupRecordingStreams() {
        recordingState.stream?.getTracks().forEach((track) => track.stop());
        recordingState.micStream?.getTracks().forEach((track) => track.stop());
        recordingState.audioContext?.close().catch(() => {});
        recordingState.stream = null;
        recordingState.micStream = null;
        recordingState.audioContext = null;
    }

    async function startMeetingRecording() {
        if (recordingState.recorder) {
            return;
        }

        if (!window.MediaRecorder || !navigator.mediaDevices?.getDisplayMedia) {
            alert('Recording is not supported in this browser.');
            return;
        }

        if (!isLocalHost && !meetingSettings.allowParticipantRecording) {
            alert('The host has disabled recording for participants.');
            return;
        }

        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 30 },
            audio: true
        });

        const audioTracks = [];
        let mixedAudioTrack = null;

        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const destination = audioContext.createMediaStreamDestination();
            let hasAudioSource = false;

            if (displayStream.getAudioTracks().length) {
                audioContext.createMediaStreamSource(new MediaStream(displayStream.getAudioTracks())).connect(destination);
                hasAudioSource = true;
            }

            const micTracks = localStream?.getAudioTracks() || [];
            if (micTracks.length) {
                recordingState.micStream = new MediaStream([micTracks[0].clone()]);
                audioContext.createMediaStreamSource(recordingState.micStream).connect(destination);
                hasAudioSource = true;
            }

            if (hasAudioSource) {
                recordingState.audioContext = audioContext;
                mixedAudioTrack = destination.stream.getAudioTracks()[0];
            } else {
                await audioContext.close().catch(() => {});
            }
        } catch (error) {
            console.warn('Recording audio mix failed:', error.message);
        }

        if (mixedAudioTrack) {
            audioTracks.push(mixedAudioTrack);
        } else {
            audioTracks.push(...displayStream.getAudioTracks());
        }

        const recordingStream = new MediaStream([...displayStream.getVideoTracks(), ...audioTracks]);
        const mimeType = pickRecordingMimeType();
        const recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);

        recordingState.stream = displayStream;
        recordingState.chunks = [];
        recordingState.recorder = recorder;
        recordingState.startedAt = Date.now();

        recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordingState.chunks.push(event.data);
            }
        };

        recorder.onstop = async () => {
            const durationSeconds = (Date.now() - recordingState.startedAt) / 1000;
            const blob = new Blob(recordingState.chunks, { type: 'video/webm' });
            recordingState.chunks = [];
            recordingState.recorder = null;
            clearInterval(recordingState.timer);
            recordingState.timer = null;
            cleanupRecordingStreams();
            updateRecordingUi();

            if (blob.size > 0) {
                await uploadRecording(blob, durationSeconds);
            }
        };

        displayStream.getVideoTracks()[0]?.addEventListener('ended', () => {
            stopMeetingRecording();
        });

        recorder.start(1000);
        recordingState.timer = setInterval(() => {
            if (recordingTimerElement) {
                recordingTimerElement.textContent = formatClock((Date.now() - recordingState.startedAt) / 1000);
            }
        }, 500);
        if (recordingTimerElement) {
            recordingTimerElement.textContent = '00:00';
        }
        updateRecordingUi();
    }

    function stopMeetingRecording() {
        if (recordingState.recorder && recordingState.recorder.state !== 'inactive') {
            recordingState.recorder.stop();
        }
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
            const showHostActions = isLocalHost && participant.socketId && !isSelfParticipant(participant);
            const hostActions = showHostActions
                ? `
                    <div class="participant-row__host-actions">
                        <button class="mini-action-button" type="button" data-host-action="mute" data-target-socket="${escapeHtml(participant.socketId)}" title="Mute participant" aria-label="Mute ${escapeHtml(participant.name)}">🔇</button>
                        <button class="mini-action-button" type="button" data-host-action="video-off" data-target-socket="${escapeHtml(participant.socketId)}" title="Turn off participant video" aria-label="Turn off video for ${escapeHtml(participant.name)}">🚫</button>
                        <button class="mini-action-button" type="button" data-host-action="remove" data-target-socket="${escapeHtml(participant.socketId)}" title="Remove from meeting" aria-label="Remove ${escapeHtml(participant.name)}">⛔</button>
                    </div>
                `
                : '';
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
                        ${hostActions}
                    </div>
                </div>
            `;
        }).join('');

        participantsDrawerList.querySelectorAll('[data-host-action]').forEach((button) => {
            button.addEventListener('click', () => {
                const action = button.dataset.hostAction;
                const targetSocketId = button.dataset.targetSocket;
                if (action === 'remove' && !window.confirm('Remove this participant from the meeting?')) {
                    return;
                }
                sendHostCommand(action, targetSocketId);
            });
        });
    }

    function parsePollMessage(rawMessage) {
        if (typeof rawMessage !== 'string' || !rawMessage.startsWith('[POLL]: ')) {
            return null;
        }

        try {
            const poll = JSON.parse(rawMessage.slice(8));
            if (!poll || !Array.isArray(poll.options) || poll.options.length < 2) {
                return null;
            }

            poll.votes = Array.from({ length: poll.options.length }, (_, index) => Number(poll.votes?.[index] || 0));
            poll.voters = Array.isArray(poll.voters) ? poll.voters : [];
            return poll;
        } catch (error) {
            return null;
        }
    }

    function getPollSelections(messageId, poll) {
        if (pollDraftSelections.has(messageId)) {
            return pollDraftSelections.get(messageId);
        }

        const myVote = poll.voters.find((voter) => voter.userId === user.id);
        return new Set(myVote?.selections || []);
    }

    function renderPollCard(item, poll) {
        const respondentCount = poll.voters.length;
        const myVote = poll.voters.find((voter) => voter.userId === user.id);
        const selections = getPollSelections(item.id, poll);
        const canManagePoll = isLocalHost || poll.createdBy === user.id || item.author.id === user.id;
        const inputType = poll.selectionMode === 'multi' ? 'checkbox' : 'radio';

        const optionsMarkup = poll.options.map((option, index) => {
            const isSelected = selections.has(index);
            const voteCount = poll.votes[index];
            const percentage = respondentCount ? Math.round((voteCount / respondentCount) * 100) : 0;

            // Only the host sees live tallies so participants are not influenced by running results.
            const resultsMarkup = isLocalHost
                ? `
                    <div class="poll-option__result">
                        <div class="poll-option__bar"><span style="width:${percentage}%"></span></div>
                        <div class="poll-option__numbers">
                            <strong>${percentage}%</strong>
                            <span>${voteCount} vote${voteCount === 1 ? '' : 's'}</span>
                        </div>
                    </div>
                `
                : '';

            return `
                <label class="poll-option ${isSelected ? 'is-selected' : ''} ${poll.closed ? 'is-disabled' : ''}">
                    <span class="poll-option__control">
                        <input type="${inputType}" name="poll-${item.id}" value="${index}" ${isSelected ? 'checked' : ''} ${poll.closed ? 'disabled' : ''}>
                        <span class="poll-option__label">${escapeHtml(option)}</span>
                    </span>
                    ${resultsMarkup}
                </label>
            `;
        }).join('');

        const votersMarkup = isLocalHost && respondentCount
            ? `
                <details class="poll-voters">
                    <summary>Who responded (${respondentCount})</summary>
                    ${poll.voters.map((voter) => `
                        <div class="poll-voters__row">
                            <strong>${escapeHtml(voter.name)}</strong>
                            <span>${escapeHtml(voter.selections.map((index) => poll.options[index]).filter(Boolean).join(', '))}</span>
                        </div>
                    `).join('')}
                </details>
            `
            : '';

        const statusMarkup = poll.closed
            ? '<span class="poll-card__status is-closed">Voting closed</span>'
            : myVote
                ? '<span class="poll-card__status is-voted">✓ Your answer is recorded</span>'
                : '';

        const actionsMarkup = `
            <div class="poll-card__actions">
                ${poll.closed ? '' : `<button class="primary-button poll-vote-button" type="button" data-poll-id="${item.id}">${myVote ? 'Update vote' : 'Submit vote'}</button>`}
                ${canManagePoll ? `<button class="secondary-button poll-toggle-button" type="button" data-poll-id="${item.id}" data-poll-closed="${poll.closed ? 'true' : 'false'}">${poll.closed ? 'Reopen poll' : 'Close poll'}</button>` : ''}
            </div>
        `;

        return `
            <div class="chat-message__bubble poll-card ${poll.closed ? 'is-closed' : ''}" data-poll-card="${item.id}">
                <div class="poll-card__head">
                    <span class="poll-card__badge">Poll</span>
                    <span class="poll-card__mode">${poll.selectionMode === 'multi' ? 'Choose multiple' : 'Choose one'}</span>
                    ${isLocalHost ? `<span class="poll-card__count">${respondentCount} response${respondentCount === 1 ? '' : 's'}</span>` : ''}
                </div>
                <p class="poll-card__question">${escapeHtml(poll.question)}</p>
                <div class="poll-options" data-poll-id="${item.id}">${optionsMarkup}</div>
                ${statusMarkup}
                ${votersMarkup}
                ${actionsMarkup}
            </div>
        `;
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
            const poll = parsePollMessage(item.message);

            let bubble = '';
            if (poll) {
                bubble = renderPollCard(item, poll);
            } else {
                const attachmentMessage = parseAttachmentMessage(item.message);
                bubble = attachmentMessage
                    ? renderAttachmentCard(attachmentMessage, isSelf)
                    : `<div class="chat-message__bubble">${escapeHtml(item.message)}</div>`;
            }

            return `
                <div class="chat-message ${isSelf ? 'chat-message--self' : ''} ${poll ? 'chat-message--poll' : ''}">
                    <div class="chat-message__name">${escapeHtml(item.author.name)}</div>
                    ${bubble}
                    <div class="chat-message__meta">${formatDateTime(item.createdAt)}</div>
                </div>
            `;
        }).join('');

        if (roomState.selectedDrawer === 'chat') {
            chatMessageList.scrollTop = chatMessageList.scrollHeight;
        }

        chatMessageList.querySelectorAll('.poll-options input').forEach((input) => {
            input.addEventListener('change', () => {
                const container = input.closest('.poll-options');
                const messageId = Number(container.dataset.pollId);
                const selected = Array.from(container.querySelectorAll('input:checked')).map((checked) => Number(checked.value));
                pollDraftSelections.set(messageId, new Set(selected));
                container.querySelectorAll('.poll-option').forEach((option, index) => {
                    option.classList.toggle('is-selected', selected.includes(index));
                });
            });
        });

        chatMessageList.querySelectorAll('.poll-vote-button').forEach((button) => {
            button.addEventListener('click', () => {
                const messageId = Number(button.dataset.pollId);
                const container = chatMessageList.querySelector(`.poll-options[data-poll-id="${messageId}"]`);
                const selections = Array.from(container?.querySelectorAll('input:checked') || []).map((input) => Number(input.value));
                if (!selections.length) {
                    showMeetingToast('Choose at least one option before voting.');
                    return;
                }

                button.disabled = true;
                socket.emit('meeting:poll-vote', {
                    roomCode: activeRoomCode,
                    messageId,
                    selections
                });
            });
        });

        chatMessageList.querySelectorAll('.poll-toggle-button').forEach((button) => {
            button.addEventListener('click', () => {
                socket.emit('meeting:poll-close', {
                    roomCode: activeRoomCode,
                    messageId: Number(button.dataset.pollId),
                    closed: button.dataset.pollClosed !== 'true'
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
        updateParticipantPermissionUi();
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
        updateParticipantPermissionUi();
        renderMeetingState();
    }

    function navigateToDashboardWithoutMeetingHistory() {
        activeRoomCode = '';
        window.removeEventListener('popstate', handleMeetingBackNavigation);
        window.location.replace('dashboard.html');
    }

    const SPEECH_LANGUAGE_BY_CODE = {
        en: 'en-US',
        hi: 'hi-IN',
        es: 'es-ES',
        fr: 'fr-FR',
        de: 'de-DE',
        pt: 'pt-BR',
        it: 'it-IT',
        ja: 'ja-JP',
        ko: 'ko-KR',
        zh: 'zh-CN',
        ar: 'ar-SA',
        ru: 'ru-RU',
        bn: 'bn-IN',
        ta: 'ta-IN',
        te: 'te-IN',
        mr: 'mr-IN',
        gu: 'gu-IN',
        pa: 'pa-IN',
        ur: 'ur-IN',
        nl: 'nl-NL',
        tr: 'tr-TR',
        id: 'id-ID'
    };

    function isAutoLanguageDetection() {
        return (captionsLanguageSelect?.value || 'auto') === 'auto';
    }

    function resolveSpeechLanguage() {
        if (!isAutoLanguageDetection()) {
            return captionsLanguageSelect.value;
        }

        return autoDetectedSpeechLanguage || navigator.language || 'en-US';
    }

    function describeDetectedLanguage(languageTag) {
        if (!captionsDetectedLanguage) {
            return;
        }

        if (!isAutoLanguageDetection()) {
            captionsDetectedLanguage.textContent = '';
            return;
        }

        let label = languageTag;
        try {
            label = new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(languageTag) || languageTag;
        } catch (error) {
            // Fall back to the raw tag when Intl.DisplayNames is unavailable.
        }

        captionsDetectedLanguage.textContent = `Auto detected: ${label}`;
    }

    // Detects the spoken language from the transcript so recognition can retune itself mid-meeting.
    async function detectTranscriptLanguage(text) {
        const sample = String(text || '').trim();
        if (!isCaptionsEnabled || !isAutoLanguageDetection() || languageDetectionPending || sample.length < 12) {
            return;
        }

        languageDetectionPending = true;
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(sample.slice(-240))}`;
            const response = await fetch(url);
            if (!response.ok) {
                return;
            }

            const data = await response.json();
            const detectedCode = String(data?.[2] || '').split('-')[0].toLowerCase();
            const nextLanguage = SPEECH_LANGUAGE_BY_CODE[detectedCode];
            if (!nextLanguage) {
                return;
            }

            describeDetectedLanguage(nextLanguage);
            if (nextLanguage !== autoDetectedSpeechLanguage) {
                autoDetectedSpeechLanguage = nextLanguage;
                if (recognition && isCaptionsEnabled) {
                    recognition.lang = nextLanguage;
                    recognition.stop();
                }
            }
        } catch (error) {
            console.warn('Language detection failed:', error.message);
        } finally {
            languageDetectionPending = false;
        }
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
        if (state?.settings) {
            applyMeetingSettings(state.settings);
        }
        if (state?.entryState) {
            applyAudioToggle(Boolean(state.entryState.audioEnabled), false);
            applyVideoToggle(Boolean(state.entryState.videoEnabled) && Boolean(localStream), false);
            if (!state.entryState.audioEnabled || !state.entryState.videoEnabled) {
                showMeetingToast('You joined with the host\'s entry settings applied.');
            }
        }
        if (state?.whiteboard?.strokes) {
            roomState.whiteboard.strokes = state.whiteboard.strokes;
            redrawWhiteboardCanvas();
        }
        renderMeetingState();
    });

    socket.on('meeting:room-settings', ({ settings } = {}) => {
        applyMeetingSettings(settings || {});
    });

    socket.on('meeting:host-action', ({ action, hostName } = {}) => {
        const host = hostName || 'The host';
        if (action === 'mute') {
            applyAudioToggle(false);
            showMeetingToast(`${host} muted you.`);
            return;
        }
        if (action === 'video-off') {
            applyVideoToggle(false);
            showMeetingToast(`${host} turned off your video.`);
            return;
        }
        if (action === 'lower-hand') {
            applyRaiseHandToggle(false);
            return;
        }
        if (action === 'remove') {
            alert(`${host} removed you from this meeting.`);
            socket.emit('meeting:leave', { roomCode: activeRoomCode });
            navigateToDashboardWithoutMeetingHistory();
        }
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
        if (/ended/i.test(String(message || ''))) {
            alert(message);
            navigateToDashboardWithoutMeetingHistory();
            return;
        }

        showMeetingToast(message);
        renderChatDrawer();
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
        meetingCopyLinkButton.addEventListener('click', openShareModal);
    }
    if (shareInviteButton) {
        shareInviteButton.addEventListener('click', () => {
            closeMorePanel();
            openShareModal();
        });
    }
    if (shareModalClose) {
        shareModalClose.addEventListener('click', closeShareModal);
    }
    if (shareModal) {
        shareModal.addEventListener('click', (event) => {
            if (event.target === shareModal) {
                closeShareModal();
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !shareModal.classList.contains('is-hidden')) {
                closeShareModal();
            }
        });
    }
    if (shareCopyLinkButton) {
        shareCopyLinkButton.addEventListener('click', () => {
            copyMeetingLink().catch((error) => setShareStatus(error.message || 'Unable to copy the meeting link.'));
        });
    }
    if (shareCopyCodeButton) {
        shareCopyCodeButton.addEventListener('click', () => {
            writeToClipboard(normalizeRoomCodeInput(activeRoomCode))
                .then(() => setShareStatus('Meeting code copied to your clipboard.'))
                .catch((error) => setShareStatus(error.message || 'Unable to copy the meeting code.'));
        });
    }
    if (shareNativeButton) {
        shareNativeButton.addEventListener('click', async () => {
            try {
                await navigator.share({
                    title: roomData.meeting.title || 'Vyom meeting',
                    text: shareNativeButton.dataset.shareText || '',
                    url: getMeetingLink()
                });
            } catch (error) {
                if (error.name !== 'AbortError') {
                    setShareStatus('Sharing was cancelled.');
                }
            }
        });
    }
    if (recordMeetingButton) {
        recordMeetingButton.addEventListener('click', async () => {
            if (recordingState.recorder) {
                stopMeetingRecording();
                return;
            }

            try {
                await startMeetingRecording();
            } catch (error) {
                if (error.name !== 'NotAllowedError') {
                    alert(error.message || 'Unable to start recording.');
                }
            }
        });
    }
    Object.values(hostSettingInputs).forEach((input) => {
        input?.addEventListener('change', emitHostSettings);
    });
    if (hostMuteAllButton) {
        hostMuteAllButton.addEventListener('click', () => sendHostCommand('mute'));
    }
    if (hostVideoOffAllButton) {
        hostVideoOffAllButton.addEventListener('click', () => sendHostCommand('video-off'));
    }
    if (hostLowerHandsButton) {
        hostLowerHandsButton.addEventListener('click', () => sendHostCommand('lower-hand'));
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
    function renderPollOptionInputs(values = ['', '']) {
        if (!pollOptionInputs) {
            return;
        }

        pollOptionInputs.innerHTML = values.map((value, index) => `
            <div class="poll-option-input">
                <input type="text" maxlength="100" placeholder="Option ${index + 1}" value="${escapeHtml(value)}" data-poll-option-index="${index}">
                <button class="mini-action-button" type="button" data-remove-option="${index}" aria-label="Remove option ${index + 1}" ${values.length <= 2 ? 'disabled' : ''}>✕</button>
            </div>
        `).join('');

        pollOptionInputs.querySelectorAll('[data-remove-option]').forEach((button) => {
            button.addEventListener('click', () => {
                const current = readPollOptionInputs();
                current.splice(Number(button.dataset.removeOption), 1);
                renderPollOptionInputs(current);
            });
        });
    }

    function readPollOptionInputs() {
        return Array.from(pollOptionInputs?.querySelectorAll('input') || []).map((input) => input.value);
    }

    function openPollModal() {
        if (!isLocalHost && !meetingSettings.allowParticipantChat) {
            showMeetingToast('The host has disabled chat and polls for participants.');
            return;
        }

        if (pollQuestionInput) {
            pollQuestionInput.value = '';
            pollQuestionInput.classList.remove('is-invalid');
        }
        const singleMode = pollForm?.querySelector('input[name="poll-selection-mode"][value="single"]');
        if (singleMode) {
            singleMode.checked = true;
        }
        renderPollOptionInputs(['', '']);
        setFieldError('poll-form-error', '');
        pollModal?.classList.remove('is-hidden');
        pollModal?.setAttribute('aria-hidden', 'false');
        pollQuestionInput?.focus();
    }

    function closePollModal() {
        pollModal?.classList.add('is-hidden');
        pollModal?.setAttribute('aria-hidden', 'true');
    }

    if (chatCreatePollButton) {
        chatCreatePollButton.addEventListener('click', openPollModal);
    }
    if (pollAddOptionButton) {
        pollAddOptionButton.addEventListener('click', () => {
            const current = readPollOptionInputs();
            if (current.length >= 8) {
                setFieldError('poll-form-error', 'A poll can have up to 8 options.');
                return;
            }
            renderPollOptionInputs([...current, '']);
            const inputs = pollOptionInputs?.querySelectorAll('input');
            inputs?.[inputs.length - 1]?.focus();
        });
    }
    pollModalClose?.addEventListener('click', closePollModal);
    pollCancelButton?.addEventListener('click', closePollModal);
    pollModal?.addEventListener('click', (event) => {
        if (event.target === pollModal) {
            closePollModal();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && pollModal && !pollModal.classList.contains('is-hidden')) {
            closePollModal();
        }
    });
    if (pollForm) {
        pollForm.addEventListener('submit', (event) => {
            event.preventDefault();
            setFieldError('poll-form-error', '');

            const question = pollQuestionInput?.value.trim();
            if (!question) {
                setFieldError('poll-form-error', 'Enter a question for your poll.', pollQuestionInput);
                pollQuestionInput?.focus();
                return;
            }

            const options = readPollOptionInputs().map((value) => value.trim()).filter(Boolean);
            if (options.length < 2) {
                setFieldError('poll-form-error', 'Add at least two non-empty options.');
                return;
            }

            if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
                setFieldError('poll-form-error', 'Poll options must be unique.');
                return;
            }

            const selectionMode = pollForm.querySelector('input[name="poll-selection-mode"]:checked')?.value === 'multi'
                ? 'multi'
                : 'single';

            socket.emit('meeting:chat-message', {
                roomCode: activeRoomCode,
                message: `[POLL]: ${JSON.stringify({ type: 'poll', question, options, selectionMode })}`
            });

            closePollModal();
            setDrawerState('chat', true);
            showMeetingToast('Poll launched in chat.');
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
                    recognition.lang = resolveSpeechLanguage();
                    describeDetectedLanguage(recognition.lang);
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
                        detectTranscriptLanguage(finalTranscriptText || transcriptText);
                    };
                    recognition.onerror = (event) => {
                        if (captionsOverlay) captionsOverlay.textContent = `Transcription error: ${event.error}`;
                    };
                    recognition.onend = () => {
                        if (isCaptionsEnabled) {
                            recognition.lang = resolveSpeechLanguage();
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
            autoDetectedSpeechLanguage = '';
            if (captionsDetectedLanguage) {
                captionsDetectedLanguage.textContent = isAutoLanguageDetection() ? 'Auto detecting language...' : '';
            }
            if (recognition && isCaptionsEnabled) {
                recognition.lang = resolveSpeechLanguage();
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
            if (!isLocalHost && !meetingSettings.allowParticipantChat) {
                showMeetingToast('The host has disabled chat for participants.');
                return;
            }
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
            if (!isLocalHost && !meetingSettings.allowParticipantScreenShare) {
                showMeetingToast('The host has disabled screen sharing for participants.');
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
            if (recordingState.recorder) {
                stopMeetingRecording();
                showMeetingToast('Saving your recording before you leave...');
                await new Promise((resolve) => setTimeout(resolve, 1200));
            }

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
    closeShareModal();
    closePollModal();
    hostControlsSection?.classList.toggle('is-hidden', !isLocalHost);
    applyMeetingSettings(meetingSettings);
    updateShareTargets();
    updateRecordingUi();
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
    let recordings = [];
    let allMeetings = [];
    let currentWorkspaceView = 'dashboard';
    const calendarState = {
        cursor: new Date(),
        selectedKey: toDateKey(new Date())
    };

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
    const recordingsPanel = document.getElementById('recordings-panel');
    const meetingModal = document.getElementById('meeting-modal');
    const meetingModalForm = document.getElementById('meeting-modal-form');
    const meetingModalTitleInput = document.getElementById('meeting-modal-title-input');
    const meetingModalDescription = document.getElementById('meeting-modal-description');
    const meetingModalTeam = document.getElementById('meeting-modal-team');
    const meetingModalTime = document.getElementById('meeting-modal-time');
    const meetingModalAutoJoin = document.getElementById('meeting-modal-auto-join');
    const meetingModalClose = document.getElementById('meeting-modal-close');
    const meetingModalCancel = document.getElementById('meeting-modal-cancel');
    let profileAvatarDataUrl = dashboardData.profile.avatarUrl || '';

    function ensureWorkspacePanel() {
        let panel = document.getElementById('dashboard-workspace-panel');
        if (!panel) {
            panel = document.createElement('section');
            panel.id = 'dashboard-workspace-panel';
            panel.className = 'workspace-panel';
            panel.style.display = 'none';
            document.querySelector('.dashboard-content')?.insertBefore(panel, dashboardOverview?.nextSibling || null);
        }
        return panel;
    }

    const workspacePanel = ensureWorkspacePanel();

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
        await Promise.all([refreshRecordings(), refreshMeetings()]);
    }

    async function refreshMeetings() {
        try {
            const response = await requestJson('/api/meetings');
            allMeetings = response.meetings || [];
        } catch (error) {
            allMeetings = [];
        }

        if (currentWorkspaceView === 'calendar') {
            renderCalendarWorkspace();
        }
    }

    async function refreshRecordings() {
        try {
            const response = await requestJson('/api/recordings');
            recordings = response.recordings || [];
        } catch (error) {
            recordings = [];
        }

        renderRecordingRows(recordings, document.getElementById('recordings-body'), refreshRecordings);
        if (currentWorkspaceView === 'recordings') {
            renderRecordingsWorkspace();
        }
    }

    async function joinRoomAndRedirect(roomCode) {
        const normalizedRoomCode = normalizeRoomCodeInput(roomCode);
        await requestJson(`/api/meetings/${encodeURIComponent(normalizedRoomCode)}/join`, { method: 'POST' });
        redirectToMeeting(normalizedRoomCode);
    }

    function populateTeamOptions(selectElement, selectedId = '') {
        if (!selectElement) {
            return;
        }

        selectElement.innerHTML = [
            '<option value="">No team</option>',
            ...dashboardData.teams.map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`)
        ].join('');
        selectElement.value = selectedId ? String(selectedId) : '';
    }

    function openMeetingModal({ scheduledAt = new Date(), title = '' } = {}) {
        populateTeamOptions(meetingModalTeam);
        if (meetingModalTitleInput) {
            meetingModalTitleInput.value = title;
        }
        if (meetingModalDescription) {
            meetingModalDescription.value = '';
        }
        if (meetingModalTime) {
            meetingModalTime.value = toDateTimeLocalValue(scheduledAt);
        }
        if (meetingModalAutoJoin) {
            meetingModalAutoJoin.checked = localStorage.getItem('vyomDashboardAutoJoin') !== 'false';
        }
        setFieldError('meeting-modal-error', '');
        meetingModal?.classList.remove('is-hidden');
        meetingModal?.setAttribute('aria-hidden', 'false');
        meetingModalTitleInput?.focus();
    }

    function closeMeetingModal() {
        meetingModal?.classList.add('is-hidden');
        meetingModal?.setAttribute('aria-hidden', 'true');
    }

    function getMeetingDateKey(meeting) {
        return toDateKey(meeting.scheduledAt || meeting.startedAt || meeting.createdAt);
    }

    function getMeetingsByDate() {
        const map = new Map();
        allMeetings.forEach((meeting) => {
            const key = getMeetingDateKey(meeting);
            if (!key) {
                return;
            }
            if (!map.has(key)) {
                map.set(key, []);
            }
            map.get(key).push(meeting);
        });

        map.forEach((list) => {
            list.sort((left, right) => new Date(left.scheduledAt || left.createdAt) - new Date(right.scheduledAt || right.createdAt));
        });
        return map;
    }

    function renderMeetingsWorkspace() {
        if (!workspacePanel) {
            return;
        }

        workspacePanel.innerHTML = `
            <div class="section-header">
                <div><h2>Meetings</h2><p>Schedule a session or jump straight into an active room.</p></div>
                <button class="primary-button auto-button" id="workspace-new-meeting" type="button">Schedule meeting</button>
            </div>
            <div class="workspace-grid">
                <section class="surface-card">
                    <div class="panel-header"><h2>Upcoming</h2><span class="pill-count">${dashboardData.upcomingMeetings.length}</span></div>
                    <div class="upcoming-cards" id="workspace-upcoming-list"></div>
                </section>
                <section class="surface-card">
                    <div class="panel-header"><h2>Recently ended</h2><span class="pill-count">${dashboardData.meetingHistory.length}</span></div>
                    <div class="stack-list" id="workspace-recent-list"></div>
                </section>
            </div>
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
                        <div class="meeting-footer">
                            <span class="status-chip status-chip--${escapeHtml(meeting.status)}">${escapeHtml(meeting.status)}</span>
                            <button class="secondary-button small-button auto-button" type="button" data-room-code="${escapeHtml(meeting.roomCode)}">Join</button>
                        </div>
                    </article>
                `).join('')
                : '<div class="empty-state-card">No upcoming meetings yet. Schedule one to get started.</div>';
        }

        const recentList = document.getElementById('workspace-recent-list');
        if (recentList) {
            recentList.innerHTML = dashboardData.meetingHistory.length
                ? dashboardData.meetingHistory.slice(0, 8).map((meeting) => `
                    <div class="stack-list__row">
                        <div>
                            <strong>${escapeHtml(meeting.title)}</strong>
                            <span>${formatDateTime(meeting.endedAt || meeting.startedAt)} • ${formatMeetingDuration(meeting.startedAt, meeting.endedAt)}</span>
                        </div>
                        <button class="secondary-button small-button auto-button" type="button" data-room-code="${escapeHtml(meeting.roomCode)}">Relaunch</button>
                    </div>
                `).join('')
                : '<div class="empty-state-card">Nothing here yet.</div>';
        }

        document.getElementById('workspace-new-meeting')?.addEventListener('click', () => openMeetingModal());
        workspacePanel.querySelectorAll('[data-room-code]').forEach((button) => {
            button.addEventListener('click', () => joinRoomAndRedirect(button.dataset.roomCode));
        });
    }

    function renderCalendarWorkspace() {
        if (!workspacePanel) {
            return;
        }

        const meetingsByDate = getMeetingsByDate();
        const cursor = calendarState.cursor;
        const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(cursor);
        const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        const gridStart = new Date(firstOfMonth);
        gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay());
        const todayKey = toDateKey(new Date());

        const dayCells = Array.from({ length: 42 }, (_, index) => {
            const day = new Date(gridStart);
            day.setDate(gridStart.getDate() + index);
            const key = toDateKey(day);
            const dayMeetings = meetingsByDate.get(key) || [];
            const isOtherMonth = day.getMonth() !== cursor.getMonth();

            const chips = dayMeetings.slice(0, 2).map((meeting) => `
                <span class="calendar-chip calendar-chip--${escapeHtml(meeting.status)}" title="${escapeHtml(meeting.title)}">
                    ${escapeHtml(formatTimeOfDay(meeting.scheduledAt || meeting.createdAt))} ${escapeHtml(meeting.title)}
                </span>
            `).join('');

            return `
                <button class="calendar-day ${isOtherMonth ? 'is-muted' : ''} ${key === todayKey ? 'is-today' : ''} ${key === calendarState.selectedKey ? 'is-selected' : ''}"
                        type="button" data-calendar-day="${key}">
                    <span class="calendar-day__number">${day.getDate()}</span>
                    <span class="calendar-day__chips">${chips}</span>
                    ${dayMeetings.length > 2 ? `<span class="calendar-day__more">+${dayMeetings.length - 2} more</span>` : ''}
                </button>
            `;
        }).join('');

        const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            .map((label) => `<span class="calendar-weekday">${label}</span>`)
            .join('');

        workspacePanel.innerHTML = `
            <div class="section-header">
                <div><h2>Calendar</h2><p>Every meeting you host or attend, laid out by day.</p></div>
                <button class="primary-button auto-button" id="calendar-new-meeting" type="button">Schedule meeting</button>
            </div>
            <div class="calendar-layout">
                <section class="surface-card calendar-card">
                    <div class="calendar-toolbar">
                        <div class="calendar-nav">
                            <button class="icon-button" id="calendar-prev" type="button" aria-label="Previous month">‹</button>
                            <strong id="calendar-month-label">${escapeHtml(monthLabel)}</strong>
                            <button class="icon-button" id="calendar-next" type="button" aria-label="Next month">›</button>
                        </div>
                        <button class="secondary-button auto-button" id="calendar-today" type="button">Today</button>
                    </div>
                    <div class="calendar-weekdays">${weekdayLabels}</div>
                    <div class="calendar-grid">${dayCells}</div>
                </section>
                <aside class="surface-card calendar-detail" id="calendar-detail"></aside>
            </div>
        `;

        renderCalendarDetail(meetingsByDate);

        document.getElementById('calendar-prev')?.addEventListener('click', () => {
            calendarState.cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
            renderCalendarWorkspace();
        });
        document.getElementById('calendar-next')?.addEventListener('click', () => {
            calendarState.cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
            renderCalendarWorkspace();
        });
        document.getElementById('calendar-today')?.addEventListener('click', () => {
            calendarState.cursor = new Date();
            calendarState.selectedKey = toDateKey(new Date());
            renderCalendarWorkspace();
        });
        document.getElementById('calendar-new-meeting')?.addEventListener('click', () => {
            openMeetingModal({ scheduledAt: calendarSelectedDateTime() });
        });
        workspacePanel.querySelectorAll('[data-calendar-day]').forEach((button) => {
            button.addEventListener('click', () => {
                calendarState.selectedKey = button.dataset.calendarDay;
                renderCalendarWorkspace();
            });
        });
    }

    function calendarSelectedDateTime() {
        const [year, month, day] = String(calendarState.selectedKey || '').split('-').map(Number);
        if (!year) {
            return new Date();
        }

        const now = new Date();
        const selected = new Date(year, month - 1, day, now.getHours() + 1, 0, 0, 0);
        return selected;
    }

    function renderCalendarDetail(meetingsByDate) {
        const detail = document.getElementById('calendar-detail');
        if (!detail) {
            return;
        }

        const dayMeetings = meetingsByDate.get(calendarState.selectedKey) || [];
        const selectedDate = calendarSelectedDateTime();
        const heading = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(selectedDate);

        detail.innerHTML = `
            <div class="panel-header"><h2>${escapeHtml(heading)}</h2><span class="pill-count">${dayMeetings.length}</span></div>
            <div class="stack-list">
                ${dayMeetings.length
                    ? dayMeetings.map((meeting) => `
                        <div class="stack-list__row">
                            <div>
                                <strong>${escapeHtml(meeting.title)}</strong>
                                <span>${escapeHtml(formatTimeOfDay(meeting.scheduledAt || meeting.createdAt))} • ${escapeHtml(meeting.teamName)} • ${escapeHtml(meeting.isHost ? 'You host' : meeting.hostName)}</span>
                            </div>
                            <div class="stack-list__actions">
                                <span class="status-chip status-chip--${escapeHtml(meeting.status)}">${escapeHtml(meeting.status)}</span>
                                ${meeting.status === 'ended'
                                    ? ''
                                    : `<button class="secondary-button small-button auto-button" type="button" data-room-code="${escapeHtml(meeting.roomCode)}">Join</button>`}
                            </div>
                        </div>
                    `).join('')
                    : '<div class="empty-state-card">Nothing scheduled for this day.</div>'}
            </div>
            <button class="secondary-button" id="calendar-detail-schedule" type="button">Schedule on this day</button>
        `;

        detail.querySelectorAll('[data-room-code]').forEach((button) => {
            button.addEventListener('click', () => joinRoomAndRedirect(button.dataset.roomCode));
        });
        document.getElementById('calendar-detail-schedule')?.addEventListener('click', () => {
            openMeetingModal({ scheduledAt: calendarSelectedDateTime() });
        });
    }


    function renderTeamsWorkspace() {
        if (!workspacePanel) {
            return;
        }

        workspacePanel.innerHTML = `
            <div class="section-header"><div><h2>Teams</h2><p>Group your meetings and members into focused spaces.</p></div></div>
            <div class="workspace-grid">
                <section class="surface-card">
                    <div class="panel-header"><h2>Create a team</h2></div>
                    <form id="dashboard-workspace-team-form" class="stacked-form" novalidate>
                        <label class="stacked-form__field">
                            <span>Team name</span>
                            <input type="text" id="workspace-team-name" maxlength="80" placeholder="Design Studio" autocomplete="off">
                        </label>
                        <label class="stacked-form__field">
                            <span>Description <em>optional</em></span>
                            <input type="text" id="workspace-team-description" maxlength="160" placeholder="What does this team work on?" autocomplete="off">
                        </label>
                        <p class="form-error" id="workspace-team-error" role="alert"></p>
                        <div class="stacked-form__actions">
                            <button type="submit" class="primary-button auto-button">Create team</button>
                        </div>
                    </form>
                </section>
                <section class="surface-card">
                    <div class="panel-header"><h2>Your teams</h2><span class="pill-count">${dashboardData.teams.length}</span></div>
                    <div class="team-list" id="workspace-team-list"></div>
                </section>
            </div>
        `;

        const list = document.getElementById('workspace-team-list');
        if (list) {
            list.innerHTML = dashboardData.teams.length
                ? dashboardData.teams.map((team) => `
                    <article class="team-card">
                        <strong>${escapeHtml(team.name)}</strong>
                        <span>${escapeHtml(team.description || 'No description')}</span>
                        <small>${team.meetingCount} meeting${team.meetingCount === 1 ? '' : 's'}</small>
                    </article>
                `).join('')
                : '<div class="empty-state-card">No teams yet. Create your first one.</div>';
        }

        document.getElementById('dashboard-workspace-team-form')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            setFieldError('workspace-team-error', '');

            const nameInput = document.getElementById('workspace-team-name');
            const name = nameInput?.value.trim();
            const description = document.getElementById('workspace-team-description')?.value.trim() || '';
            if (!name) {
                setFieldError('workspace-team-error', 'Team name is required.', nameInput);
                nameInput?.focus();
                return;
            }

            try {
                await requestJson('/api/teams', { method: 'POST', body: { name, description } });
                await refreshDashboardData();
                renderTeamsWorkspace();
            } catch (error) {
                setFieldError('workspace-team-error', error.message || 'Unable to create the team.');
            }
        });
    }

    function renderHistoryWorkspace() {
        if (!workspacePanel) {
            return;
        }

        workspacePanel.innerHTML = `
            <div class="section-header"><div><h2>Meeting history</h2><p>Review outcomes and relaunch previous rooms.</p></div></div>
            <section class="surface-card">
                <div class="table-scroll">
                    <table class="history-table history-table--history">
                        <thead><tr><th>Meeting</th><th>Team</th><th>Ended</th><th>Duration</th><th>Action</th></tr></thead>
                        <tbody id="workspace-history-body"></tbody>
                    </table>
                </div>
            </section>
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
                    <td><button class="secondary-button small-button auto-button" type="button" data-room-code="${escapeHtml(meeting.roomCode)}">Relaunch</button></td>
                </tr>
            `).join('')
            : '<tr><td colspan="5">No history yet.</td></tr>';

        body.querySelectorAll('[data-room-code]').forEach((button) => {
            button.addEventListener('click', () => joinRoomAndRedirect(button.dataset.roomCode));
        });
    }

    function renderRecordingsWorkspace() {
        if (!workspacePanel) {
            return;
        }

        workspacePanel.innerHTML = `
            <div class="section-header"><div><h2>Recordings</h2><p>Download recordings captured during your meetings.</p></div></div>
            <section class="surface-card">
                <div class="table-scroll">
                    <table class="history-table history-table--recordings">
                        <thead><tr><th>Recording</th><th>Meeting</th><th>Recorded</th><th>Length</th><th>Size</th><th>Action</th></tr></thead>
                        <tbody id="workspace-recordings-body"></tbody>
                    </table>
                </div>
            </section>
        `;

        renderRecordingRows(recordings, document.getElementById('workspace-recordings-body'), refreshRecordings);
    }

    function renderSettingsWorkspace() {
        if (!workspacePanel) {
            return;
        }

        const compactEnabled = localStorage.getItem('vyomDashboardCompactView') === 'true';
        const autoJoinEnabled = localStorage.getItem('vyomDashboardAutoJoin') !== 'false';
        const isDark = document.documentElement.dataset.theme === 'dark';

        workspacePanel.innerHTML = `
            <div class="section-header"><div><h2>Settings</h2><p>Customize how your workspace looks and behaves.</p></div></div>
            <section class="surface-card">
                <div class="panel-header"><h2>Preferences</h2><span class="pill-count">Saved locally</span></div>
                <div class="toggle-list">
                    <label class="toggle-row">
                        <input type="checkbox" id="workspace-compact-toggle" ${compactEnabled ? 'checked' : ''}>
                        <span class="toggle-row__copy">
                            <strong>Compact dashboard cards</strong>
                            <small>Fit more meetings on screen with tighter spacing.</small>
                        </span>
                    </label>
                    <label class="toggle-row">
                        <input type="checkbox" id="workspace-auto-join-toggle" ${autoJoinEnabled ? 'checked' : ''}>
                        <span class="toggle-row__copy">
                            <strong>Auto-join new meetings</strong>
                            <small>Open the room right after you create a meeting.</small>
                        </span>
                    </label>
                    <label class="toggle-row">
                        <input type="checkbox" id="workspace-theme-toggle-input" ${isDark ? 'checked' : ''}>
                        <span class="toggle-row__copy">
                            <strong>Dark theme</strong>
                            <small>Switch between the light and dark appearance.</small>
                        </span>
                    </label>
                </div>
            </section>
            <section class="surface-card">
                <div class="panel-header"><h2>Account</h2></div>
                <div class="stack-list">
                    <div class="stack-list__row">
                        <div><strong>${escapeHtml(dashboardData.profile.name)}</strong><span>${escapeHtml(dashboardData.profile.email)}</span></div>
                        <button class="secondary-button small-button auto-button" id="workspace-edit-profile" type="button">Edit profile</button>
                    </div>
                    <div class="stack-list__row">
                        <div><strong>Sign out</strong><span>End your session on this device.</span></div>
                        <button class="secondary-button small-button auto-button" id="workspace-sign-out" type="button">Sign out</button>
                    </div>
                </div>
            </section>
        `;

        document.getElementById('workspace-compact-toggle')?.addEventListener('change', (event) => {
            const enabled = Boolean(event.target.checked);
            localStorage.setItem('vyomDashboardCompactView', String(enabled));
            document.body.classList.toggle('dashboard-compact', enabled);
        });

        document.getElementById('workspace-auto-join-toggle')?.addEventListener('change', (event) => {
            localStorage.setItem('vyomDashboardAutoJoin', String(Boolean(event.target.checked)));
        });

        document.getElementById('workspace-theme-toggle-input')?.addEventListener('change', () => {
            document.getElementById('theme-toggle')?.click();
        });

        document.getElementById('workspace-edit-profile')?.addEventListener('click', openProfileModal);
        document.getElementById('workspace-sign-out')?.addEventListener('click', handleSignOut);
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
        if (recordingsPanel) {
            recordingsPanel.style.display = showBase ? '' : 'none';
        }
        if (workspacePanel) {
            workspacePanel.style.display = showBase ? 'none' : '';
        }

        if (dashboardTitle) {
            dashboardTitle.textContent = showBase
                ? 'Create, join and manage your meetings'
                : `${view.charAt(0).toUpperCase()}${view.slice(1)}`;
        }
        if (dashboardLabel) {
            dashboardLabel.textContent = showBase ? 'Workspace' : 'Focused view';
        }

        if (view === 'meetings') {
            renderMeetingsWorkspace();
        } else if (view === 'calendar') {
            renderCalendarWorkspace();
        } else if (view === 'teams') {
            renderTeamsWorkspace();
        } else if (view === 'history') {
            renderHistoryWorkspace();
        } else if (view === 'recordings') {
            renderRecordingsWorkspace();
        } else if (view === 'settings') {
            renderSettingsWorkspace();
        }
    }

    function activateNavLink(target) {
        document.querySelectorAll('.sidebar-nav .nav-link').forEach((item) => item.classList.remove('active'));
        document.querySelector(`.sidebar-nav .nav-link[data-target="${target}"]`)?.classList.add('active');
        applyWorkspaceView(target);
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
    await refreshRecordings();

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

    document.getElementById('new-meeting-button')?.addEventListener('click', () => openMeetingModal());

    meetingModalClose?.addEventListener('click', closeMeetingModal);
    meetingModalCancel?.addEventListener('click', closeMeetingModal);
    meetingModal?.addEventListener('click', (event) => {
        if (event.target === meetingModal) {
            closeMeetingModal();
        }
    });

    meetingModalForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        setFieldError('meeting-modal-error', '');

        const title = meetingModalTitleInput?.value.trim();
        if (!title) {
            setFieldError('meeting-modal-error', 'Give your meeting a title.', meetingModalTitleInput);
            meetingModalTitleInput?.focus();
            return;
        }

        const scheduledLocal = meetingModalTime?.value;
        try {
            const response = await requestJson('/api/meetings', {
                method: 'POST',
                body: {
                    title,
                    description: meetingModalDescription?.value.trim() || '',
                    teamId: meetingModalTeam?.value || null,
                    scheduledAt: scheduledLocal ? new Date(scheduledLocal).toISOString() : new Date().toISOString()
                }
            });

            closeMeetingModal();

            if (meetingModalAutoJoin?.checked) {
                await joinRoomAndRedirect(response.meeting.roomCode);
                return;
            }

            await refreshDashboardData();
            applyWorkspaceView(currentWorkspaceView);
        } catch (error) {
            setFieldError('meeting-modal-error', error.message || 'Unable to create the meeting.');
        }
    });

    const joinMeetingButton = document.getElementById('join-meeting-button');
    const meetingCodeInput = document.getElementById('meeting-code');
    if (joinMeetingButton && meetingCodeInput) {
        const submitJoin = async () => {
            const roomCode = normalizeRoomCodeInput(meetingCodeInput.value.trim());
            if (!roomCode) {
                meetingCodeInput.classList.add('is-invalid');
                meetingCodeInput.focus();
                return;
            }

            meetingCodeInput.classList.remove('is-invalid');
            await joinRoomAndRedirect(roomCode);
        };

        joinMeetingButton.addEventListener('click', submitJoin);
        meetingCodeInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submitJoin();
            }
        });
        meetingCodeInput.addEventListener('input', () => meetingCodeInput.classList.remove('is-invalid'));
    }

    document.getElementById('dashboard-view-calendar-button')?.addEventListener('click', () => {
        activateNavLink('calendar');
    });

    document.getElementById('view-all-meetings-link')?.addEventListener('click', (event) => {
        event.preventDefault();
        activateNavLink('history');
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
        if (event.key !== 'Escape') {
            return;
        }

        if (profileModal && !profileModal.classList.contains('is-hidden')) {
            closeProfileModal();
        }
        if (meetingModal && !meetingModal.classList.contains('is-hidden')) {
            closeMeetingModal();
        }
    });

    applyWorkspaceView('dashboard');
    await Promise.all([refreshRecordings(), refreshMeetings()]);
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
