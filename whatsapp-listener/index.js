const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ── CONFIG ──
const TARGET_GROUP_NAME = 'WatchFacts';  // Will match any group containing this
const API_ENDPOINT = 'https://watchfacts-poc.vercel.app/api/ingest';
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const IMAGE_DIR = './downloaded_images';

// Ensure image dir exists
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

// ── WATCH PARSER ──
function parseWatchData(text) {
    const result = {
        rawMessage: text,
        reference: null,
        brand: null,
        dialColor: null,
        price: null,
        currency: null,
        condition: null,
        year: null,
        confidence: 0,
    };

    // Reference patterns - ordered by specificity
    const refPatterns = [
        /\bRM\d{2}-\d{2}\w?\b/gi,
        /\b\d{4,6}[A-Z]?[/\-]\d{1,4}[A-Z]{0,2}-\d{2,3}\b/gi,
        /\b\d{4,6}[A-Z]?\/\d{1,4}[A-Z]{0,2}\b/gi,
        /\b\d{4,6}[A-Z]-\d{3}\b/gi,
        /\b\d{4,6}[A-Z]{1,2}\b/gi,
        /\b\d{5,6}\b/g,
    ];

    const yearPattern = /^20\d{2}Y?$|^19\d{2}Y?$/i;
    const badPatterns = [/^\d{4}\/\d{1,2}$/, /^\d{1,2}\/\d{4}$/, /^202\d\d{4}$/];

    let allRefs = [];
    for (const pattern of refPatterns) {
        const matches = text.match(pattern) || [];
        for (const m of matches) {
            const clean = m.toUpperCase().trim();
            if (yearPattern.test(clean)) continue;
            if (badPatterns.some(p => p.test(clean))) continue;
            if (/^\d{3,5}$/.test(clean) && clean.length <= 4) continue;
            allRefs.push(clean);
        }
    }

    if (allRefs.length > 0) {
        // Prefer complex refs
        const complex = allRefs.filter(r => r.includes('/') || r.includes('-'));
        result.reference = complex.length > 0 
            ? complex.reduce((a, b) => a.length >= b.length ? a : b)
            : allRefs.reduce((a, b) => a.length >= b.length ? a : b);
    }

    // Brand inference
    const textUpper = text.toUpperCase();
    if (textUpper.includes('PATEK') || textUpper.includes('PHILIPPE') || textUpper.includes('NAUTILUS') || textUpper.includes('AQUANAUT')) {
        result.brand = 'Patek Philippe';
    } else if (textUpper.includes('AUDEMARS') || textUpper.includes('ROYAL OAK')) {
        result.brand = 'Audemars Piguet';
    } else if (textUpper.includes('ROLEX')) {
        result.brand = 'Rolex';
    } else if (textUpper.includes('RICHARD MILLE') || /\bRM\d/.test(text)) {
        result.brand = 'Richard Mille';
    } else if (result.reference) {
        const ref = result.reference;
        if (/^57|^59|^52|^49|^51|^50/.test(ref)) result.brand = 'Patek Philippe';
        else if (/^15|^16|^12|^11|^22|^228|^116/.test(ref)) result.brand = 'Rolex';
        else if (/^26/.test(ref)) result.brand = 'Audemars Piguet';
    }

    // Dial color from suffix
    if (result.reference) {
        const suffixPart = result.reference.includes('/') 
            ? result.reference.split('/').pop() 
            : result.reference.split('-').pop();
        const dialMap = {
            'LN': 'BLACK', 'LB': 'BLUE', 'LV': 'GREEN', 'CHNR': 'BROWN',
            'R': 'BROWN', 'G': 'BLUE', 'J': 'CHAMPAGNE', 'P': 'BLUE',
            'ST': 'BLUE', 'OR': 'PINK', 'TI': 'GREY', 'BC': 'BLACK',
            'CH': 'CHOCOLATE', 'BLNR': 'BLACK/BLUE', 'VTNR': 'GREEN/BLACK',
            'A': 'BLACK', 'TBR': 'TURQUOISE', 'TR': 'RED',
        };
        for (const [suffix, color] of Object.entries(dialMap)) {
            if (suffixPart.includes(suffix)) {
                result.dialColor = color;
                break;
            }
        }
    }

    // Price parsing
    const priceMatch = text.match(/(\d+\.?\d*)\s*([kKmM]?)\s*(HKD|USD|USDT|EUR)?/i);
    if (priceMatch) {
        let val = parseFloat(priceMatch[1]);
        const mult = priceMatch[2].toLowerCase();
        const curr = (priceMatch[3] || '').toUpperCase();
        if (mult === 'k') val *= 1000;
        if (mult === 'm') val *= 1000000;
        result.price = val;
        result.currency = curr || 'HKD';
    }

    // Condition
    if (/\b(New|Unused|BNIB|Brand New|全新|全套)\b/i.test(text)) {
        result.condition = 'New';
    } else if (/\b(Used|Pre[- ]?owned|二手|裸)\b/i.test(text)) {
        result.condition = 'Used';
    }

    // Year
    const yearMatch = text.match(/\b(20\d{2})[Yy年]?\b/);
    if (yearMatch) result.year = parseInt(yearMatch[1]);

    // Confidence scoring
    let score = 0;
    if (result.reference) score += 30;
    if (result.brand) score += 20;
    if (result.dialColor) score += 15;
    if (result.price) score += 20;
    if (result.condition) score += 15;
    result.confidence = score;

    return result;
}

