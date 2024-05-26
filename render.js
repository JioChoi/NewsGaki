const express = require('express');
const fs = require('fs');
const dotenv = require('dotenv');
const pg = require('pg');
dotenv.config();

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

app.get('/article/:id', async (req, res) => {
	if(!req.params.id || req.params.id.length != 10) {
		res.send('Invalid ID');
		return;
	}

	fs.readFile(__dirname + '/src/article_test.html', 'utf8', async (err, data) => {
		if (err) {
			console.log(err);
			res.send('Error');
		}

		let query = 'SELECT * FROM news WHERE id = $1';
		let response = await queryDB(query, [req.params.id]);
		if (!response || response.rows.length == 0) {
			res.send('Invalid ID');
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
		article += '\n';
		
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
		
		let content = "";
		let buffer = "";
		for (let i = 0; i < article.length; i++) {
			let char = article[i];

			if (char == '\n' && buffer.length > 1) {
				content += '<p>' + buffer + '</p>\n';
				buffer = "";
			}

			if (char != '\n') {
				if (char == '♡') {
					buffer += '<span class="hearts" onclick="heart(this)">&#9825;</span>';
				}
				else {
					buffer += char;
				}
			}
		}

		data = data.replace('${contents}', content);

		res.send(data);
	});
});

app.listen(80, () => {
	console.log('Server is running on port 80');
});

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