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
      }

      delete frontEndPlayers[id]
    }
  }
})

let animationId
function animate() {
  animationId = requestAnimationFrame(animate)
  // c.fillStyle = 'rgba(0, 0, 0, 0.1)'
  c.clearRect(0, 0, canvas.width, canvas.height)

  for (const id in frontEndPlayers) {
    const frontEndPlayer = frontEndPlayers[id]

    // linear interpolation — 0.15 gives smooth catchup without the
    // bouncy/rubbery feel that 0.5 causes at lower movement speeds
    if (frontEndPlayer.target) {
      frontEndPlayers[id].x +=
        (frontEndPlayers[id].target.x - frontEndPlayers[id].x) * 0.3
      frontEndPlayers[id].y +=
        (frontEndPlayers[id].target.y - frontEndPlayers[id].y) * 0.3
    }

    frontEndPlayer.draw()
  }

  for (const id in frontEndProjectiles) {
    const frontEndProjectile = frontEndProjectiles[id]
    frontEndProjectile.draw()
  }

  // for (let i = frontEndProjectiles.length - 1; i >= 0; i--) {
  //   const frontEndProjectile = frontEndProjectiles[i]
  //   frontEndProjectile.update()
  // }
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

  // Emit movement if any
  if (dx !== 0 || dy !== 0) {
    sequenceNumber++
    playerInputs.push({ sequenceNumber, dx, dy })

    // Emit combined movement as keydown events for server compatibility
    if (dy < 0) socket.emit('keydown', { keycode: 'KeyW', sequenceNumber })
    if (dx < 0) socket.emit('keydown', { keycode: 'KeyA', sequenceNumber })
    if (dy > 0) socket.emit('keydown', { keycode: 'KeyS', sequenceNumber })
    if (dx > 0) socket.emit('keydown', { keycode: 'KeyD', sequenceNumber })
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

// Mobile FIRE button handler
const FIRE_COOLDOWN = 2000 // milliseconds — must match server FIRE_COOLDOWN
let fireInterval = null

const fireButton = document.getElementById('fireButton')
if (fireButton) {
  const shootInMovementDirection = () => {
    const player = frontEndPlayers[socket.id]
    if (!player) return

    let angle

    // If joystick is active, shoot in joystick direction
    if (joystick.active && joystick.magnitude >= JOYSTICK_DEAD_ZONE) {
      angle = Math.atan2(joystick.deltaY, joystick.deltaX)
    } else {
      // Otherwise shoot toward the nearest enemy
      let nearestEnemy = null
      let nearestDistance = Infinity

      for (const id in frontEndPlayers) {
        if (id === socket.id) continue

        const enemy = frontEndPlayers[id]
        const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y)

        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestEnemy = enemy
        }
      }

      if (nearestEnemy) {
        angle = Math.atan2(nearestEnemy.y - player.y, nearestEnemy.x - player.x)
      } else {
        // No enemies, shoot in a default direction (up)
        angle = -Math.PI / 2
      }
    }

    socket.emit('shoot', {
      x: player.x,
      y: player.y,
      angle
    })
  }

  // Pointer events (for modern browsers)
  fireButton.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    fireButton.classList.add('active')
    fireButton.setPointerCapture(event.pointerId)

    // Clear any existing interval
    if (fireInterval) {
      clearInterval(fireInterval)
      fireInterval = null
    }

    // Immediate shot
    shootInMovementDirection()

    // Continuous shooting
    fireInterval = setInterval(shootInMovementDirection, FIRE_COOLDOWN)
  })

  const endFire = (event) => {
    event.preventDefault()
    fireButton.classList.remove('active')

    if (fireInterval) {
      clearInterval(fireInterval)
      fireInterval = null
    }

    if (fireButton.hasPointerCapture(event.pointerId)) {
      fireButton.releasePointerCapture(event.pointerId)
    }
  }

  fireButton.addEventListener('pointerup', endFire)
  fireButton.addEventListener('pointercancel', endFire)
  fireButton.addEventListener('pointerleave', endFire)

  // Touch events fallback — only register on browsers WITHOUT PointerEvent
  // support (see the joystick block above for the full rationale).
  if (!window.PointerEvent) {
    fireButton.addEventListener('touchstart', (event) => {
      event.preventDefault()
      fireButton.classList.add('active')

      // Clear any existing interval
      if (fireInterval) {
        clearInterval(fireInterval)
        fireInterval = null
      }

      // Immediate shot
      shootInMovementDirection()

      // Continuous shooting
      fireInterval = setInterval(shootInMovementDirection, FIRE_COOLDOWN)
    }, { passive: false })

    const endFireTouch = (event) => {
      event.preventDefault()
      fireButton.classList.remove('active')

      if (fireInterval) {
        clearInterval(fireInterval)
        fireInterval = null
      }
    }

    fireButton.addEventListener('touchend', endFireTouch)
    fireButton.addEventListener('touchcancel', endFireTouch)
  }
}

// Reset all input states on window blur/visibility change
window.addEventListener('blur', () => {
  // Reset keyboard state
  keys.w.pressed = false
  keys.a.pressed = false
  keys.s.pressed = false
  keys.d.pressed = false

  // Reset joystick state
  joystick.active = false
  joystick.pointerId = null
  joystick.deltaX = 0
  joystick.deltaY = 0
  joystick.magnitude = 0
  if (joystickThumb) {
    joystickThumb.style.transform = 'translate(0, 0)'
  }

  // Reset fire button
  const fireButton = document.getElementById('fireButton')
  if (fireButton) {
    fireButton.classList.remove('active')
  }

  // Clear fire interval
  if (fireInterval) {
    clearInterval(fireInterval)
    fireInterval = null
  }
})

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Same reset as blur
    keys.w.pressed = false
    keys.a.pressed = false
    keys.s.pressed = false
    keys.d.pressed = false

    joystick.active = false
    joystick.pointerId = null
    joystick.deltaX = 0
    joystick.deltaY = 0
    joystick.magnitude = 0
    if (joystickThumb) {
      joystickThumb.style.transform = 'translate(0, 0)'
    }

    const fireButton = document.getElementById('fireButton')
    if (fireButton) {
      fireButton.classList.remove('active')
    }

    // Clear fire interval
    if (fireInterval) {
      clearInterval(fireInterval)
      fireInterval = null
    }
  }
})
