## 📌 Overview
**VYOM** is a modern, browser-based video conferencing and collaboration application designed to provide high-quality, secure, and seamless real-time communication. Built from scratch using the **MERN Stack** (MongoDB, Express.js, React.js, Node.js) along with **WebRTC** and **Socket.io**, it enables ultra-low latency peer-to-peer video and audio calling without requiring any third-party plugins or software downloads.

Unlike traditional communication apps, **VYOM** focuses on a lightweight, intuitive user interface and reliable signaling architecture to ensure smooth virtual meetings, academic discussions, and team collaborations.

---

## Key Features
* **Real-time video and audio:** Browser WebRTC streams with Socket.IO signaling.
* **Meeting rooms:** Create, schedule, join, leave, and end meetings with shareable room codes.
* **Collaboration:** In-meeting chat, screen sharing, participant presence, and a whiteboard.
* **Authentication:** Local accounts plus optional Google, LinkedIn, and Facebook OAuth.
* **Dashboard:** Teams, upcoming meetings, history, profile settings, and theme preferences.

---

## Tech Stack
* **Frontend:** HTML, CSS, and browser JavaScript.
* **Backend:** Node.js, Express, and Socket.IO.
* **Database:** SQLite with the `sqlite` and `sqlite3` packages.
* **Media:** WebRTC APIs for peer-to-peer audio and video.

## Project Structure
```text
public/
	index.html, sign-in.html, dashboard.html, meeting.html
	social-auth-popup.html
	assets/
		css/       Shared and responsive stylesheets
		images/    Logos and other static images
		js/        Browser-side application logic
src/
	server/index.js       Express API, OAuth, and Socket.IO server
	database/index.js     SQLite connection, schema, and data access
data/                    Local SQLite database (created at runtime)
```

The browser application remains in one client entry point because authentication, dashboard state, and the WebRTC meeting lifecycle share browser state and events. The backend and database are separated by responsibility without splitting tightly coupled meeting code into fragile fragments.

## Run Locally
```bash
npm install
npm start
```

Open `http://localhost:3000` in a browser. The SQLite database is created automatically at `data/vyom.sqlite`.

---

## 🔐 Social OAuth Setup
The Google, LinkedIn, and Facebook popup sign-in flow now uses real OAuth redirects on the server.

Set these environment variables before running the app:

* `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
* `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`
* `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`

Optional redirect overrides if you want to use custom callback URLs:

* `GOOGLE_OAUTH_REDIRECT_URI`
* `LINKEDIN_OAUTH_REDIRECT_URI`
* `FACEBOOK_OAUTH_REDIRECT_URI`

Register these callback URLs in the provider consoles if you use the default local setup:

* `http://localhost:3000/auth/oauth/google/callback`
* `http://localhost:3000/auth/oauth/linkedin/callback`
* `http://localhost:3000/auth/oauth/facebook/callback`
