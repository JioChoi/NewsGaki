const express = require('express');
const fs = require('fs');
const dotenv = require('dotenv');
const pg = require('pg');
dotenv.config();

const { SitemapStream, streamToPromise } = require('sitemap');
const { createGzip } = require('zlib');
const { Readable } = require('stream');

let sitemap;

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

app.get('/goodcomments', async (req, res) => {
	let query = "SELECT * FROM comment WHERE comment != '허접♡' ORDER BY date DESC";
	let response = await queryDB(query, []);

	// only comments
	let buffer = "";

	for (let comment of response.rows) {
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

	fs.readFile(__dirname + '/src/article_server.html', 'utf8', async (err, data) => {
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

		// Load Article
		data = data.replaceAll('${title}', response.rows[0].title);
		data = data.replaceAll('${date}', getDateString(response.rows[0].date));
		data = data.replaceAll('${url}', 'https://newsgaki.com/article/' + response.rows[0].id);
		data = data.replaceAll('${img}', response.rows[0].img);
		data = data.replaceAll('${like_count}', response.rows[0].likes);
		data = data.replaceAll('${dislike_count}', response.rows[0].dislikes);

		let article = response.rows[0].article;
		
		article = article.replaceAll('    ', ' ');
		article = article.replaceAll('   ', ' ');
		article = article.replaceAll('  ', ' ');
		
		article = article.replaceAll('!', '♡');
		article = article.replaceAll('. ', '♡ ');
		article = article.replaceAll('.♡', '♡');
		article = article.replaceAll(' ♡', '♡');
		article = article.replaceAll('♡♡', '♡');
		article = article.replaceAll('♡♡♡', '♡');
		article = article.replaceAll('♡.', '♡');
		article = article.replaceAll('.♡', '♡');
		article = article.replaceAll('허허, ', '');
		data = data.replaceAll('${description}', article.replaceAll('
', ' '));

		article = article.replaceAll('♡', '<span class="hearts" onclick="heart(this)">&#9825;</span>');

		article = article.split('
');
		let content = '';
		for (let line of article) {
			content += `<p>${line}</p>`;
		}

		data = data.replace('${contents}', content);

		res.send(data);
	});
});

app.get('*', function(req, res) {
    res.redirect('/');
});

app.listen(80, () => {
	console.log('Server is running on port 80');

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
			smStream.write({ url: `/article/${article.id}`, changefreq: 'daily', priority: 0.9, lastmod: new Date(Number(article.date)).toISOString()});
		}

		smStream.end();

		// cache the response
		sitemap = await streamToPromise(pipeline);
	} catch (e) {
		console.error(e)
	}
}