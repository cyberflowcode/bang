const canvas = document.querySelector('canvas')
const c = canvas.getContext('2d')

const socket = io()

const scoreEl = document.querySelector('#scoreEl')

const devicePixelRatio = window.devicePixelRatio || 1

// Logical game world size. Shared by all players and the server; never changes.
const WORLD_WIDTH = 1024
const WORLD_HEIGHT = 576

canvas.width = WORLD_WIDTH * devicePixelRatio
canvas.height = WORLD_HEIGHT * devicePixelRatio

c.scale(devicePixelRatio, devicePixelRatio)

// Scales the display (via CSS) to the largest 16:9 box that fits the window
function resizeGame() {
  const scale = Math.min(
    window.innerWidth / WORLD_WIDTH,
    window.innerHeight / WORLD_HEIGHT
  )
  const container = document.querySelector('#gameContainer')
  container.style.width = `${WORLD_WIDTH * scale}px`
  container.style.height = `${WORLD_HEIGHT * scale}px`

  // modestly scale the leaderboard text with the display
  const leaderboard = document.querySelector('#leaderboard')
  if (leaderboard) {
    leaderboard.style.fontSize = `${Math.max(12, Math.round(14 * scale))}px`
  }
}

resizeGame()
window.addEventListener('resize', resizeGame)

const frontEndPlayers = {}
const frontEndProjectiles = {}
const frontEndParticles = [] // death explosion particles

socket.on('updateLeaderboard', (leaderboardData) => {
  const leaderboardEl = document.querySelector('#topKillsLeaderboard')
  if (!leaderboardEl) return

  leaderboardEl.innerHTML = leaderboardData.map((player, index) => {
    let rankStyle = ''
    if (index === 0) {
      rankStyle = 'color: #ffd700; font-weight: bold;' // Gold
    } else if (index === 1) {
      rankStyle = 'color: #c0c0c0; font-weight: bold;' // Silver
    } else if (index === 2) {
      rankStyle = 'color: #cd7f32; font-weight: bold;' // Bronze
    }

    return `<div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
      <span style="${rankStyle}">${index + 1}. ${player.username}</span>
      <span style="color: #94a3b8;">${player.lifetimeKills}</span>
    </div>`
  }).join('')
})

socket.on('updateProjectiles', (backEndProjectiles) => {
  for (const id in backEndProjectiles) {
    const backEndProjectile = backEndProjectiles[id]

    if (!frontEndProjectiles[id]) {
      frontEndProjectiles[id] = new Projectile({
        x: backEndProjectile.x,
        y: backEndProjectile.y,
        radius: 5,
        color: frontEndPlayers[backEndProjectile.playerId]?.color,
        velocity: backEndProjectile.velocity
      })
    } else {
      frontEndProjectiles[id].x += backEndProjectiles[id].velocity.x
      frontEndProjectiles[id].y += backEndProjectiles[id].velocity.y
    }
  }

  for (const frontEndProjectileId in frontEndProjectiles) {
    if (!backEndProjectiles[frontEndProjectileId]) {
      delete frontEndProjectiles[frontEndProjectileId]
    }
  }
})

