import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Home() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-8 text-center">
          <h1 className="display-4 fw-bold mb-3">Vyom</h1>
          <p className="lead text-secondary mb-4">
            Browser-based video conferencing with WebRTC, live chat, and secure JWT authentication.
          </p>
          <div className="d-flex gap-3 justify-content-center">
            {isAuthenticated ? (
              <Link to="/dashboard" className="btn btn-primary btn-lg">
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="btn btn-primary btn-lg">
                  Sign In
                </Link>
                <Link to="/register" className="btn btn-outline-light btn-lg">
                  Create Account
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
