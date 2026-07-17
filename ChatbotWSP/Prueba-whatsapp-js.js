const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Inicializamos el cliente guardando la sesión localmente
const client = new Client({
    authStrategy: new LocalAuth()
});

// Generar y mostrar el código QR en la terminal
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('Escanea el código QR con tu WhatsApp.');
});

// Confirmación de conexión exitosa
client.on('ready', () => {
    console.log('¡El bot está listo y conectado!');
});

// Escuchar mensajes entrantes
client.on('message', async (message) => {
    console.log(`Mensaje recibido: ${message.body}`);

    // Responder al comando !ping
    if (message.body.toLowerCase() === '!ping') {
        message.reply('¡Pong! El bot está funcionando correctamente 🤖');
    }
    if (message.body.toLocaleLowerCase() === 'quiero un turno') {
        message.reply('¡Claro! ¿En qué fecha y hora deseas el turno?');
        if (message.body.toLowerCase() === 'hoy mas tarde') {
            message.reply('perfecto');
        }
    }
    // Responder a un saludo simple
    if (message.body.toLowerCase() === 'hola') {
        // sendMessage responde en el chat sin citar el mensaje original
        client.sendMessage(message.from, '¡Hola! Soy un bot automatizado. ¿En qué te puedo ayudar?');
    }
});

// Iniciar el cliente
client.initialize();