socket.on('updatePlayers', (backEndPlayers) => {
  for (const id in backEndPlayers) {
    const backEndPlayer = backEndPlayers[id]

    if (!frontEndPlayers[id]) {
      frontEndPlayers[id] = new Player({
        x: backEndPlayer.x,
        y: backEndPlayer.y,
        radius: 10,
        color: backEndPlayer.color,
        username: backEndPlayer.username
      })

      document.querySelector(
        '#playerLabels'
      ).innerHTML += `<div data-id="${id}" data-score="${backEndPlayer.score}">${backEndPlayer.username}: ${backEndPlayer.score}</div>`
    } else {
      document.querySelector(
        `div[data-id="${id}"]`
      ).innerHTML = `${backEndPlayer.username}: ${backEndPlayer.score}`

      document
        .querySelector(`div[data-id="${id}"]`)
        .setAttribute('data-score', backEndPlayer.score)

      // sorts the players divs
      const parentDiv = document.querySelector('#playerLabels')
      const childDivs = Array.from(parentDiv.querySelectorAll('div'))

      childDivs.sort((a, b) => {
        const scoreA = Number(a.getAttribute('data-score'))
        const scoreB = Number(b.getAttribute('data-score'))

        return scoreB - scoreA
      })

      // removes old elements
      childDivs.forEach((div) => {
        parentDiv.removeChild(div)
      })

      // adds sorted elements
      childDivs.forEach((div) => {
        parentDiv.appendChild(div)
      })

      frontEndPlayers[id].target = {
        x: backEndPlayer.x,
        y: backEndPlayer.y
      }

      if (id === socket.id) {
        const lastBackendInputIndex = playerInputs.findIndex((input) => {
          return backEndPlayer.sequenceNumber === input.sequenceNumber
        })

        if (lastBackendInputIndex > -1)
          playerInputs.splice(0, lastBackendInputIndex + 1)

        playerInputs.forEach((input) => {
          frontEndPlayers[id].target.x += input.dx
          frontEndPlayers[id].target.y += input.dy
        })
      }
    }
  }

  // this is where we delete frontend players
  for (const id in frontEndPlayers) {
    if (!backEndPlayers[id]) {
      const divToDelete = document.querySelector(`div[data-id="${id}"]`)
      divToDelete.parentNode.removeChild(divToDelete)

      if (id === socket.id) {
        document.querySelector('#usernameForm').style.display = 'block'
        // Hide mobile controls while login form is showing
        const mobileControls = document.getElementById('mobileControls')
        if (mobileControls) mobileControls.classList.add('hidden')
      }

      // Spawn death explosion particles at the player's last position
      const deadPlayer = frontEndPlayers[id]
      for (let i = 0; i < 20; i++) {
        const angle = (Math.PI * 2 / 20) * i
        const speed = Math.random() * 4 + 1
        frontEndParticles.push(new Particle(
          deadPlayer.x,
          deadPlayer.y,
          Math.random() * 4 + 2,  // radius 2–6
          deadPlayer.color,
          {
            x: Math.cos(angle) * speed,
            y: Math.sin(angle) * speed
          }
        ))
      }

      delete frontEndPlayers[id]
    }
  }
})

// ── FPS counter ─────────────────────────────────────────────────────────────
const fpsDisplay = document.getElementById('fpsDisplay')
const pingDisplay = document.getElementById('pingDisplay')
const FPS_CAP_DISPLAY = 90   // never show more than 90 in the readout

let lastFrameTime = performance.now()
let frameCount = 0
let displayedFps = 0

// ── Ping measurement ─────────────────────────────────────────────────────────
let currentPing = 0

function measurePing() {
  const start = performance.now()
  socket.emit('ping_check', () => {
    currentPing = Math.round(performance.now() - start)
  })
}

// Measure every 2 seconds
setInterval(measurePing, 2000)
measurePing()

// ── Animation loop ───────────────────────────────────────────────────────────
// ── Animation loop ───────────────────────────────────────────────────────────
let animationId
let lastFrameTimestamp = performance.now()

