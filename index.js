/**
 * Revolution MD - Powered by KnightBot Core Engine
 * Owner: Mr Christ X (+50937081286)
 */
require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const express = require('express')
const cors = require('cors')
const http = require('http')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys")
const NodeCache = require("node-cache")
const pino = require("pino")
const { parsePhoneNumber } = require("libphonenumber-js")
const { rmSync, existsSync } = require('fs')
const { join } = require('path')

// Import lightweight store
const store = require('./lib/lightweight_store')
store.readFromFile()
const settings = require('./settings')
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// Optimisation mémoire
setInterval(() => {
    if (global.gc) {
        global.gc()
    }
}, 60_000)

setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 450) {
        console.log('⚠️ RAM élevée (>450MB), redémarrage préventif...')
        process.exit(1)
    }
}, 30_000)

let XeonBotInc = null;

// ==========================================
// 🌐 SERVEUR WEB EXPRESS (PORT NORTHFLANK & PAIRING)
// ==========================================
const app = express();
const PORT = process.env.PORT || 30600;

app.use(cors());
app.use(express.json());

// Page Web pour entrer son numéro et obtenir le code
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Revolution MD - Jumelage</title>
        <style>
            body { background: #0a0a12; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
            .card { background: #13131f; border: 1px solid #ff2a4b; padding: 30px; border-radius: 16px; box-shadow: 0 0 30px rgba(255, 42, 75, 0.25); text-align: center; max-width: 420px; width: 90%; }
            h1 { color: #ff2a4b; margin: 0 0 10px 0; font-size: 24px; letter-spacing: 1px; }
            p { color: #999; font-size: 14px; margin-bottom: 24px; line-height: 1.4; }
            input { width: 100%; padding: 14px; margin-bottom: 16px; background: #1c1c2e; border: 1px solid #333; color: #fff; border-radius: 10px; box-sizing: border-box; font-size: 16px; text-align: center; outline: none; }
            input:focus { border-color: #ff2a4b; }
            button { width: 100%; padding: 14px; background: #ff2a4b; color: #fff; border: none; border-radius: 10px; font-weight: bold; cursor: pointer; font-size: 16px; transition: 0.2s; }
            button:hover { background: #d91b39; }
            #box { display: none; margin-top: 20px; padding: 16px; background: #201015; border: 1px dashed #ff2a4b; border-radius: 10px; }
            #code { font-size: 28px; font-weight: bold; color: #00ffaa; letter-spacing: 4px; margin-top: 5px; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>REVOLUTION MD</h1>
            <p>Entrez votre numéro WhatsApp complet avec indicatif pays (ex: <b>50937081286</b>)</p>
            <input type="text" id="phone" placeholder="Ex: 50937081286" />
            <button id="btn" onclick="getCode()">Obtenir mon Code</button>
            <div id="box">
                <div style="font-size: 12px; color: #aaa;">VOTRE CODE DE JUMELAGE :</div>
                <div id="code">----</div>
            </div>
        </div>
        <script>
            async function getCode() {
                const phone = document.getElementById('phone').value.replace(/[^0-9]/g, '');
                if (!phone || phone.length < 8) return alert('Veuillez entrer un numéro valide.');
                const btn = document.getElementById('btn');
                btn.innerText = 'Génération en cours...';
                btn.disabled = true;
                try {
                    const res = await fetch('/api/pair?phone=' + phone);
                    const data = await res.json();
                    if (data.code) {
                        document.getElementById('code').innerText = data.code;
                        document.getElementById('box').style.display = 'block';
                    } else {
                        alert(data.error || 'Erreur lors de la génération.');
                    }
                } catch (e) {
                    alert('Erreur de connexion au serveur.');
                }
                btn.innerText = 'Obtenir mon Code';
                btn.disabled = false;
            }
        </script>
    </body>
    </html>
    `);
});

// Endpoint anti-veille
app.get('/api/ping', (req, res) => res.json({ status: 'alive', uptime: process.uptime() }));

// Endpoint de génération du Pairing Code via l'URL
app.get('/api/pair', async (req, res) => {
    const phone = (req.query.phone || '').replace(/[^0-9]/g, '');
    if (!phone || phone.length < 8) return res.status(400).json({ error: 'Numéro invalide' });

    if (!XeonBotInc) return res.status(503).json({ error: 'Le socket démarre. Réessayez dans 5 secondes.' });

    try {
        if (!XeonBotInc.authState.creds.registered) {
            let code = await XeonBotInc.requestPairingCode(phone);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(chalk.green(`[PAIRING WEB] Code généré pour +${phone} : ${code}`));
            return res.json({ code });
        } else {
            return res.json({ error: 'Le bot est déjà lié et connecté.' });
        }
    } catch (err) {
        console.error('Erreur API Pairing:', err);
        return res.status(500).json({ error: 'Échec de génération du code. Vérifiez le numéro.' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(chalk.green(`[✓] Portail Web Revolution MD lancé sur le port ${PORT}`));
});

// Anti-sommeil local (toutes les 2 minutes)
setInterval(() => {
    try { http.get(`http://127.0.0.1:${PORT}/api/ping`, () => {}).on('error', () => {}); } catch (e) {}
}, 2 * 60 * 1000);

// ==========================================
// 🤖 DÉMARRAGE DU SOCKET WHATSAPP
// ==========================================
async function startXeonBotInc() {
    try {
        let { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));
        const { state, saveCreds } = await useMultiFileAuthState(`./session`);
        const msgRetryCounterCache = new NodeCache();

        XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key) => {
                let jid = jidNormalizedUser(key.remoteJid);
                let msg = await store.loadMessage(jid, key.id);
                return msg?.message || "";
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 15000,
        });

        XeonBotInc.ev.on('creds.update', saveCreds);
        store.bind(XeonBotInc.ev);

        // Réception et exécution des commandes via main.js
        XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
            try {
                const mek = chatUpdate.messages[0];
                if (!mek || !mek.message) return;
                
                mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message;
                
                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    await handleStatus(XeonBotInc, chatUpdate);
                    return;
                }
                
                if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;

                if (XeonBotInc?.msgRetryCounterCache) {
                    XeonBotInc.msgRetryCounterCache.clear();
                }

                // Traitement direct des messages
                await handleMessages(XeonBotInc, chatUpdate, true);

            } catch (err) {
                console.error("Erreur dans messages.upsert:", err);
            }
        });

        XeonBotInc.decodeJid = (jid) => {
            if (!jid) return jid;
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {};
                return decode.user && decode.server && decode.user + '@' + decode.server || jid;
            } else return jid;
        };

        XeonBotInc.ev.on('contacts.update', update => {
            for (let contact of update) {
                let id = XeonBotInc.decodeJid(contact.id);
                if (store && store.contacts) store.contacts[id] = { id, name: contact.notify };
            }
        });

        XeonBotInc.getName = (jid, withoutContact = false) => {
            const id = XeonBotInc.decodeJid(jid);
            withoutContact = XeonBotInc.withoutContact || withoutContact;
            let v;
            if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
                v = store.contacts[id] || {};
                if (!(v.name || v.subject)) v = await XeonBotInc.groupMetadata(id).catch(() => ({}));
                resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'));
            });
            else v = id === '0@s.whatsapp.net' ? {
                id,
                name: 'WhatsApp'
            } : id === XeonBotInc.decodeJid(XeonBotInc.user?.id || '') ?
                XeonBotInc.user :
                (store.contacts[id] || {});
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international');
        };

        XeonBotInc.public = true;
        XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store);

        // Gestion de la connexion et reconnexion
        XeonBotInc.ev.on('connection.update', async (s) => {
            const { connection, lastDisconnect } = s;

            if (connection === 'open') {
                console.log(chalk.green(`\n[✓] Revolution MD connecté avec succès à WhatsApp !`));
                
                // Envoi du message d'activation en privé
                setTimeout(async () => {
                    try {
                        const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
                        await XeonBotInc.sendMessage(botNumber, {
                            text: `⚡ *REVOLUTION MD EST OPÉRATIONNEL & CONNECTÉ !* 🧟\n\n👑 *Boss :* Mr Christ X (+50937081286)\n🛠️ *Moteur :* Knight Core (101 commandes prêtes)\n⚡ *Statut :* Actif 24h/24 sans mise en veille.\n\n👉 *Tapez :* .menu ou .help pour afficher toutes les commandes.`
                        });
                    } catch (e) {}
                }, 3000);
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(chalk.red(`Connexion fermée (Status: ${statusCode}). Reconnexion : ${shouldReconnect}`));

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    try {
                        rmSync('./session', { recursive: true, force: true });
                        console.log(chalk.yellow('Dossier session purgé suite à déconnexion.'));
                    } catch (e) {}
                }

                if (shouldReconnect) {
                    setTimeout(startXeonBotInc, 3000);
                }
            }
        });

        XeonBotInc.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(XeonBotInc, update);
        });

        XeonBotInc.ev.on('status.update', async (status) => {
            await handleStatus(XeonBotInc, status);
        });

        return XeonBotInc;

    } catch (error) {
        console.error('Erreur démarrage socket:', error);
        setTimeout(startXeonBotInc, 5000);
    }
}

startXeonBotInc().catch(error => {
    console.error('Erreur fatale:', error);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});
