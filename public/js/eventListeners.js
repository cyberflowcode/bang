addEventListener('click', (event) => {
  const canvas = document.querySelector('canvas')
  const player = frontEndPlayers[socket.id]
  if (!player) return

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
})