function animate() {
  animationId = requestAnimationFrame(animate)

  const now = performance.now()
  // Delta time in seconds, capped at 100ms to avoid huge jumps after tab switch
  const dt = Math.min((now - lastFrameTimestamp) / 1000, 0.1)
  lastFrameTimestamp = now

  // ── FPS calculation ──────────────────────────────────────────────────────
  frameCount++
  const elapsed = now - lastFrameTime
  if (elapsed >= 500) {               // update display every 500ms
    displayedFps = Math.min(FPS_CAP_DISPLAY, Math.round(frameCount * 1000 / elapsed))
    frameCount = 0
    lastFrameTime = now

    // Colour-code FPS: green ≥60, yellow 30-59, red <30
    const fpsColor = displayedFps >= 60 ? '#4ade80' : displayedFps >= 30 ? '#facc15' : '#f87171'
    fpsDisplay.style.color = fpsColor
    fpsDisplay.textContent = `FPS: ${displayedFps}`

    // Colour-code ping: green <80ms, yellow 80-150ms, red >150ms
    const pingColor = currentPing < 80 ? '#4ade80' : currentPing < 150 ? '#facc15' : '#f87171'
    pingDisplay.style.color = pingColor
    pingDisplay.textContent = `PING: ${currentPing} ms`
  }

  c.clearRect(0, 0, canvas.width, canvas.height)

  for (const id in frontEndPlayers) {
    const frontEndPlayer = frontEndPlayers[id]

    // Delta-time lerp — converges at the same visual rate regardless of FPS.
    // Factor: 1 - e^(-k * dt). k=8 means ~55% catchup per frame at 60fps,
    // same feel at 30fps or 120fps.
    if (frontEndPlayer.target) {
      const k = 8
      const alpha = 1 - Math.exp(-k * dt)
      frontEndPlayers[id].x += (frontEndPlayers[id].target.x - frontEndPlayers[id].x) * alpha
      frontEndPlayers[id].y += (frontEndPlayers[id].target.y - frontEndPlayers[id].y) * alpha
    }

    frontEndPlayer.draw()
  }

  for (const id in frontEndProjectiles) {
    const frontEndProjectile = frontEndProjectiles[id]
    frontEndProjectile.draw()
  }

  // Update death particles — draw, move, fade; remove when invisible
  for (let i = frontEndParticles.length - 1; i >= 0; i--) {
    frontEndParticles[i].update()
    if (frontEndParticles[i].alpha <= 0) {
      frontEndParticles.splice(i, 1)
    }
  }
}

animate()

const keys = {
  w: {
    pressed: false
  },
  a: {
    pressed: false
  },
  s: {
    pressed: false
  },
  d: {
    pressed: false
  }
}

// Mobile joystick state
const joystick = {
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  deltaX: 0,
  deltaY: 0,
  magnitude: 0
}

// Joystick configuration
const JOYSTICK_MAX_DISTANCE = 35
const JOYSTICK_DEAD_ZONE = 5

const SPEED = 5
const playerInputs = []
let sequenceNumber = 0

// Mobile movement integration - calculate movement from joystick
function getJoystickMovement() {
  if (!joystick.active || joystick.magnitude < JOYSTICK_DEAD_ZONE) {
    return { dx: 0, dy: 0 }
  }

  // joystick.deltaX/Y are already clamped to ±JOYSTICK_MAX_DISTANCE in the
  // pointer/touch move handler, so dividing by JOYSTICK_MAX_DISTANCE yields a
  // normalized -1..1 vector. Multiply ONCE by SPEED. The previous code
  // multiplied by normalizedMagnitude too, which squared the magnitude and
  // made the player feel dead/sluggish at low joystick deflection.
  const dx = (joystick.deltaX / JOYSTICK_MAX_DISTANCE) * SPEED
  const dy = (joystick.deltaY / JOYSTICK_MAX_DISTANCE) * SPEED

  return { dx, dy }
}

setInterval(() => {
  let dx = 0
  let dy = 0

  // Keyboard movement
  if (keys.w.pressed) dy -= SPEED
  if (keys.a.pressed) dx -= SPEED
  if (keys.s.pressed) dy += SPEED
  if (keys.d.pressed) dx += SPEED

  // Joystick movement (overrides keyboard if active)
  if (joystick.active) {
    const joystickMove = getJoystickMovement()
    dx = joystickMove.dx
    dy = joystickMove.dy
  }

  // Normalize diagonal so moving at 45° isn't faster than cardinal
  const magnitude = Math.sqrt(dx * dx + dy * dy)
  if (magnitude > SPEED) {
    dx = (dx / magnitude) * SPEED
    dy = (dy / magnitude) * SPEED
  }

  // Emit movement if any
  if (dx !== 0 || dy !== 0) {
    sequenceNumber++
    playerInputs.push({ sequenceNumber, dx, dy })

    // Single atomic move event — no more two separate keydown emits for diagonal
    socket.emit('move', { dx, dy, sequenceNumber })
  }
}, 15)

