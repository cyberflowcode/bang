# Bang

A real-time 2D multiplayer canvas shooter game built with Node.js, Express, and Socket.IO.

## Features

- **Real-time multiplayer combat** with WebSocket synchronization
- **Persistent lifetime kills leaderboard** - Track your all-time stats across matches
- **Server-enforced rapid fire** - Hold mouse button to shoot continuously (200ms cooldown, 5 shots/sec max)
- **Modern sci-fi arena** - Dark navy/purple gradient with subtle grid pattern
- **Top 10 leaderboard** - Gold, silver, and bronze styling for top players
- **Collision detection** - Server-authoritative projectile collisions

## Getting Started

### Installation

```bash
npm install
```

### Running Locally

The game uses SQLite for local development (no database setup required):

```bash
npm start
```

Visit `http://localhost:3000` in your browser.

### Railway Deployment

To deploy on Railway with PostgreSQL persistence:

1. Push your code to a Git repository
2. Create a new project on Railway
3. Add a PostgreSQL database service
4. Add your repository and deploy
5. Railway will automatically detect the `railway.json` configuration

The `DATABASE_URL` environment variable will be automatically set by Railway, and the game will use PostgreSQL instead of SQLite.

## Game Controls

- **WASD** - Move your player
- **Mouse click/hold** - Shoot projectiles
- **Hold mouse button** - Continuous rapid fire

## Architecture

- **Backend**: Node.js with Express and Socket.IO
- **Database**: SQLite (local) or PostgreSQL (Railway)
- **Frontend**: HTML5 Canvas with vanilla JavaScript
- **Real-time**: Socket.IO for player/projectile synchronization

## Security

- Server-authoritative collision detection
- Server-enforced rate limiting for shooting
- Atomic database updates for kill counting
- Player identification via socket ID (not username alone)
