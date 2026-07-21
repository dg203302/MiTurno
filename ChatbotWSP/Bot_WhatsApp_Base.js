require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const { Server } = require('socket.io');
const qr_consola = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const api_key_ia = process.env.api_key_chtbot; //esto para local nada mas
const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI({ apiKey: api_key_ia });

// Cargar reglas iniciales desde el archivo de texto plano para evitar reinicios por watch mode
const rulesPath = path.join(__dirname, 'Reglas_resp_Modelo.txt');
let ReglasRespActuales = '';
try {
    ReglasRespActuales = fs.readFileSync(rulesPath, 'utf-8');
} catch (error) {
    console.error("Error al leer Reglas_resp_Modelo.txt, usando fallback...", error);
    ReglasRespActuales = "Por favor responde amablemente y ayuda al usuario a agendar un turno.";
}

let SesionLista = false;

let QR_Act = ''

//1ero levantar el servidor
const http = require('http');
const { text } = require('stream/consumers');
const servidor = http.createServer((req, res) => {
    if (req.url == '/') {
        res.statusCode = 200;
        res.statusMessage = "Conectado!"
    }
    else {
        res.statusCode = 400;
        res.statusMessage = "Error!"
    }
    res.end();
})

//2do levantar el cliente whatsapp-js
let wsp;

//3ero abrir el socket
const Socket_Bidirecc = new Server(servidor, { cors: { origin: "*", methods: ["GET", "POST"] } })

// Historial de chat persistido en archivo local JSON
const historyPath = path.join(__dirname, 'chat_history.json');
let chatHistory = [];
try {
    chatHistory = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
} catch (error) {
    chatHistory = [];
}

function guardarMensajeHistorial(sender, numero, texto) {
    const msgObj = {
        sender,
        numero,
        texto,
        timestamp: Date.now()
    };
    chatHistory.push(msgObj);
    if (chatHistory.length > 2000) {
        chatHistory.shift();
    }
    try {
        fs.writeFileSync(historyPath, JSON.stringify(chatHistory, null, 2), 'utf-8');
    } catch (error) {
        console.error("Error al guardar historial de chat:", error);
    }
    // Emitir mensaje en tiempo real al frontend
    Socket_Bidirecc.emit('msg_nuevo', msgObj);
}

function getCleanNumber(jid) {
    if (!jid) return '';
    const raw = jid.split('@')[0];
    // Elimina sufijos de dispositivos y sesiones como :1, .0, _0, etc.
    return raw.split(':')[0].split('.')[0].split('_')[0];
}