window.addEventListener('keydown', (event) => {
  if (!frontEndPlayers[socket.id]) return

  switch (event.code) {
    case 'KeyW':
      keys.w.pressed = true
      break

    case 'KeyA':
      keys.a.pressed = true
      break

    case 'KeyS':
      keys.s.pressed = true
      break

    case 'KeyD':
      keys.d.pressed = true
      break
  }
})

window.addEventListener('keyup', (event) => {
  if (!frontEndPlayers[socket.id]) return

  switch (event.code) {
    case 'KeyW':
      keys.w.pressed = false
      break

    case 'KeyA':
      keys.a.pressed = false
      break

    case 'KeyS':
      keys.s.pressed = false
      break

    case 'KeyD':
      keys.d.pressed = false
      break
  }
})

document.querySelector('#usernameForm').addEventListener('submit', (event) => {
  event.preventDefault()
  document.querySelector('#usernameForm').style.display = 'none'

  // Show mobile controls now that the form is gone
  const mobileControls = document.getElementById('mobileControls')
  if (mobileControls) mobileControls.classList.remove('hidden')

  socket.emit('initGame', {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    devicePixelRatio,
    username: document.querySelector('#usernameInput').value
  })
})

// Mobile joystick event handlers
const joystickContainer = document.getElementById('joystickContainer')
const joystickThumb = document.getElementById('joystickThumb')

if (joystickContainer && joystickThumb) {
  // Pointer events (for modern browsers)
  joystickContainer.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation() // prevent canvas pointerdown from firing
    joystick.active = true
    joystick.pointerId = event.pointerId
    joystick.startX = event.clientX
    joystick.startY = event.clientY
    joystick.deltaX = 0
    joystick.deltaY = 0
    joystick.magnitude = 0

    joystickContainer.setPointerCapture(event.pointerId)
  })

  joystickContainer.addEventListener('pointermove', (event) => {
    if (!joystick.active || event.pointerId !== joystick.pointerId) return

    event.preventDefault()

    const deltaX = event.clientX - joystick.startX
    const deltaY = event.clientY - joystick.startY
    const magnitude = Math.sqrt(deltaX * deltaX + deltaY * deltaY)

    // Clamp to max distance
    const clampedMagnitude = Math.min(magnitude, JOYSTICK_MAX_DISTANCE)
    const angle = Math.atan2(deltaY, deltaX)

    joystick.deltaX = Math.cos(angle) * clampedMagnitude
    joystick.deltaY = Math.sin(angle) * clampedMagnitude
    joystick.magnitude = clampedMagnitude

    // Update thumb position
    joystickThumb.style.transform = `translate(${joystick.deltaX}px, ${joystick.deltaY}px)`
  })

  const endJoystick = (event) => {
    if (!joystick.active || event.pointerId !== joystick.pointerId) return

    event.preventDefault()

    joystick.active = false
    joystick.pointerId = null
    joystick.deltaX = 0
    joystick.deltaY = 0
    joystick.magnitude = 0

    joystickThumb.style.transform = 'translate(0, 0)'

    if (joystickContainer.hasPointerCapture(event.pointerId)) {
      joystickContainer.releasePointerCapture(event.pointerId)
    }
  }

  joystickContainer.addEventListener('pointerup', endJoystick)
  joystickContainer.addEventListener('pointercancel', endJoystick)
  joystickContainer.addEventListener('pointerleave', endJoystick)

  // Touch events fallback — only register on browsers WITHOUT PointerEvent
  // support. Modern mobile browsers fire BOTH pointer and touch events for
  // the same physical touch; registering both causes double-handling and
  // corrupts joystick.pointerId tracking (touch.identifier vs pointer id),
  // which breaks the joystick and double-fires the shoot button.
  if (!window.PointerEvent) {
    joystickContainer.addEventListener('touchstart', (event) => {
      event.preventDefault()
      const touch = event.touches[0]
      joystick.active = true
      joystick.pointerId = touch.identifier
      joystick.startX = touch.clientX
      joystick.startY = touch.clientY
      joystick.deltaX = 0
      joystick.deltaY = 0
      joystick.magnitude = 0
    }, { passive: false })

    joystickContainer.addEventListener('touchmove', (event) => {
      if (!joystick.active) return
      event.preventDefault()

      const touch = event.touches[0]
      const deltaX = touch.clientX - joystick.startX
      const deltaY = touch.clientY - joystick.startY
      const magnitude = Math.sqrt(deltaX * deltaX + deltaY * deltaY)

      // Clamp to max distance
      const clampedMagnitude = Math.min(magnitude, JOYSTICK_MAX_DISTANCE)
      const angle = Math.atan2(deltaY, deltaX)

      joystick.deltaX = Math.cos(angle) * clampedMagnitude
      joystick.deltaY = Math.sin(angle) * clampedMagnitude
      joystick.magnitude = clampedMagnitude

      // Update thumb position
      joystickThumb.style.transform = `translate(${joystick.deltaX}px, ${joystick.deltaY}px)`
    }, { passive: false })

    const endJoystickTouch = (event) => {
      if (!joystick.active) return
      event.preventDefault()

      joystick.active = false
      joystick.pointerId = null
      joystick.deltaX = 0
      joystick.deltaY = 0
      joystick.magnitude = 0

      joystickThumb.style.transform = 'translate(0, 0)'
    }

    joystickContainer.addEventListener('touchend', endJoystickTouch)
    joystickContainer.addEventListener('touchcancel', endJoystickTouch)
  }
}

