const http = require("http");
const express = require("express");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000", // Update to match your React app's URL
    methods: ["GET", "POST"],
  },
});

// Serve static files (e.g., your React app if needed)
app.use(express.static("public"));

// Handle WebSocket connections
io.on("connection", (socket) => {
  console.log("a user connected");

  // Handle incoming messages
  socket.on("message", (data) => {
    console.log("Message received:", data);
    // Emit message to all clients
    io.emit("message", data);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("user disconnected");
  });
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
