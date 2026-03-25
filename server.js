// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// === ÉTAT GLOBAL PARTAGÉ (sync entre tous les clients) ===
let sharedState = {
  pitstops: [],   // tableau d'objets pitstop
  config: null,   // objet config complet (cars, crews, rigs, pitstopTypes)
  currentLap: 1   // entier
};

// Sert les fichiers statiques dans ./public
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('✅ Un utilisateur s’est connecté');

  // Envoie l'état complet au nouveau client
  socket.emit('init', sharedState);

  // --- PITSTOPS (liste complète) ---
  socket.on('updatePitstops', (newPitstops) => {
    if (Array.isArray(newPitstops)) {
      sharedState.pitstops = newPitstops;
      socket.broadcast.emit('updatePitstops', sharedState.pitstops);
    }
  });

  // --- CONFIG (objet complet) ---
  socket.on('updateConfig', (newConfig) => {
    if (newConfig && typeof newConfig === 'object') {
      sharedState.config = newConfig;
      socket.broadcast.emit('updateConfig', sharedState.config);
    }
  });

  // --- CURRENT LAP ---
  socket.on('updateCurrentLap', (newLap) => {
    const n = Number(newLap);
    if (Number.isFinite(n) && n >= 0) {
      sharedState.currentLap = n;
      socket.broadcast.emit('updateCurrentLap', sharedState.currentLap);
    }
  });

  // --- TOUT EN UNE FOIS (utile à l'import) ---
  socket.on('updateAll', (partial) => {
    if (!partial || typeof partial !== 'object') return;

    const next = { ...sharedState };

    if (Array.isArray(partial.pitstops)) next.pitstops = partial.pitstops;
    if (partial.config && typeof partial.config === 'object') next.config = partial.config;
    if (Number.isFinite(Number(partial.currentLap))) next.currentLap = Number(partial.currentLap);

    sharedState = next;
    socket.broadcast.emit('updateAll', sharedState);
  });

  socket.on('disconnect', () => {
    console.log('❌ Un utilisateur s’est déconnecté');
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🌍 Serveur démarré : http://localhost:${PORT}`);
});