// Mobile FIRE button — press and drag to aim, auto-fires while held
const fireButton = document.getElementById('fireButton')
const fireButtonCanvas = document.getElementById('fireButtonCanvas')
const fireCtx = fireButtonCanvas.getContext('2d')

// Get the device pixel ratio and scale the canvas
const fireButtonDPR = window.devicePixelRatio || 1
fireButtonCanvas.width = 100 * fireButtonDPR
fireButtonCanvas.height = 100 * fireButtonDPR
fireCtx.scale(fireButtonDPR, fireButtonDPR)

let fireButtonActive = false
let fireButtonAimX = 50  // aim point relative to button center
let fireButtonAimY = 50
let fireButtonInterval = null

function drawFireButton() {
  const size = 100
  const center = size / 2

  // Background circle
  fireCtx.fillStyle = fireButtonActive ? 'rgba(239, 68, 68, 0.8)' : 'rgba(239, 68, 68, 0.5)'
  fireCtx.beginPath()
  fireCtx.arc(center, center, 48, 0, Math.PI * 2)
  fireCtx.fill()

  // Crosshair — draw + cursor pointing toward aim position
  fireCtx.strokeStyle = fireButtonActive ? 'rgba(248, 113, 113, 1)' : 'rgba(239, 200, 200, 0.8)'
  fireCtx.lineWidth = 2
  fireCtx.lineCap = 'round'

  // Vertical line of crosshair
  fireCtx.beginPath()
  fireCtx.moveTo(center, center - 15)
  fireCtx.lineTo(center, center - 5)
  fireCtx.stroke()

  fireCtx.beginPath()
  fireCtx.moveTo(center, center + 15)
  fireCtx.lineTo(center, center + 5)
  fireCtx.stroke()

  // Horizontal line of crosshair
  fireCtx.beginPath()
  fireCtx.moveTo(center - 15, center)
  fireCtx.lineTo(center - 5, center)
  fireCtx.stroke()

  fireCtx.beginPath()
  fireCtx.moveTo(center + 15, center)
  fireCtx.lineTo(center + 5, center)
  fireCtx.stroke()

  // Aim indicator — arrow pointing toward drag direction
  if (fireButtonActive && (Math.abs(fireButtonAimX - center) > 5 || Math.abs(fireButtonAimY - center) > 5)) {
    const angle = Math.atan2(fireButtonAimY - center, fireButtonAimX - center)
    const arrowX = center + Math.cos(angle) * 20
    const arrowY = center + Math.sin(angle) * 20

    fireCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    fireCtx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    fireCtx.lineWidth = 1.5

    // Arrow line
    fireCtx.beginPath()
    fireCtx.moveTo(center, center)
    fireCtx.lineTo(arrowX, arrowY)
    fireCtx.stroke()

    // Arrow head
    const headAngle1 = angle + Math.PI * 0.85
    const headAngle2 = angle - Math.PI * 0.85
    fireCtx.beginPath()
    fireCtx.moveTo(arrowX, arrowY)
    fireCtx.lineTo(arrowX + Math.cos(headAngle1) * 6, arrowY + Math.sin(headAngle1) * 6)
    fireCtx.lineTo(arrowX + Math.cos(headAngle2) * 6, arrowY + Math.sin(headAngle2) * 6)
    fireCtx.closePath()
    fireCtx.fill()
  }

  // Center dot
  fireCtx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  fireCtx.beginPath()
  fireCtx.arc(center, center, 2, 0, Math.PI * 2)
  fireCtx.fill()
}

