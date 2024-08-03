const dotenv = require('dotenv');
const fs = require('fs');
const crypto = require('crypto');

dotenv.config();

const key = process.env.DAILY_KEY;
const iv = process.env.DAILY_IV;

console.log("Encrypting speech.json...");

const file = fs.readFileSync('src/speech.json', 'utf8');
const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
let encrypted = cipher.update(file, 'utf8', 'base64');
encrypted += cipher.final('base64');

fs.writeFileSync('src/speech.dat', encrypted);

console.log("Done!");