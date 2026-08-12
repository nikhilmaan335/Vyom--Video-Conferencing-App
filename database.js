const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const databasePath = path.join(__dirname, 'vyom.sqlite');
let databasePromise;

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function createPublicUser(user) {
    if (!user) {
        return null;
    }

    return {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email.split('@')[0],
        email: user.email,
        provider: user.provider,
        avatarUrl: user.avatar_url,
        age: user.age,
        occupation: user.occupation,
        createdAt: user.created_at
    };
}

async function ensureUsersProfileColumns(db) {
    const columns = await db.all('PRAGMA table_info(users)');
    const columnNames = new Set(columns.map((column) => column.name));

    if (!columnNames.has('age')) {
        await db.exec('ALTER TABLE users ADD COLUMN age INTEGER;');
    }

    if (!columnNames.has('occupation')) {
        await db.exec("ALTER TABLE users ADD COLUMN occupation TEXT;");
    }
}

function randomToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

function randomRoomCode() {
    return `room-${crypto.randomBytes(3).toString('hex')}`;
}

function isoHoursFromNow(hours) {
    const date = new Date();
    date.setHours(date.getHours() + hours);
    return date.toISOString();
}

async function getDatabase() {
    if (!databasePromise) {
        databasePromise = open({
            filename: databasePath,
            driver: sqlite3.Database
        }).then(async (db) => {
            await db.exec('PRAGMA foreign_keys = ON;');
            await db.exec(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    first_name TEXT NOT NULL,
                    last_name TEXT NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    provider TEXT NOT NULL DEFAULT 'local',
                    avatar_url TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    token TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    expires_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS teams (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    owner_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS team_members (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    team_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    role TEXT NOT NULL DEFAULT 'member',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (team_id, user_id),
                    FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS meetings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    room_code TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    host_user_id INTEGER NOT NULL,
                    team_id INTEGER,
                    status TEXT NOT NULL DEFAULT 'scheduled',
                    scheduled_at TEXT,
                    started_at TEXT,
                    ended_at TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (host_user_id) REFERENCES users (id) ON DELETE CASCADE,
                    FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE SET NULL
                );

                CREATE TABLE IF NOT EXISTS meeting_participants (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    display_name TEXT NOT NULL,
                    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    left_at TEXT,
                    audio_enabled INTEGER NOT NULL DEFAULT 1,
                    video_enabled INTEGER NOT NULL DEFAULT 1,
                    hand_raised INTEGER NOT NULL DEFAULT 0,
                    is_host INTEGER NOT NULL DEFAULT 0,
                    UNIQUE (meeting_id, user_id),
                    FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS chat_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    message TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
                );
            `);
            await ensureUsersProfileColumns(db);
            return db;
        });
    }

    return databasePromise;
}

async function ensureStarterWorkspace(db, user) {
    const teamCount = await db.get('SELECT COUNT(*) AS count FROM teams WHERE owner_id = ?', [user.id]);
    if (teamCount.count > 0) {
        return;
    }

    const teamSeeds = [
        {
            name: 'Product Team',
            description: 'Planning, launch updates and roadmap reviews.'
        },
        {
            name: 'Design Studio',
            description: 'UI, UX and visual feedback reviews.'
        },
        {
            name: 'All Hands',
            description: 'Weekly team sync and company updates.'
        }
    ];

    const createdTeams = [];
    for (const teamSeed of teamSeeds) {
        const result = await db.run(
            'INSERT INTO teams (owner_id, name, description) VALUES (?, ?, ?)',
            [user.id, teamSeed.name, teamSeed.description]
        );

        const teamId = result.lastID;
        createdTeams.push(teamId);

        await db.run(
            'INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)',
            [teamId, user.id, 'owner']
        );
    }

    const meetingSeeds = [
        {
            title: 'Project Kickoff',
            description: 'Align the team and launch the new sprint.',
            status: 'scheduled',
            scheduledAt: isoHoursFromNow(24),
            teamId: createdTeams[0]
        },
        {
            title: 'Design Review',
            description: 'Review the latest interface updates and feedback.',
            status: 'scheduled',
            scheduledAt: isoHoursFromNow(30),
            teamId: createdTeams[1]
        },
        {
            title: 'Weekly Sync',
            description: 'Share updates and review team priorities.',
            status: 'ended',
            scheduledAt: isoHoursFromNow(-20),
            startedAt: isoHoursFromNow(-20),
            endedAt: isoHoursFromNow(-19.25),
            teamId: createdTeams[2]
        },
        {
            title: 'Client Call',
            description: 'Catch up with the customer and discuss next steps.',
            status: 'ended',
            scheduledAt: isoHoursFromNow(-44),
            startedAt: isoHoursFromNow(-44),
            endedAt: isoHoursFromNow(-43.5),
            teamId: createdTeams[0]
        }
    ];

    for (const meetingSeed of meetingSeeds) {
        await db.run(
            `
                INSERT INTO meetings (
                    room_code,
                    title,
                    description,
                    host_user_id,
                    team_id,
                    status,
                    scheduled_at,
                    started_at,
                    ended_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                randomRoomCode(),
                meetingSeed.title,
                meetingSeed.description,
                user.id,
                meetingSeed.teamId,
                meetingSeed.status,
                meetingSeed.scheduledAt,
                meetingSeed.startedAt || null,
                meetingSeed.endedAt || null
            ]
        );
    }
}

async function createUser({ firstName, lastName, email, password, provider = 'local' }) {
    const db = await getDatabase();
    const normalizedEmail = normalizeEmail(email);

    if (!firstName || !lastName || !normalizedEmail || !password) {
        const error = new Error('Missing required sign-up fields.');
        error.status = 400;
        throw error;
    }

    const existing = await db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    if (existing) {
        const error = new Error('An account with that email already exists.');
        error.status = 409;
        throw error;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.run(
        `
            INSERT INTO users (first_name, last_name, email, password_hash, provider)
            VALUES (?, ?, ?, ?, ?)
        `,
        [firstName.trim(), lastName.trim(), normalizedEmail, passwordHash, provider]
    );

    const user = await db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
    await ensureStarterWorkspace(db, user);
    return createPublicUser(user);
}

async function createSocialUser({ provider, email, displayName, avatarUrl = null }) {
    const db = await getDatabase();
    const normalizedEmail = normalizeEmail(email);

    if (!provider) {
        const error = new Error('Social provider is required.');
        error.status = 400;
        throw error;
    }

    if (!normalizedEmail) {
        const error = new Error('A social sign-in email is required.');
        error.status = 400;
        throw error;
    }

    const existing = await db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    if (existing) {
        if (avatarUrl && existing.avatar_url !== avatarUrl) {
            await db.run('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, existing.id]);
            const refreshedUser = await db.get('SELECT * FROM users WHERE id = ?', [existing.id]);
            return createPublicUser(refreshedUser);
        }

        return createPublicUser(existing);
    }

    const [firstName, ...rest] = String(displayName || provider).trim().split(/\s+/);
    const lastName = rest.join(' ') || provider;
    const passwordHash = await bcrypt.hash(randomToken(8), 10);
    const result = await db.run(
        `
            INSERT INTO users (first_name, last_name, email, password_hash, provider, avatar_url)
            VALUES (?, ?, ?, ?, ?, ?)
        `,
        [firstName || provider, lastName || provider, normalizedEmail, passwordHash, provider, avatarUrl]
    );

    const user = await db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
    await ensureStarterWorkspace(db, user);
    return createPublicUser(user);
}

async function updateUserProfile({ userId, firstName, lastName, avatarUrl, age, occupation, currentPassword, newPassword }) {
    const db = await getDatabase();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);

    if (!user) {
        const error = new Error('User not found.');
        error.status = 404;
        throw error;
    }

    const updates = [];
    const params = [];

    if (typeof firstName === 'string') {
        const trimmedFirstName = firstName.trim();
        if (!trimmedFirstName) {
            const error = new Error('First name is required.');
            error.status = 400;
            throw error;
        }

        updates.push('first_name = ?');
        params.push(trimmedFirstName);
    }

    if (typeof lastName === 'string') {
        const trimmedLastName = lastName.trim();
        if (!trimmedLastName) {
            const error = new Error('Last name is required.');
            error.status = 400;
            throw error;
        }

        updates.push('last_name = ?');
        params.push(trimmedLastName);
    }

    if (avatarUrl !== undefined) {
        updates.push('avatar_url = ?');
        params.push(avatarUrl || null);
    }

    if (age !== undefined && age !== null && age !== '') {
        const normalizedAge = Number(age);
        if (!Number.isInteger(normalizedAge) || normalizedAge < 10 || normalizedAge > 120) {
            const error = new Error('Age must be between 10 and 120.');
            error.status = 400;
            throw error;
        }

        updates.push('age = ?');
        params.push(normalizedAge);
    }

    if (occupation !== undefined) {
        const normalizedOccupation = String(occupation || '').trim().toLowerCase();
        const allowedOccupations = new Set(['', 'student', 'employed', 'self-employed']);
        if (!allowedOccupations.has(normalizedOccupation)) {
            const error = new Error('Invalid profile role selected.');
            error.status = 400;
            throw error;
        }

        updates.push('occupation = ?');
        params.push(normalizedOccupation || null);
    }

    if (newPassword) {
        if (!currentPassword) {
            const error = new Error('Current password is required to change your password.');
            error.status = 400;
            throw error;
        }

        const passwordMatches = await bcrypt.compare(currentPassword || '', user.password_hash);
        if (!passwordMatches) {
            const error = new Error('Current password is incorrect.');
            error.status = 401;
            throw error;
        }

        updates.push('password_hash = ?');
        params.push(await bcrypt.hash(newPassword, 10));
    }

    if (!updates.length) {
        return createPublicUser(user);
    }

    params.push(userId);
    await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    const updatedUser = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    await ensureStarterWorkspace(db, updatedUser);
    return createPublicUser(updatedUser);
}

async function authenticateUser({ email, password }) {
    const db = await getDatabase();
    const normalizedEmail = normalizeEmail(email);
    const user = await db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);

    if (!user) {
        const error = new Error('Invalid email or password.');
        error.status = 401;
        throw error;
    }

    const passwordMatches = await bcrypt.compare(password || '', user.password_hash);
    if (!passwordMatches) {
        const error = new Error('Invalid email or password.');
        error.status = 401;
        throw error;
    }

    await ensureStarterWorkspace(db, user);
    return createPublicUser(user);
}

async function createSession(userId) {
    const db = await getDatabase();
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

    await db.run(
        'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)',
        [userId, token, expiresAt]
    );

    return token;
}

async function getUserBySessionToken(token) {
    if (!token) {
        return null;
    }

    const db = await getDatabase();
    const row = await db.get(
        `
            SELECT users.*, sessions.expires_at
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token = ?
        `,
        [token]
    );

    if (!row) {
        return null;
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
        await db.run('DELETE FROM sessions WHERE token = ?', [token]);
        return null;
    }

    return createPublicUser(row);
}

async function revokeSession(token) {
    const db = await getDatabase();
    await db.run('DELETE FROM sessions WHERE token = ?', [token]);
}

async function getDashboardData(userId) {
    const db = await getDatabase();
    const profile = await db.get('SELECT * FROM users WHERE id = ?', [userId]);

    const teams = await db.all(
        `
            SELECT teams.id, teams.name, teams.description, teams.created_at,
                   COUNT(DISTINCT meetings.id) AS meetingCount
            FROM teams
            LEFT JOIN meetings ON meetings.team_id = teams.id
            WHERE teams.owner_id = ?
            GROUP BY teams.id
            ORDER BY teams.created_at DESC
        `,
        [userId]
    );

    const upcomingMeetings = await db.all(
        `
            SELECT meetings.*, teams.name AS team_name
            FROM meetings
            LEFT JOIN teams ON teams.id = meetings.team_id
            WHERE meetings.host_user_id = ? AND meetings.status IN ('scheduled', 'active')
            ORDER BY COALESCE(meetings.scheduled_at, meetings.created_at) ASC
        `,
        [userId]
    );

    const meetingHistory = await db.all(
        `
            SELECT meetings.*, teams.name AS team_name
            FROM meetings
            LEFT JOIN teams ON teams.id = meetings.team_id
            WHERE meetings.host_user_id = ? AND meetings.status = 'ended'
            ORDER BY COALESCE(meetings.ended_at, meetings.updated_at) DESC
        `,
        [userId]
    );

    return {
        profile: createPublicUser(profile),
        teams: teams.map((team) => ({
            id: team.id,
            name: team.name,
            description: team.description,
            meetingCount: team.meetingCount,
            createdAt: team.created_at
        })),
        upcomingMeetings: upcomingMeetings.map((meeting) => ({
            id: meeting.id,
            roomCode: meeting.room_code,
            title: meeting.title,
            description: meeting.description,
            teamName: meeting.team_name || 'General',
            status: meeting.status,
            scheduledAt: meeting.scheduled_at,
            startedAt: meeting.started_at,
            endedAt: meeting.ended_at
        })),
        meetingHistory: meetingHistory.map((meeting) => ({
            id: meeting.id,
            roomCode: meeting.room_code,
            title: meeting.title,
            description: meeting.description,
            teamName: meeting.team_name || 'General',
            status: meeting.status,
            scheduledAt: meeting.scheduled_at,
            startedAt: meeting.started_at,
            endedAt: meeting.ended_at
        }))
    };
}

async function createMeeting({ hostUserId, title, description = '', teamId = null, scheduledAt = null }) {
    const db = await getDatabase();
    const roomCode = randomRoomCode();
    const result = await db.run(
        `
            INSERT INTO meetings (
                room_code,
                title,
                description,
                host_user_id,
                team_id,
                status,
                scheduled_at
            ) VALUES (?, ?, ?, ?, ?, 'scheduled', ?)
        `,
        [roomCode, title || 'Team Meeting', description, hostUserId, teamId, scheduledAt]
    );

    return db.get('SELECT * FROM meetings WHERE id = ?', [result.lastID]);
}

async function getMeetingByRoomCode(roomCode) {
    const db = await getDatabase();
    const meeting = await db.get(
        `
            SELECT meetings.*, teams.name AS team_name, users.first_name, users.last_name, users.email
            FROM meetings
            LEFT JOIN teams ON teams.id = meetings.team_id
            LEFT JOIN users ON users.id = meetings.host_user_id
            WHERE meetings.room_code = ?
        `,
        [roomCode]
    );

    if (!meeting) {
        return null;
    }

    const participants = await db.all(
        `
            SELECT meeting_participants.*, users.first_name, users.last_name, users.email
            FROM meeting_participants
            JOIN users ON users.id = meeting_participants.user_id
            WHERE meeting_participants.meeting_id = ? AND meeting_participants.left_at IS NULL
            ORDER BY meeting_participants.is_host DESC, meeting_participants.joined_at ASC
        `,
        [meeting.id]
    );

    return {
        id: meeting.id,
        roomCode: meeting.room_code,
        title: meeting.title,
        description: meeting.description,
        status: meeting.status,
        scheduledAt: meeting.scheduled_at,
        startedAt: meeting.started_at,
        endedAt: meeting.ended_at,
        hostUserId: meeting.host_user_id,
        teamName: meeting.team_name || 'General',
        host: {
            name: `${meeting.first_name || ''} ${meeting.last_name || ''}`.trim() || meeting.email.split('@')[0],
            email: meeting.email
        },
        participants: participants.map((participant) => ({
            id: participant.user_id,
            name: participant.display_name,
            email: participant.email,
            audioEnabled: Boolean(participant.audio_enabled),
            videoEnabled: Boolean(participant.video_enabled),
            handRaised: Boolean(participant.hand_raised),
            isHost: Boolean(participant.is_host),
            joinedAt: participant.joined_at
        }))
    };
}

async function joinMeetingRoom({ roomCode, user }) {
    const db = await getDatabase();
    let meeting = await db.get('SELECT * FROM meetings WHERE room_code = ?', [roomCode]);

    if (!meeting) {
        const created = await db.run(
            `
                INSERT INTO meetings (
                    room_code,
                    title,
                    description,
                    host_user_id,
                    status,
                    started_at
                ) VALUES (?, ?, ?, ?, 'active', ?)
            `,
            [roomCode, 'Instant Meeting', 'Live meeting room', user.id, new Date().toISOString()]
        );

        meeting = await db.get('SELECT * FROM meetings WHERE id = ?', [created.lastID]);
    }

    if (meeting.status === 'ended') {
        const error = new Error('This meeting has ended. Create a new meeting to continue.');
        error.status = 409;
        throw error;
    }

    if (meeting.status === 'scheduled') {
        await db.run(
            `
                UPDATE meetings
                SET status = 'active',
                    started_at = COALESCE(started_at, ?),
                    updated_at = ?
                WHERE id = ?
            `,
            [new Date().toISOString(), new Date().toISOString(), meeting.id]
        );
        meeting = await db.get('SELECT * FROM meetings WHERE id = ?', [meeting.id]);
    }

    const displayName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email.split('@')[0];
    await db.run(
        `
            INSERT INTO meeting_participants (
                meeting_id,
                user_id,
                display_name,
                joined_at,
                left_at,
                is_host
            ) VALUES (?, ?, ?, ?, NULL, ?)
            ON CONFLICT(meeting_id, user_id) DO UPDATE SET
                display_name = excluded.display_name,
                joined_at = excluded.joined_at,
                left_at = NULL
        `,
        [meeting.id, user.id, displayName, new Date().toISOString(), meeting.host_user_id === user.id ? 1 : 0]
    );

    return getMeetingByRoomCode(roomCode);
}

async function updateParticipantState(roomCode, userId, statePatch) {
    const db = await getDatabase();
    const meeting = await db.get('SELECT * FROM meetings WHERE room_code = ?', [roomCode]);
    if (!meeting) {
        return null;
    }

    const fields = [];
    const values = [];

    if (typeof statePatch.audioEnabled === 'boolean') {
        fields.push('audio_enabled = ?');
        values.push(statePatch.audioEnabled ? 1 : 0);
    }

    if (typeof statePatch.videoEnabled === 'boolean') {
        fields.push('video_enabled = ?');
        values.push(statePatch.videoEnabled ? 1 : 0);
    }

    if (typeof statePatch.handRaised === 'boolean') {
        fields.push('hand_raised = ?');
        values.push(statePatch.handRaised ? 1 : 0);
    }

    if (!fields.length) {
        return getMeetingByRoomCode(roomCode);
    }

    values.push(meeting.id, userId);

    await db.run(
        `
            UPDATE meeting_participants
            SET ${fields.join(', ')}
            WHERE meeting_id = ? AND user_id = ?
        `,
        values
    );

    return getMeetingByRoomCode(roomCode);
}

async function leaveMeetingRoom(roomCode, userId) {
    const db = await getDatabase();
    const meeting = await db.get('SELECT * FROM meetings WHERE room_code = ?', [roomCode]);
    if (!meeting) {
        return null;
    }

    await db.run(
        `
            UPDATE meeting_participants
            SET left_at = ?
            WHERE meeting_id = ? AND user_id = ?
        `,
        [new Date().toISOString(), meeting.id, userId]
    );

    return getMeetingByRoomCode(roomCode);
}

async function endMeeting(roomCode, userId) {
    const db = await getDatabase();
    const meeting = await db.get('SELECT * FROM meetings WHERE room_code = ?', [roomCode]);
    if (!meeting) {
        return null;
    }

    if (meeting.host_user_id !== userId) {
        const error = new Error('Only the host can end this meeting.');
        error.status = 403;
        throw error;
    }

    const timestamp = new Date().toISOString();
    await db.run(
        `
            UPDATE meetings
            SET status = 'ended',
                ended_at = ?,
                updated_at = ?
            WHERE id = ?
        `,
        [timestamp, timestamp, meeting.id]
    );

    await db.run(
        `
            UPDATE meeting_participants
            SET left_at = COALESCE(left_at, ?)
            WHERE meeting_id = ?
        `,
        [timestamp, meeting.id]
    );

    return getMeetingByRoomCode(roomCode);
}

async function getMeetingChatMessages(roomCode) {
    const db = await getDatabase();
    const meeting = await db.get('SELECT * FROM meetings WHERE room_code = ?', [roomCode]);
    if (!meeting) {
        return [];
    }

    const rows = await db.all(
        `
            SELECT chat_messages.*, users.first_name, users.last_name, users.email
            FROM chat_messages
            JOIN users ON users.id = chat_messages.user_id
            WHERE chat_messages.meeting_id = ?
            ORDER BY chat_messages.created_at ASC, chat_messages.id ASC
        `,
        [meeting.id]
    );

    return rows.map((row) => ({
        id: row.id,
        message: row.message,
        createdAt: row.created_at,
        author: {
            id: row.user_id,
            name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email.split('@')[0],
            email: row.email
        }
    }));
}

async function saveMeetingChatMessage(roomCode, userId, message) {
    const db = await getDatabase();
    const meeting = await db.get('SELECT * FROM meetings WHERE room_code = ?', [roomCode]);
    if (!meeting) {
        const error = new Error('Meeting not found.');
        error.status = 404;
        throw error;
    }

    const content = String(message || '').trim();
    if (!content) {
        const error = new Error('Message is required.');
        error.status = 400;
        throw error;
    }

    const result = await db.run(
        'INSERT INTO chat_messages (meeting_id, user_id, message) VALUES (?, ?, ?)',
        [meeting.id, userId, content]
    );

    const row = await db.get(
        `
            SELECT chat_messages.*, users.first_name, users.last_name, users.email
            FROM chat_messages
            JOIN users ON users.id = chat_messages.user_id
            WHERE chat_messages.id = ?
        `,
        [result.lastID]
    );

    return {
        id: row.id,
        roomCode,
        message: row.message,
        createdAt: row.created_at,
        author: {
            id: row.user_id,
            name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email.split('@')[0],
            email: row.email
        }
    };
}

module.exports = {
    getDatabase,
    normalizeEmail,
    createPublicUser,
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
    updateParticipantState,
    leaveMeetingRoom,
    endMeeting,
    getMeetingChatMessages,
    saveMeetingChatMessage
};
