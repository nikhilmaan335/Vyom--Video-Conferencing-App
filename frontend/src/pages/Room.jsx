import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const socketRef = useRef(null);

  const [meeting, setMeeting] = useState(null);
  const [error, setError] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  const updateRemoteStreams = useCallback(() => {
    const streams = [];
    peersRef.current.forEach((peer, socketId) => {
      if (peer.stream) {
        streams.push({ socketId, stream: peer.stream, userName: peer.userName || 'Guest' });
      }
    });
    setRemoteStreams([...streams]);
  }, []);

  const createPeerConnection = useCallback(
    (socket, targetSocketId, userName, isInitiator) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const localStream = localStreamRef.current;

      if (localStream) {
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc-ice-candidate', {
            roomId,
            targetSocketId,
            candidate: event.candidate,
          });
        }
      };

      pc.ontrack = (event) => {
        const peer = peersRef.current.get(targetSocketId) || {};
        peer.stream = event.streams[0];
        peer.userName = userName;
        peersRef.current.set(targetSocketId, { ...peer, pc });
        updateRemoteStreams();
      };

      peersRef.current.set(targetSocketId, { pc, userName });

      if (isInitiator) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            socket.emit('webrtc-offer', {
              roomId,
              targetSocketId,
              offer: pc.localDescription,
            });
          })
          .catch(console.error);
      }

      return pc;
    },
    [roomId, updateRemoteStreams]
  );

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const meetingRes = await fetch(`/api/meetings/${roomId}`);
        const meetingData = await meetingRes.json();
        if (!meetingRes.ok) {
          throw new Error(meetingData.error || 'Meeting not found');
        }
        if (!cancelled) setMeeting(meetingData);

        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        const socket = io({ path: '/socket.io' });
        socketRef.current = socket;

        socket.on('connect', () => {
          socket.emit('join-room', {
            roomId,
            userId: user.id,
            userName: user.name,
          });
        });

        socket.on('room-peers', (peers) => {
          peers.forEach((peer) => {
            createPeerConnection(socket, peer.socketId, peer.userName, true);
          });
        });

        socket.on('user-joined', ({ socketId, userName }) => {
          createPeerConnection(socket, socketId, userName, false);
        });

        socket.on('webrtc-offer', async ({ fromSocketId, offer }) => {
          let peer = peersRef.current.get(fromSocketId);
          if (!peer?.pc) {
            createPeerConnection(socket, fromSocketId, 'Participant', false);
            peer = peersRef.current.get(fromSocketId);
          }
          await peer.pc.setRemoteDescription(offer);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          socket.emit('webrtc-answer', {
            roomId,
            targetSocketId: fromSocketId,
            answer: peer.pc.localDescription,
          });
        });

        socket.on('webrtc-answer', async ({ fromSocketId, answer }) => {
          const peer = peersRef.current.get(fromSocketId);
          if (peer?.pc) {
            await peer.pc.setRemoteDescription(answer);
          }
        });

        socket.on('webrtc-ice-candidate', async ({ fromSocketId, candidate }) => {
          const peer = peersRef.current.get(fromSocketId);
          if (peer?.pc) {
            await peer.pc.addIceCandidate(candidate);
          }
        });

        socket.on('user-left', ({ socketId }) => {
          const peer = peersRef.current.get(socketId);
          if (peer?.pc) peer.pc.close();
          peersRef.current.delete(socketId);
          updateRemoteStreams();
        });

        socket.on('chat-message', (message) => {
          setChatMessages((prev) => [...prev, message]);
        });
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }

    init();

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      peersRef.current.forEach((peer) => peer.pc?.close());
      peersRef.current.clear();
    };
  }, [roomId, user, createPeerConnection, updateRemoteStreams]);

  const toggleAudio = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !audioEnabled;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = next;
    });
    setAudioEnabled(next);
    socketRef.current?.emit('media-state', { roomId, audioEnabled: next, videoEnabled });
  };

  const toggleVideo = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !videoEnabled;
    stream.getVideoTracks().forEach((t) => {
      t.enabled = next;
    });
    setVideoEnabled(next);
    socketRef.current?.emit('media-state', { roomId, audioEnabled, videoEnabled: next });
  };

  const toggleScreenShare = async () => {
    try {
      if (screenSharing) {
        const camera = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const videoTrack = camera.getVideoTracks()[0];
        const sender = [...peersRef.current.values()]
          .map((p) => p.pc)
          .filter(Boolean)
          .flatMap((pc) => pc.getSenders())
          .find((s) => s.track?.kind === 'video');

        if (sender) await sender.replaceTrack(videoTrack);
        localStreamRef.current.getVideoTracks().forEach((t) => t.stop());
        localStreamRef.current.removeTrack(localStreamRef.current.getVideoTracks()[0]);
        localStreamRef.current.addTrack(videoTrack);
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
        setScreenSharing(false);
        setVideoEnabled(true);
        return;
      }

      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = display.getVideoTracks()[0];
      const sender = [...peersRef.current.values()]
        .map((p) => p.pc)
        .filter(Boolean)
        .flatMap((pc) => pc.getSenders())
        .find((s) => s.track?.kind === 'video');

      if (sender) await sender.replaceTrack(screenTrack);
      localStreamRef.current.getVideoTracks().forEach((t) => t.stop());
      localStreamRef.current.removeTrack(localStreamRef.current.getVideoTracks()[0]);
      localStreamRef.current.addTrack(screenTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      screenTrack.onended = () => toggleScreenShare();
      setScreenSharing(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const sendChat = (event) => {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message) return;
    socketRef.current?.emit('chat-message', {
      roomId,
      userId: user.id,
      userName: user.name,
      message,
    });
    setChatInput('');
  };

  const leaveRoom = () => {
    socketRef.current?.emit('leave-room', { roomId });
    navigate('/dashboard');
  };

  if (error) {
    return (
      <div className="container py-5 text-center">
        <div className="alert alert-danger">{error}</div>
        <Link to="/dashboard" className="btn btn-primary">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="container-fluid py-3">
      <div className="d-flex justify-content-between align-items-center mb-3 px-2">
        <div>
          <h4 className="mb-0">{meeting?.title || 'Vyom Meeting'}</h4>
          <small className="text-secondary">
            Room: <code>{roomId}</code>
          </small>
        </div>
        <button type="button" className="btn btn-danger" onClick={leaveRoom}>
          Leave
        </button>
      </div>

      <div className="row g-3">
        <div className="col-lg-9">
          <div className="row g-3">
            <div className="col-md-6">
              <div className="video-tile">
                <video ref={localVideoRef} autoPlay muted playsInline />
                <span className="video-label">You ({user?.name})</span>
              </div>
            </div>
            {remoteStreams.map(({ socketId, stream, userName }) => (
              <div className="col-md-6" key={socketId}>
                <div className="video-tile">
                  <RemoteVideo stream={stream} />
                  <span className="video-label">{userName}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="d-flex gap-2 justify-content-center mt-3 flex-wrap">
            <button type="button" className={`btn ${audioEnabled ? 'btn-secondary' : 'btn-warning'}`} onClick={toggleAudio}>
              {audioEnabled ? 'Mute' : 'Unmute'}
            </button>
            <button type="button" className={`btn ${videoEnabled ? 'btn-secondary' : 'btn-warning'}`} onClick={toggleVideo}>
              {videoEnabled ? 'Stop Video' : 'Start Video'}
            </button>
            <button type="button" className={`btn ${screenSharing ? 'btn-info' : 'btn-secondary'}`} onClick={toggleScreenShare}>
              {screenSharing ? 'Stop Share' : 'Share Screen'}
            </button>
          </div>
        </div>

        <div className="col-lg-3">
          <div className="vyom-card p-3">
            <h5>Live Chat</h5>
            <div className="chat-panel mb-2">
              {chatMessages.map((msg, index) => (
                <div className="chat-message" key={`${msg.timestamp}-${index}`}>
                  <span className="author">{msg.userName}: </span>
                  {msg.message}
                </div>
              ))}
            </div>
            <form onSubmit={sendChat} className="d-flex gap-2">
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Type a message"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
              />
              <button type="submit" className="btn btn-primary btn-sm">
                Send
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function RemoteVideo({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline />;
}
