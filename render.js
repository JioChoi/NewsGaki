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
	console.log(req.params.id);
	if(!req.params.id || req.params.id.length != 10) {
		res.send('Invalid ID');
		return;
	}

	fs.readFile(__dirname + '/src/article_test.html', 'utf8', (err, data) => {
		if (err) {
			console.log(err);
			res.send('Error');
		}

		// Load Article

		res.send(data);
	});
});

app.listen(80, () => {
	console.log('Server is running on port 80');
});

module.exports = app;