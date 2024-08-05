const dotenv = require('dotenv');
const fs = require('fs');
const crypto = require('crypto');

dotenv.config();

const date = "2024-08-01";
const daily = 1;

const key = process.env.DAILY_KEY;
const iv = process.env.DAILY_IV;
const garbage = process.env.DAILY_GARBAGE;

const data = "iWXKPZtgCcvpiZCHWRgh4LS/ZWNZy1NGKcrpIpyWKfxVdwk7JAVZW4IGAIdp2CuhW8F0wDNNQFPbrHcT1x15R+AZ73y8NZJpk4H0MoFz8tk=";
let decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
let decrypted = decipher.update(data, 'base64', 'utf8');
decrypted += decipher.final('utf8');

console.log(decrypted);