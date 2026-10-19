// Desktop shooting state
// NOTE: FIRE_COOLDOWN, WORLD_WIDTH, WORLD_HEIGHT and socket are declared in
// frontend.js which loads before this file. They are top-level `const`s so
// they are available here as globals. We must NOT re-declare them with `const`
// or `let` — that would throw a SyntaxError that aborts this entire file,
// which is what broke desktop firing before.

let isMouseDown = false
let lastShotTime = 0
let mouseShootInterval = null

// Check if event target is a mobile control element
function isMobileControl(element) {
  return element.closest('#joystickContainer') || element.closest('#fireButton')
}

function attemptShoot(event) {
  const player = frontEndPlayers[socket.id]
  if (!player) return

  const now = Date.now()
  if (now - lastShotTime < FIRE_COOLDOWN) return

  // Convert CSS-pixel mouse position → logical world coordinates.
  // The canvas is scaled by CSS (resizeGame in frontend.js), so we must
  // account for the ratio between the canvas's CSS size and the world size.
  const rect = canvas.getBoundingClientRect()
  const worldX = (event.clientX - rect.left) * (WORLD_WIDTH / rect.width)
  const worldY = (event.clientY - rect.top) * (WORLD_HEIGHT / rect.height)

  const angle = Math.atan2(worldY - player.y, worldX - player.x)

  socket.emit('shoot', {
    x: player.x,
    y: player.y,
    angle
  })

  lastShotTime = now
}

// Store last mouse event so the hold-to-shoot interval can reuse it
let lastMouseEvent = null

// Mouse down — fire immediately then start rapid-fire while held
addEventListener('mousedown', (event) => {
  if (isMobileControl(event.target)) return
  if (event.button !== 0) return // left-click only

  isMouseDown = true
  lastMouseEvent = event
  lastShotTime = 0 // allow immediate shot on fresh click

  attemptShoot(event)

  // Clear any stale interval
  if (mouseShootInterval) clearInterval(mouseShootInterval)

  // Continuous fire while button is held
  mouseShootInterval = setInterval(() => {
    if (isMouseDown && lastMouseEvent) attemptShoot(lastMouseEvent)
  }, FIRE_COOLDOWN)
})

// Mouse move — update aim direction while held
addEventListener('mousemove', (event) => {
  lastMouseEvent = event
})

// Mouse up — stop firing
addEventListener('mouseup', (event) => {
  if (isMobileControl(event.target)) return
  isMouseDown = false
  if (mouseShootInterval) {
    clearInterval(mouseShootInterval)
    mouseShootInterval = null
  }
})

// Safety: also stop if mouse leaves the window entirely
addEventListener('mouseleave', () => {
  isMouseDown = false
  if (mouseShootInterval) {
    clearInterval(mouseShootInterval)
    mouseShootInterval = null
  }
})
