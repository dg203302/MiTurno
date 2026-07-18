const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Intentamos cargar la API Key de las variables de entorno o del archivo .env
if (!process.env.api_key_chtbot) {
    try {
        const fs = require('fs');
        const path = require('path');
        const envPath = path.join(__dirname, '..', '.env');
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            const match = envContent.match(/api_key_chtbot\s*=\s*['"]?([^'"\n\r]+)['"]?/);
            if (match && match[1]) {
                process.env.api_key_chtbot = match[1].trim();
            }
        }
    } catch (e) {
        console.error("No se pudo leer el archivo .env:", e);
    }
}

const api_key_ia = process.env.api_key_chtbot;

const client = new Client({
    authStrategy: new LocalAuth()
});

// Historial conversacional por usuario para que la IA tenga memoria
const chatHistories = {};

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('Escanea el código QR con tu WhatsApp.');
});

client.on('ready', () => {
    console.log('¡El bot está listo y conectado!');
});

client.on('message', async (message) => {
    await procesar_mensj(message)
});

async function procesar_mensj(message) {
    // Solo procesar mensajes de chat normales (ignorar estados, notificaciones e2e, etc.)
    if (message.type !== 'chat') return;

    const userId = message.from;
    const text = message.body.trim();
    
    // Ignorar mensajes vacíos o notificaciones internas de WhatsApp como "usersafety:safe"
    if (!text || text.toLowerCase() === 'usersafety:safe' || text.toLowerCase() === 'usersafety') return;

    if (!chatHistories[userId]) {
        chatHistories[userId] = [];
    }

    // Guardamos el mensaje del usuario en su historial
    chatHistories[userId].push({ role: "user", content: text });

    // Limitamos el historial a los últimos 16 mensajes para evitar exceder límites de tokens
    if (chatHistories[userId].length > 16) {
        chatHistories[userId] = chatHistories[userId].slice(-16);
    }

    try {
        const replyText = await getIA(chatHistories[userId]);

        // Guardamos la respuesta de la IA en el historial
        chatHistories[userId].push({ role: "assistant", content: replyText });

        await message.reply(replyText);
    } catch (error) {
        console.error("Error al procesar con IA:", error);
        await message.reply("Disculpa, en este momento tengo dificultades para responder. Por favor, intenta de nuevo.");
    }
}

async function getIA(chatHistory) {
    if (!api_key_ia) {
        console.error("Error: api_key_ia (process.env.api_key_chtbot) no está configurada.");
        return "Lo siento, tengo un problema de configuración y no puedo responder. Por favor, intenta más tarde.";
    }

    const prompt_restricc = `Eres el asistente virtual y recepcionista de la barbería "MiTurno". Tu personalidad es 100% humana, súper amigable, directa y con mucha "buena onda", como si fueras un barbero de confianza charlando con un cliente habitual. 

REGLAS OBLIGATORIAS:
1. HUMANIZACIÓN TOTAL: Está estrictamente prohibido sonar como un bot (cero frases como "Hola, soy el asistente virtual"). Habla como una persona real: usa muletillas naturales, saluda con entusiasmo ("¿Qué onda crack?", "¡Buenas! ¿Cómo andamos?"), y mantén un tono relajado y muy cordial.
2. ENFOQUE: Tu único objetivo es ayudar con los servicios de la barbería y agendar turnos. Si te hablan de otros temas, usa el humor para volver a la barbería.
3. HORARIOS: Trabajamos de lunes a sábado de 9:00 a 18:00 hs.
4. BREVEDAD: Tus respuestas deben ser cortas, directas y fáciles de leer. Ve al grano pero con estilo.
5. FLUJO DE RESERVA AUTÓNOMO: Para agendar un turno, debes recopilar SIEMPRE estos 6 datos conversando de forma natural (puedes pedirlos poco a poco o de a un par, no todos de golpe como un formulario):
   - Servicio (corte, barba, perfilado, combo, etc.)
   - Barbero (pregunta si tiene alguna preferencia de barbero o le da igual)
   - Fecha (MUY IMPORTANTE: debes interpretar el día y formatearlo y confirmarlo siempre en formato DD/MM)
   - Horario (dentro de nuestro horario de atención)
   - Nombre del cliente
   - Teléfono de contacto
6. TICKET DE CONFIRMACIÓN: Una vez que tengas los 6 datos completos, NO confirmes directamente. Primero, muéstrale un "Ticket de Reserva" ordenado (como si fuera un recibo) con todos los datos recopilados y pídele que lo confirme (ej. "¿Todo correcto, fiera? ¿Confirmamos?").
7. CIERRE: Cuando el cliente confirme el ticket, despídete de forma entusiasta indicando que el turno está oficialmente agendado y que lo esperan.
8. IDIOMA: Responde siempre en español.`;

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${api_key_ia}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/dg203302/MiTurno",
                "X-Title": "MiTurno Barbershop Bot"
            },
            body: JSON.stringify({
                model: "openrouter/free",
                messages: [
                    { role: "system", content: prompt_restricc },
                    ...chatHistory
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "No pude generar una respuesta.";
    } catch (error) {
        console.error("Error al llamar a la IA (OpenRouter):", error);
        return "Disculpa, en este momento tengo un problema para procesar tu consulta. ¿Podrías volver a intentarlo?";
    }
}

client.initialize();
