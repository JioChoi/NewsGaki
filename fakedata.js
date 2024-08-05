const dotenv = require('dotenv');
const fs = require('fs');
const crypto = require('crypto');

dotenv.config();

const date = "2024-08-01";
const daily = 1;

const key = process.env.DAILY_KEY;
const iv = process.env.DAILY_IV;
const garbage = process.env.DAILY_GARBAGE;

let data = { date: date, today: daily, garbage: garbage }
data = JSON.stringify(data);

let cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
let encrypted = cipher.update(data, 'utf8', 'base64');
encrypted += cipher.final('base64');

console.log(encrypted);