const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const {
    createUser,
    createSocialUser,
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
} = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: true,
        credentials: true
    }
});

const PORT = process.env.PORT || 3000;
const roomPresence = new Map();
const roomWhiteboards = new Map();

app.use(express.json({ limit: '1mb' }));

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
    res.sendFile(path.join(__dirname, 'index.html'));
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

app.use(express.static(__dirname, { extensions: ['html'] }));

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
