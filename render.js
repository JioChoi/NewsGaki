const express = require('express');
const fs = require('fs');
const dotenv = require('dotenv');
const pg = require('pg');
dotenv.config();

const { SitemapStream, streamToPromise } = require('sitemap');
const { createGzip } = require('zlib');
const { Readable } = require('stream');

const crypto = require('crypto');
const { type } = require('os');

let sitemap;
let maxDaily = 0;

let articleLog = [];

const client = new pg.Pool({
	user: process.env.DB_USER,
	host: process.env.DB_HOST,
	database: process.env.DB_NAME,
	password: process.env.DB_PASS,
	port: process.env.DB_PORT,
	max: 5,
	dialect: "postgres",
    ssl: {
		require: true,
		rejectUnauthorized: false
    }
});

client.connect(err => {
	if (err) {
		console.error('connection error', err.stack)
	} else {
		console.log('connected')
	}
});

const app = express();

app.use('/js', express.static(__dirname + '/src/js'));
app.use('/css', express.static(__dirname + '/src/css'));
app.use('/assets', express.static(__dirname + '/src/assets'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => {
	res.sendFile(__dirname + '/src/index.html');
});

app.get('/test', (req, res) => {
	res.sendFile(__dirname + '/src/test.html');
});

const key = process.env.DAILY_KEY;
const iv = process.env.DAILY_IV;
const garbage = process.env.DAILY_GARBAGE;

let speech = [];

app.post('/daily', async (req, res) => {
	let date = new Date().toLocaleDateString('ja-jp');
	let data = req.body.data;

	if(data == undefined) {
		res.send('{}');
		return;
	}

	if (data == '') {
		let encrypted = encode({ date: date, today: 0, garbage: garbage });
		let text = speech[0];

		res.send({ encrypted: encrypted, text: text, day: 0, newdata: true });
		return;
	}

	let decrypted = decode(data);

	if (decrypted.date == undefined) {
		res.send('{}');
		return;
	}

	if (decrypted.date != date) {
		if (new Date(decrypted.date) < new Date(date)) {
			decrypted.today++;
			decrypted.date = date;
			decrypted.garbage = garbage;

			let encrypted = encode(decrypted);
			let text = speech[decrypted.today];

			if(maxDaily < decrypted.today) {
				maxDaily = decrypted.today;
			}

			res.send({ encrypted: encrypted, text: text, day: decrypted.today, newdata: true });
			return;
		}
	}
	else {
		let text = speech[decrypted.today];

		res.send({ encrypted: data, text: text, day: decrypted.today });
		return;
	}

	res.send('{}');
});

app.get('/sitemap', async (req, res) => {
	res.header('Content-Type', 'application/xml');
	res.header('Content-Encoding', 'gzip');

	if (sitemap) {
		res.send(sitemap);
		return;
	}
});

app.get('/admin', (req, res) => {
	res.sendFile(__dirname + '/src/admin.html');
});

app.get('/allcomments', async (req, res) => {
	let query = "SELECT * FROM comment ORDER BY date DESC";
	let response = await queryDB(query, []);

	res.send(response.rows);
});

app.get('/maxdaily', (req, res) => {
	res.send({ max: maxDaily });
});

app.get('/goodcomments', async (req, res) => {
	let query = "SELECT * FROM comment WHERE automated = false ORDER BY date DESC LIMIT 50";
	let response = await queryDB(query, []);

	// only comments
	let buffer = "";

	for (let comment of response.rows) {
		let diff = Date.now() - comment.date;
		let text = "";

		if (diff < 1000 * 60) {
			text = Math.floor(diff / 1000) + "초 전";
		}
		else if (diff < 1000 * 60 * 60) {
			text = Math.floor(diff / (1000 * 60)) + "분 전";
		}
		else if (diff < 1000 * 60 * 60 * 24) {
			text = Math.floor(diff / (1000 * 60 * 60)) + "시간 전";
		}
		else {
			text = Math.floor(diff / (1000 * 60 * 60 * 24)) + "일 전";
		}

		buffer += `<p>${text}</p>`;
		buffer += `<a href="/article/${comment.id}">${comment.comment}</a><br><br>`;
	}

	res.send(buffer);
});

// Route old article links
app.get('/article', async (req, res) => {
	if (!req.query.id || req.query.id.length != 10) {
		res.redirect('/');
	}
	else {
		res.redirect(`/article/${req.query.id}`);
	}
});

app.get('/article/:id', async (req, res) => {
	if (!req.params.id || req.params.id.length != 10) {
		res.redirect('/');
		return;
	}

	fs.readFile(__dirname + '/src/article.html', 'utf8', async (err, data) => {
		if (err) {
			console.log(err);
			res.send('Error');
		}

		let query = 'SELECT * FROM news WHERE id = $1';
		let response = await queryDB(query, [req.params.id]);
		if (!response || response.rows.length == 0) {
			res.redirect('/');
			return;
		}

		let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
		let name = crypto.createHash('md5').update(ip).digest('hex');
		name = name.slice(0, 8);
		
		if (!articleLog.includes(`${name}|${req.params.id}`)) {
			articleLog.push(`${name}|${req.params.id}`);
			await queryDB("UPDATE news SET view = view + 1 WHERE id = $1", [req.params.id]);
	
			if (articleLog.length > 1000) {
				articleLog.shift();
			}
		}

		// Load Article
		let title = response.rows[0].title;

		// Remove weird formattings from title
		if (title.split(':').length > 1) {
			title = title.split(':')[1];
		}
		title = title.replaceAll('*', '');

		// Remove weird formattings from article
		let image = response.rows[0].img;
		let multiimage = false;
		try {
			image = JSON.parse(image);
			data = data.replaceAll('${img}', image[0]);
			multiimage = true;
		} catch (e) {
			image = image.replaceAll('{', '');
			image = image.replaceAll('}', '');
			image = image.replaceAll('"', '');
			data = data.replaceAll('${img}', image);
		}

		data = data.replaceAll('${title}', title);
		data = data.replaceAll('${date}', response.rows[0].date);
		data = data.replaceAll('${url}', 'https://newsgaki.com/article/' + response.rows[0].id);
		data = data.replaceAll('${like_count}', response.rows[0].likes);
		data = data.replaceAll('${dislike_count}', response.rows[0].dislikes);

		// Remove weird formattings from article
		let article = response.rows[0].article;
		if (article.split(':').length > 1) {
			article = article.split(':')[1];
		}

		// Remove weird characters
		article = article.trim();
		article = article.replaceAll('  ', ' ');
		article = article.replaceAll('   ', ' ');
		article = article.replaceAll('    ', ' ');

		data = data.replaceAll('${description}', article.replaceAll('\n', ' ').replaceAll('*', ''));

		article = article.replaceAll('♡', '<span class="hearts" onclick="heart(this)">&#9825;</span>');

		article = article.split('\n');
		let content = '';

		let headline = 0;
		let imageIndex = 1;

		for (let line of article) {
			if(line[0] == '*') {
				headline++;

				if (headline % 2 == 0 && imageIndex < image.length && multiimage) {
					content += `<img src="${image[imageIndex]}" style="margin-top:50px">\n<h4>(기사 속 사건과 관련 없음)</h4>`;
					imageIndex++;
				}

				content += `<h6>${line.replaceAll('*', '')}</h6>`;
			}
			else {
				content += `<p>${line}</p>`;
			}
		}

		data = data.replace('${contents}', content);

		res.send(data);
	});
});

app.get('*', function(req, res) {
    res.redirect('/');
});

app.listen(80, async () => {
	process.env.TZ = 'Asia/Seoul';

	console.log('Server is running on port 80');

	await initSpeech();
	console.log(speech.length);

	setIntervalAndExecute(async () => {
		await createSitemap();
	}, 60000 * 10);
});

function setIntervalAndExecute(fn, t) {
    fn();
    return(setInterval(fn, t));
}

async function queryDB(query, params) {
	try {
		let response = await client.query(query, params);
		return response;
	} catch (e) {
		console.log("Error in queryDB()");
		console.log(e);
	}
}


function getDateString(time) {
	let date = new Date(Number(time));

	let year = date.getFullYear();
	let month = date.getMonth() + 1;
	let day = date.getDate();
	let hours = date.getHours();
	let minutes = date.getMinutes();
	let seconds = date.getSeconds();

	month = ("0" + month).slice(-2);
	day = ("0" + day).slice(-2);
	hours = ("0" + hours).slice(-2);
	minutes = ("0" + minutes).slice(-2);
	seconds = ("0" + seconds).slice(-2);

	return `${year}.${month}.${day} ${hours}:${minutes}:${seconds}`;
}

async function createSitemap() {
	try {
		const smStream = new SitemapStream({ hostname: 'https://newsgaki.com/', xlmns: { news: true, image: true } });
		const pipeline = smStream.pipe(createGzip());

		// pipe your entries or directly write them.
		smStream.write({ url: '/', changefreq: 'daily', priority: 1 });

		// Get all articles id and date
		let query = "SELECT id, date FROM news ORDER BY date DESC";
		let response = await queryDB(query, []);
		let articles = response.rows;

		for (let article of articles) {
			smStream.write({ url: `/article/${article.id}`, changefreq: 'daily', priority: 0.7, lastmod: new Date(Number(article.date)).toISOString()});
		}

		smStream.end();

		// cache the response
		sitemap = await streamToPromise(pipeline);
	} catch (e) {
		console.error(e)
	}
}

function encode(data) {
	data = JSON.stringify(data);

	let cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
	let encrypted = cipher.update(data, 'utf8', 'base64');
	encrypted += cipher.final('base64');

	return encrypted;
}

function decode(data) {
	try {
		let decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
		let decrypted = decipher.update(data, 'base64', 'utf8');
		decrypted += decipher.final('utf8');
	
		decrypted = JSON.parse(decrypted);
	
		return decrypted;
	} catch (e) {
		return {};
	}
}

function initSpeech() {
	let data = fs.readFileSync(__dirname + '/src/speech.dat', 'utf8');

	speech = decode(data);
	speech = speech.data;
}

process.on('uncaughtException', function(err) {
	console.log('Caught exception: ' + err);
});