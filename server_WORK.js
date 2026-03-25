const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// On stocke ici l’état global partagé
let sharedState = {
    pitstops: []
};

// Sert les fichiers HTML / JS dans le dossier "public"
app.use(express.static(path.join(__dirname, 'public')));

// Quand un utilisateur se connecte
io.on('connection', (socket) => {
    console.log('✅ Un utilisateur s’est connecté');

    // On envoie l’état initial
    socket.emit('init', sharedState);

    // Quand un utilisateur envoie une mise à jour
    socket.on('updatePitstops', (newState) => {
        sharedState.pitstops = newState;

        // On envoie à tous les autres utilisateurs
        socket.broadcast.emit('updatePitstops', newState);
    });

    // (Optionnel) Déconnexion
    socket.on('disconnect', () => {
        console.log('❌ Un utilisateur s’est déconnecté');
    });
});

// Le serveur écoute sur le port 3000
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🌍 Serveur démarré : http://localhost:${PORT}`);
});