// ── MULTI-WATCH SPLITTER ──
function splitMultiWatchMessage(text) {
    // Split by common watch separators
    const separators = /(?=\d{4,6}[A-Z]?[/\-]\d|[🏮🎉⚠️🔴🟡🟢🔵⭕]|\n(?=\d{4,6}))/g;
    const parts = text.split(separators).filter(p => p.trim().length > 5);
    
    if (parts.length <= 1) return [text];
    
    // Validate each part has a reference
    return parts.filter(p => /\d{4,6}/.test(p));
}

// ── SEND TO API ──
async function sendToAPI(record) {
    try {
        const response = await axios.post(API_ENDPOINT, record, {
            timeout: 10000,
            headers: { 'Content-Type': 'application/json' }
        });
        console.log(`✅ Sent: ${record.reference || 'N/A'} | Status: ${response.status}`);
        return true;
    } catch (err) {
        console.error(`❌ Failed to send: ${err.message}`);
        // Save locally if API fails
        const fallbackFile = path.join(IMAGE_DIR, `../failed_${Date.now()}.json`);
        fs.writeFileSync(fallbackFile, JSON.stringify(record, null, 2));
        return false;
    }
}

// ── MAIN WHATSAPP CONNECTION ──
async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: {
            level: 'silent',
            info: () => {}, debug: () => {}, error: () => {}, warn: () => {},
            trace: () => {}, fatal: () => {}, child: () => ({ level: 'silent', info: () => {}, debug: () => {}, error: () => {}, warn: () => {}, trace: () => {}, fatal: () => {}, child: () => ({}) }),
        },
        printQRInTerminal: false,
        auth: state,
        browser: ['WatchFacts Bot', 'Chrome', '1.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n═══ SCAN THIS QR CODE WITH YOUR PHONE ═══');
            qrcode.generate(qr, { small: true });
            console.log('Open WhatsApp → Settings → Linked Devices → Link a Device\n');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Connection closed. Reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) startWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ Connected to WhatsApp!');
            console.log('Listening for messages...\n');
        }
    });

    // ── MESSAGE HANDLER ──
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        if (!message || message.key.fromMe) return;

        // Only process group messages containing our target
        const chatId = message.key.remoteJid;
        if (!chatId.endsWith('@g.us')) return;

        // Get group metadata to check name
        try {
            const metadata = await sock.groupMetadata(chatId);
            if (!metadata.subject.toLowerCase().includes(TARGET_GROUP_NAME.toLowerCase())) {
                return;
            }
            console.log(`\n📎 Group: ${metadata.subject}`);
        } catch (e) {
            return;
        }

        // Extract text
        let text = message.message?.conversation 
            || message.message?.extendedTextMessage?.text 
            || message.message?.imageMessage?.caption 
            || '';
        
        if (!text) return;

        console.log(`💬 ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);

        // Split multi-watch messages
        const watchParts = splitMultiWatchMessage(text);
        console.log(`   → Detected ${watchParts.length} watch listing(s)`);

        for (let i = 0; i < watchParts.length; i++) {
            const part = watchParts[i];
            const parsed = parseWatchData(part);

            // Handle image if present (only for first watch in message, or if multiple images)
            if (message.message?.imageMessage && i === 0) {
                try {
                    const buffer = await downloadMediaMessage(message, 'buffer', {}, { 
                        logger: { info: () => {}, debug: () => {}, error: console.error, warn: () => {}, trace: () => {}, child: () => ({}) } 
                    });
                    if (buffer) {
                        const imagePath = path.join(IMAGE_DIR, `${Date.now()}.jpg`);
                        fs.writeFileSync(imagePath, buffer);
                        parsed.imagePath = imagePath;
                        console.log(`   🖼️ Image saved: ${imagePath}`);
                    }
                } catch (err) {
                    console.error('   Image download failed:', err.message);
                }
            }

            // Send to API
            await sendToAPI(parsed);
        }
    });
}

// Start
console.log('🚀 WatchFacts WhatsApp Listener Starting...');
console.log('This will connect to WhatsApp Web and listen for messages.\n');
startWhatsApp().catch(console.error);
