// Rapid fire state
let isMouseDown = false
let lastShotTime = 0
const FIRE_COOLDOWN = 200 // milliseconds

// Logical game world size (must match frontend.js)
const WORLD_WIDTH = 1024
const WORLD_HEIGHT = 576

// Check if event target is a mobile control
function isMobileControl(element) {
  return element.closest('#joystickContainer') || element.closest('#fireButton')
}

// Mouse down - start shooting (desktop only)
addEventListener('mousedown', (event) => {
  // Ignore if clicking on mobile controls
  if (isMobileControl(event.target)) return

  if (event.button !== 0) return // Only left click
  isMouseDown = true
  attemptShoot(event)
})

// Mouse up - stop shooting
addEventListener('mouseup', (event) => {
  // Ignore if releasing on mobile controls
  if (isMobileControl(event.target)) return

  isMouseDown = false
})

// Mouse move - update angle for continuous shooting
addEventListener('mousemove', (event) => {
  if (isMouseDown) {
    attemptShoot(event)
  }
})

function attemptShoot(event) {
  const canvas = document.querySelector('canvas')
  const player = frontEndPlayers[socket.id]
  if (!player) return

  const now = Date.now()
  if (now - lastShotTime < FIRE_COOLDOWN) {
    return
  }

  const playerPosition = {
    x: player.x,
    y: player.y
  }

  // convert the click from CSS pixels to logical world coordinates
  const rect = canvas.getBoundingClientRect()
  const worldX = (event.clientX - rect.left) * (WORLD_WIDTH / rect.width)
  const worldY = (event.clientY - rect.top) * (WORLD_HEIGHT / rect.height)

  const angle = Math.atan2(worldY - playerPosition.y, worldX - playerPosition.x)

  socket.emit('shoot', {
    x: playerPosition.x,
    y: playerPosition.y,
    angle
  })

  lastShotTime = now
}

// Legacy click handler for backward compatibility
addEventListener('click', (event) => {
  // Ignore if clicking on mobile controls
  if (isMobileControl(event.target)) return

  if (!isMouseDown) {
    attemptShoot(event)
  }
})