function iniciarWSP() {
    console.log("Inicializando cliente whatsapp-web.js...");
    wsp = new Client({
        authStrategy: new LocalAuth({
            client_id: "Bot_Pruebas_Local",
            dataPath: "/home/diego/.wwebjs_auth_data"
        }),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    // Evento del QR
    wsp.on('qr', (qr) => {
        QR_Act = qr;
        qr_consola.generate(qr, { small: true });
        Socket_Bidirecc.emit('codigoqr', qr);
    });

    // Evento de iniciar el cliente
    wsp.on('ready', () => {
        console.log("Conexion Establecida");
        SesionLista = true;
        Socket_Bidirecc.emit('estado', 'Conectado');
    });

    // Detector de mensajes ingresados
    wsp.on('message_create', async msg => {
        try {
            console.log(`[Mensaje Detectado] De: ${msg.from} | Para: ${msg.to} | ¿Es mío?: ${msg.fromMe} | Cuerpo: "${msg.body}"`);

            // 1. Evitar bucles infinitos: Ignorar los mensajes enviados por el usuario a otros
            // Permitimos los mensajes enviados a sí mismo (msg.to === msg.from) para poder probar el bot.
            if (msg.fromMe && msg.to && msg.to !== msg.from) return;

            // Evitar que el bot se responda a sí mismo infinitamente si estamos probando en nuestro propio chat
            if (msg.fromMe && (msg.body.includes('--Esta Respuesta ha sido generada') || msg.body.includes('bot automatizado con IA'))) return;

            // 2. Ignorar actualizaciones de estado (historias) y difusiones
            if (msg.isStatus || msg.from === 'status@broadcast') return;

            // 3. Ignorar mensajes de grupos
            const esGrupo = msg.from.endsWith('@g.us') || (msg.to && msg.to.endsWith('@g.us'));
            if (esGrupo) return;

            // 4. Validar que el remitente o destinatario sea un número de usuario estándar o @lid
            const esUsuarioValido =
                msg.from.endsWith('@c.us') || (msg.to && msg.to.endsWith('@c.us')) ||
                msg.from.endsWith('@lid') || (msg.to && msg.to.endsWith('@lid'));
            if (!esUsuarioValido) return;

            // Guardar el mensaje entrante/saliente en el historial persistente
            const chatID = msg.fromMe ? msg.to : msg.from;
            const clientNumber = getCleanNumber(chatID);
            const senderType = msg.fromMe ? 'bot' : 'cliente';
            guardarMensajeHistorial(senderType, clientNumber, msg.body);

            // --- A partir de acá, responder ---
            // Evento de estar tipeando
            try {
                const chat = await msg.getChat();
                chat.sendStateTyping();
            } catch (error) {
                console.log("No se pudo simular 'escribiendo...' debido a actualizaciones de WhatsApp Web.");
            }
            // Obtener el historial de chat persistente filtrado para este usuario
            const mensajesFiltrados = chatHistory.filter(h => h.numero === clientNumber);
            // Tomamos los últimos 15 mensajes para no saturar el contexto de la IA
            const ultimosMensajes = mensajesFiltrados.slice(-15);
            const historialTexto = ultimosMensajes
                .map(h => `${h.sender === 'bot' ? 'Respuesta Chatbot' : 'Mensaje Usuario'}: ${h.texto}`)
                .join('\n');


            console.log(`[IA] Generando respuesta para ${clientNumber}...`);
            const mens_resp = await GenerarResp_IA(msg, historialTexto);
            console.log(`[IA] Respuesta generada: "${mens_resp}"`);

            setTimeout(() => {
                msg.reply(mens_resp);
                guardarMensajeHistorial('bot', clientNumber, mens_resp);
            }, calcularDelay(mens_resp));
        } catch (error) {
            console.error("Error crítico en el manejador de mensajes:", error);
        }
    });

    wsp.initialize().catch(err => {
        console.error("Error crítico durante initialize de whatsapp-web.js:", err);
    });
}

//4to escucho el servidor para manejar whatsapp-js
servidor.listen(5001, () => {
    iniciarWSP();
})

//5to manejo de conexion y desconexion del socket
Socket_Bidirecc.on('connection', (Socket) => {
    // Enviar reglas actuales al conectar
    Socket.emit('reglas', ReglasRespActuales);
    // Enviar historial de chat persistente
    Socket.emit('historial_completo', chatHistory);

    // Recibir y guardar nuevas reglas desde el frontend
    Socket.on('guardar_reglas', (nuevasReglas) => {
        console.log('Guardando nuevas reglas de IA recibidas del frontend...');
        try {
            ReglasRespActuales = nuevasReglas;
            fs.writeFileSync(rulesPath, nuevasReglas, 'utf-8');
            console.log('Reglas de IA guardadas correctamente en archivo.');
            Socket.emit('guardar_reglas_ok');
        } catch (error) {
            console.error('Error al guardar las reglas en Reglas_resp_Modelo.txt:', error);
            Socket.emit('guardar_reglas_error', error.message);
        }
    });

    if (SesionLista === false && QR_Act !== '') {
        Socket.emit('codigoqr', QR_Act);
    } else if (SesionLista === true) {
        Socket.emit('estado', 'Conectado');
    }
    // Aca manejo el evento de logout
    Socket.on('logout', async () => {
        console.log('Cerrando sesión de WhatsApp a pedido del frontend...');
        try {
            // 1. Desvinculo el bot de WhatsApp Web
            await wsp.logout();
            // Destruimos la instancia de Puppeteer por seguridad para liberar RAM
            await wsp.destroy();

            // 2. Reseteamos las banderas
            SesionLista = false;
            QR_Act = '';

            // 3. Vaciamos todos los historiales de IA del objeto global
            for (let numeroUsuario in historialesIA) {
                delete historialesIA[numeroUsuario];
            }

            // 4. Le avisamos al frontend que todo salió bien para que actualice la vista
            Socket.emit('logout_exitoso');

            // 5. Volvemos a inicializar el bot recreando la instancia del cliente
            iniciarWSP();
        } catch (error) {
            console.error('Error al intentar cerrar sesión:', error);
            Socket.emit('logout_error', 'No se pudo cerrar la sesión correctamente');
        }
    })
})

function calcularDelay(texto_resp) {
    const tiempoReaccion = 800;  // 0.8 segundos de pausa inicial
    const msPorCaracter = 25;    // 25 ms por letra (más natural y sin esperas largas)
    const maxDelay = 6000;       // máximo 6 segundos para no hacer esperar demasiado
    const tiempoTipeo = [...texto_resp].length * msPorCaracter;
    return Math.min(tiempoReaccion + tiempoTipeo, maxDelay);
}

async function GenerarResp_IA(mensaje_Actu, Historial) {
    // Restriccion para la respuesta
    const Restriccion = `Quiero que tomes en cuenta el siguiente contexto de la conversación para responder:
    ${Historial}
    junto con las siguientes Restricciones:
    ${ReglasRespActuales}
    Responde de manera respetuosa y humana. Queda terminantemente prohibido responder preguntas o hablar de temas que estén fuera del rubro de las restricciones indicadas. Si el usuario pregunta algo ajeno a este rubro, NO respondas a su pregunta bajo ningún concepto; en su lugar, limítate única y exclusivamente a pedirle de manera amable que retome la conversación acerca del rubro del negocio.`;
    // realizar la peticion
    try {
        const interaction = await ai.interactions.create({
            model: "gemini-3.5-flash-lite",
            input: mensaje_Actu.body,
            system_instruction: Restriccion
        });

        const content = interaction.output_text;

        // Verify content presence
        if (!content) {
            console.error("Gemini returned empty output_text:", interaction);
            return "Disculpá, no pude obtener respuesta de la IA en este momento.";
        }

        // Devolvemos el texto generado por la IA
        if (content == 'User Safety: safe') {
            return 'Volveme a escribir porfa!'
        }
        else {
            return content;
        }
    } catch (error) {
        console.error("Error al consultar Gemini AI:", error);
        return "Disculpá, tuve un problema al procesar tu mensaje.";
    }
}

