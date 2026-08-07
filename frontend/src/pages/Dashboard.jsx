import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout, authHeaders } = useAuth();
  const [meetings, setMeetings] = useState([]);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/meetings/history', { headers: authHeaders })
      .then((res) => res.json())
      .then((data) => setMeetings(data.meetings || []))
      .catch(() => {});
  }, [authHeaders]);

  const createMeeting = async () => {
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/meetings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ title: title || 'Vyom Meeting' }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create meeting');
      }
      navigate(`/room/${data.roomId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const joinMeeting = () => {
    const roomId = joinRoomId.trim();
    if (!roomId) {
      setError('Enter a room ID to join');
      return;
    }
    navigate(`/room/${roomId}`);
  };

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-0">Welcome, {user?.name}</h2>
          <small className="text-secondary">{user?.email}</small>
        </div>
        <button type="button" className="btn btn-outline-light btn-sm" onClick={logout}>
          Sign Out
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-4 mb-4">
        <div className="col-md-6">
          <div className="vyom-card p-4 h-100">
            <h4>Start a meeting</h4>
            <input
              type="text"
              className="form-control mb-3"
              placeholder="Meeting title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button type="button" className="btn btn-primary" onClick={createMeeting} disabled={loading}>
              {loading ? 'Creating...' : 'Create & Join'}
            </button>
          </div>
        </div>
        <div className="col-md-6">
          <div className="vyom-card p-4 h-100">
            <h4>Join a meeting</h4>
            <input
              type="text"
              className="form-control mb-3"
              placeholder="Room ID"
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value)}
            />
            <button type="button" className="btn btn-outline-primary" onClick={joinMeeting}>
              Join Room
            </button>
          </div>
        </div>
      </div>

      <div className="vyom-card p-4">
        <h4 className="mb-3">Recent meetings</h4>
        {meetings.length === 0 ? (
          <p className="text-secondary mb-0">No meetings yet. Create your first room above.</p>
        ) : (
          <div className="list-group list-group-flush">
            {meetings.map((meeting) => (
              <Link
                key={meeting.roomId}
                to={`/room/${meeting.roomId}`}
                className="list-group-item list-group-item-action bg-transparent text-light border-secondary"
              >
                <div className="d-flex justify-content-between">
                  <span>{meeting.title}</span>
                  <code>{meeting.roomId}</code>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