// Draw initial button
drawFireButton()

function shootFromFireButton() {
  const player = frontEndPlayers[socket.id]
  if (!player) return

  // Get angle from button center to aim point
  const angle = Math.atan2(fireButtonAimY - 50, fireButtonAimX - 50)

  socket.emit('shoot', {
    x: player.x,
    y: player.y,
    angle
  })
}

fireButton.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  event.stopPropagation()

  fireButtonActive = true
  fireButton.classList.add('active')
  fireButton.setPointerCapture(event.pointerId)

  // Immediate shot
  shootFromFireButton()

  // Continuous fire while held
  fireButtonInterval = setInterval(shootFromFireButton, FIRE_COOLDOWN)

  drawFireButton()
})

fireButton.addEventListener('pointermove', (event) => {
  if (!fireButtonActive) return
  event.preventDefault()

  // Get position relative to button
  const rect = fireButton.getBoundingClientRect()
  fireButtonAimX = event.clientX - rect.left
  fireButtonAimY = event.clientY - rect.top

  // Clamp to button bounds
  fireButtonAimX = Math.max(5, Math.min(95, fireButtonAimX))
  fireButtonAimY = Math.max(5, Math.min(95, fireButtonAimY))

  drawFireButton()
})

const endFireButton = (event) => {
  if (!fireButtonActive) return
  event.preventDefault()

  fireButtonActive = false
  fireButton.classList.remove('active')

  if (fireButtonInterval) {
    clearInterval(fireButtonInterval)
    fireButtonInterval = null
  }

  if (fireButton.hasPointerCapture(event.pointerId)) {
    fireButton.releasePointerCapture(event.pointerId)
  }

  fireButtonAimX = 50
  fireButtonAimY = 50

  drawFireButton()
}

fireButton.addEventListener('pointerup', endFireButton)
fireButton.addEventListener('pointercancel', endFireButton)
fireButton.addEventListener('pointerleave', endFireButton)

// Reset all input states on window blur/visibility change
window.addEventListener('blur', () => {
  keys.w.pressed = false
  keys.a.pressed = false
  keys.s.pressed = false
  keys.d.pressed = false

  joystick.active = false
  joystick.pointerId = null
  joystick.deltaX = 0
  joystick.deltaY = 0
  joystick.magnitude = 0
  if (joystickThumb) joystickThumb.style.transform = 'translate(0, 0)'
})

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    keys.w.pressed = false
    keys.a.pressed = false
    keys.s.pressed = false
    keys.d.pressed = false

    joystick.active = false
    joystick.pointerId = null
    joystick.deltaX = 0
    joystick.deltaY = 0
    joystick.magnitude = 0
    if (joystickThumb) joystickThumb.style.transform = 'translate(0, 0)'
  }
})
