const express = require('express')
const app = express()

// socket.io setup
const http = require('http')
const server = http.createServer(app)
const { Server } = require('socket.io')
const io = new Server(server, { pingInterval: 2000, pingTimeout: 5000 })

// Database setup - PostgreSQL for production, in-memory fallback for local dev
let db
let usePostgreSQL = false

if (process.env.DATABASE_URL) {
  // PostgreSQL for Railway/deployment
  const { Pool } = require('pg')

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })

  db = {
    async exec(sql) {
      await pool.query(sql)
    },
    prepare(sql) {
      let paramIndex = 1
      const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`)

      return {
        async run(...params) {
          return await pool.query(pgSql, params)
        },
        async get(...params) {
          const result = await pool.query(pgSql, params)
          return result.rows[0]
        },
        async all(...params) {
          const result = await pool.query(pgSql, params)
          return result.rows
        }
      }
    }
  }

  usePostgreSQL = true

  // Initialize PostgreSQL schema
  pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      player_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      lifetime_kills INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())
    );

    CREATE INDEX IF NOT EXISTS idx_lifetime_kills ON players(lifetime_kills DESC);
  `).catch(err => console.error('PostgreSQL schema init error:', err))
} else {
  // In-memory fallback for local development (no persistence)
  console.log('⚠️  No DATABASE_URL set - using in-memory storage (statistics will not persist)')

  const memoryStore = new Map()

  db = {
    async exec(sql) {
      // No-op for in-memory
    },
    prepare(sql) {
      return {
        async run(...params) {
          // Parse simple INSERT/UPDATE operations
          if (sql.includes('INSERT') || sql.includes('UPDATE')) {
            const playerId = params[0]
            const username = params[1]

            if (sql.includes('INSERT')) {
              memoryStore.set(playerId, {
                player_id: playerId,
                username: username,
                lifetime_kills: 0,
                created_at: Math.floor(Date.now() / 1000)
              })
            } else if (sql.includes('UPDATE') && sql.includes('lifetime_kills')) {
              const player = memoryStore.get(playerId)
              if (player) {
                player.lifetime_kills++
                memoryStore.set(playerId, player)
              }
            }
          }
        },
        async get(...params) {
          return memoryStore.get(params[0]) || null
        },
        async all(...params) {
          // Return all players sorted by lifetime_kills
          return Array.from(memoryStore.values())
            .sort((a, b) => b.lifetime_kills - a.lifetime_kills || a.created_at - b.created_at)
            .slice(0, 10)
            .map(p => ({ username: p.username, lifetime_kills: p.lifetime_kills }))
        }
      }
    }
  }
}

const port = process.env.PORT || 3000

app.use(express.static('public'))

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html')
})

const backEndPlayers = {}
const backEndProjectiles = {}

const SPEED = 5
const RADIUS = 10
const PROJECTILE_RADIUS = 5
let projectileId = 0

// Rapid fire configuration
const FIRE_COOLDOWN = 200 // milliseconds
const MAX_PROJECTILES_PER_PLAYER = 20
const BULLET_SPEED = 5

// Player cooldown tracking
const playerCooldowns = {}

// Send Top 10 leaderboard to a specific socket or all clients
async function sendLeaderboard(targetSocket = null) {
  const topPlayers = await db.prepare(`
    SELECT username, lifetime_kills
    FROM players
    ORDER BY lifetime_kills DESC, created_at ASC
    LIMIT 10
  `).all()

  const leaderboardData = topPlayers.map((player, index) => ({
    rank: index + 1,
    username: player.username,
    lifetimeKills: player.lifetime_kills
  }))

  if (targetSocket) {
    targetSocket.emit('updateLeaderboard', leaderboardData)
  } else {
    io.emit('updateLeaderboard', leaderboardData)
  }
}

