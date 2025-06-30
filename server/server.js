const WebSocket = require('ws');
const http = require('http');

const port = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocket.Server({ server });

const clients = new Map();

wss.on('connection', (ws) => {
    const id = uuidv4();
    clients.set(ws, id);

    console.log(`New connection ${id}`);

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        broadcast(ws, data);
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`Connection ${id} closed`);
    });
});

function broadcast(sender, data) {
    clients.forEach((id, client) => {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0,
            v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

server.listen(port, () => {
    console.log(`✅ Signaling server listening on port ${port}`);
});