io.on('connection', (socket) => {
  io.emit('updatePlayers', backEndPlayers)

  // Send current leaderboard to new player
  sendLeaderboard(socket).catch(err => console.error('Leaderboard send error:', err))

  socket.on('shoot', ({ x, y, angle }) => {
    const player = backEndPlayers[socket.id]
    if (!player) return

    // Server-side rate limiting
    const now = Date.now()
    const lastShot = playerCooldowns[socket.id] || 0
    if (now - lastShot < FIRE_COOLDOWN) {
      return // Reject shot due to cooldown
    }

    // Count active projectiles for this player
    const activeProjectiles = Object.values(backEndProjectiles).filter(
      p => p.playerId === socket.id
    ).length

    if (activeProjectiles >= MAX_PROJECTILES_PER_PLAYER) {
      return // Reject shot due to projectile limit
    }

    // Update cooldown
    playerCooldowns[socket.id] = now

    projectileId++

    const velocity = {
      x: Math.cos(angle) * BULLET_SPEED,
      y: Math.sin(angle) * BULLET_SPEED
    }

    backEndProjectiles[projectileId] = {
      x,
      y,
      velocity,
      playerId: socket.id
    }
  })

  socket.on('initGame', async ({ username, width, height }) => {
    // Initialize or update player in database
    const stmt = db.prepare(`
      INSERT INTO players (player_id, username, lifetime_kills)
      VALUES (?, ?, 0)
      ON CONFLICT(player_id) DO UPDATE SET username = ?
    `)
    await stmt.run(socket.id, username, username)

    // Get player's lifetime kills
    const playerData = await db.prepare('SELECT lifetime_kills FROM players WHERE player_id = ?').get(socket.id)

    backEndPlayers[socket.id] = {
      x: 1024 * Math.random(),
      y: 576 * Math.random(),
      color: `hsl(${360 * Math.random()}, 100%, 50%)`,
      sequenceNumber: 0,
      score: 0,
      username,
      lifetimeKills: playerData ? playerData.lifetime_kills : 0
    }

    // where we init our canvas
    backEndPlayers[socket.id].canvas = {
      width,
      height
    }

    backEndPlayers[socket.id].radius = RADIUS
  })

  socket.on('disconnect', (reason) => {
    delete backEndPlayers[socket.id]
    delete playerCooldowns[socket.id]
    io.emit('updatePlayers', backEndPlayers)
  })

  socket.on('keydown', ({ keycode, sequenceNumber }) => {
    const backEndPlayer = backEndPlayers[socket.id]

    if (!backEndPlayers[socket.id]) return

    backEndPlayers[socket.id].sequenceNumber = sequenceNumber
    switch (keycode) {
      case 'KeyW':
        backEndPlayers[socket.id].y -= SPEED
        break

      case 'KeyA':
        backEndPlayers[socket.id].x -= SPEED
        break

      case 'KeyS':
        backEndPlayers[socket.id].y += SPEED
        break

      case 'KeyD':
        backEndPlayers[socket.id].x += SPEED
        break
    }

    const playerSides = {
      left: backEndPlayer.x - backEndPlayer.radius,
      right: backEndPlayer.x + backEndPlayer.radius,
      top: backEndPlayer.y - backEndPlayer.radius,
      bottom: backEndPlayer.y + backEndPlayer.radius
    }

    if (playerSides.left < 0) backEndPlayers[socket.id].x = backEndPlayer.radius

    if (playerSides.right > 1024)
      backEndPlayers[socket.id].x = 1024 - backEndPlayer.radius

    if (playerSides.top < 0) backEndPlayers[socket.id].y = backEndPlayer.radius

    if (playerSides.bottom > 576)
      backEndPlayers[socket.id].y = 576 - backEndPlayer.radius
  })
})

// backend ticker
setInterval(async () => {
  // update projectile positions
  for (const id in backEndProjectiles) {
    backEndProjectiles[id].x += backEndProjectiles[id].velocity.x
    backEndProjectiles[id].y += backEndProjectiles[id].velocity.y

    const PROJECTILE_RADIUS = 5
    if (
      backEndProjectiles[id].x - PROJECTILE_RADIUS >=
        backEndPlayers[backEndProjectiles[id].playerId]?.canvas?.width ||
      backEndProjectiles[id].x + PROJECTILE_RADIUS <= 0 ||
      backEndProjectiles[id].y - PROJECTILE_RADIUS >=
        backEndPlayers[backEndProjectiles[id].playerId]?.canvas?.height ||
      backEndProjectiles[id].y + PROJECTILE_RADIUS <= 0
    ) {
      delete backEndProjectiles[id]
      continue
    }

    for (const playerId in backEndPlayers) {
      const backEndPlayer = backEndPlayers[playerId]

      const DISTANCE = Math.hypot(
        backEndProjectiles[id].x - backEndPlayer.x,
        backEndProjectiles[id].y - backEndPlayer.y
      )

      // collision detection
      if (
        DISTANCE < PROJECTILE_RADIUS + backEndPlayer.radius &&
        backEndProjectiles[id].playerId !== playerId
      ) {
        const killerId = backEndProjectiles[id].playerId
        const victimId = playerId

        if (backEndPlayers[killerId]) {
          backEndPlayers[killerId].score++

          // Increment lifetime kills in database (atomic operation)
          const updateStmt = db.prepare(`
            UPDATE players
            SET lifetime_kills = lifetime_kills + 1
            WHERE player_id = ?
          `)
          await updateStmt.run(killerId)

          // Get updated lifetime kills for the killer
          const killerData = await db.prepare('SELECT lifetime_kills FROM players WHERE player_id = ?').get(killerId)
          if (killerData) {
            backEndPlayers[killerId].lifetimeKills = killerData.lifetime_kills
          }

          // Broadcast updated leaderboard
          sendLeaderboard().catch(err => console.error('Leaderboard update error:', err))
        }

        delete backEndProjectiles[id]
        delete backEndPlayers[victimId]
        break
      }
    }
  }

  io.emit('updateProjectiles', backEndProjectiles)
  io.emit('updatePlayers', backEndPlayers)
}, 15)

server.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
