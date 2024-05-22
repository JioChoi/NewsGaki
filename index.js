const dotenv = require('dotenv');
const axios = require('axios');
const fs = require('fs');
const {
	GoogleGenerativeAI,
	HarmCategory,
	HarmBlockThreshold,
} = require("@google/generative-ai");
const { JSDOM } = require('jsdom');
const pg = require('pg');
const express = require('express');
const crypto = require('crypto');


dotenv.config();

const app = express();
const port = process.env.PORT || 80;

const MODEL_NAME = "gemini-1.5-flash-latest";
const API_KEY = process.env.GEMINI_API_KEY;

let ids = [8, 38, 33, 17, 49, 327, 23, 318]
let news = [];
let topics = [];

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

// 1500 requests per day.
// 60 requests per hour
// 1 request per minute

// Every ten minutes, crawl news from all sources and get five good topics.
// Every two minutes, publish a news

// --> 6 requests per 10 minutes --> awesome!

app.use('/js', express.static(__dirname + '/src/js'));
app.use('/css', express.static(__dirname + '/src/css'));
app.use('/assets', express.static(__dirname + '/src/assets'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
	if (port == 7860) {
		res.send("Server running on port 7860!");
	}
	else {
		res.sendFile(__dirname + '/src/index.html');
	}
});

app.get('/article', (req, res) => {
	res.sendFile(__dirname + '/src/article.html');
});

app.get('/admin', (req, res) => {
	res.sendFile(__dirname + '/src/admin.html');
});

app.get('/api/article/:id', async (req, res) => {
	let id = req.params.id;
	if (id == undefined || id.length != 10) {
		res.status(400).send("Bad Request");
		return;
	}
	let query = "SELECT * FROM news WHERE id = $1";
	let response = await queryDB(query, [id]);
	if (response.rows.length == 0) {
		res.status(404).send("Not Found");
		return;
	}
	res.send(response.rows[0]);
});

app.post('/api/list', async (req, res) => {
	let start = req.body.start;
	let size = req.body.size;

	if (start == undefined || size == undefined || isNaN(start) || isNaN(size) || start < 0 || size < 0 || size > 20) {
		res.status(400).send("Bad Request");
		return;
	}

	let query = "SELECT * FROM news ORDER BY date DESC OFFSET $1 LIMIT $2";
	let response = await queryDB(query, [start, size]);

	res.send(response.rows);
});

app.post('/api/reportlist', async (req, res) => {
	let start = req.body.start;
	let size = req.body.size;

	if (start == undefined || size == undefined || isNaN(start) || isNaN(size) || start < 0 || size < 0 || size > 20) {
		res.status(400).send("Bad Request");
		return;
	}

	let query = "SELECT * FROM news ORDER BY report DESC OFFSET $1 LIMIT $2";
	let response = await queryDB(query, [start, size]);

	res.send(response.rows);
});

app.post('/api/react', async (req, res) => {
	let id = req.body.id;
	if (id == undefined || id.length != 10) {
		res.status(400).send("Bad Request");
		return;
	}

	let reaction = req.body.reaction;

	if (reaction == "like") {
		let query = "UPDATE news SET likes = likes + 1 WHERE id = $1";
		await queryDB(query, [id]);

		query = "SELECT likes FROM news WHERE id = $1";
		let response = await queryDB(query, [id]);
		res.send(response.rows[0]);
		return;
	}
	else if (reaction == "dislike") {
		let query = "UPDATE news SET dislikes = dislikes + 1 WHERE id = $1";
		await queryDB(query, [id]);

		query = "SELECT dislikes FROM news WHERE id = $1";
		let response = await queryDB(query, [id]);
		res.send(response.rows[0]);
		return;
	}

	res.status(400).send("Bad Request");
});

app.post('/api/comment', async (req, res) => {
	let id = req.body.id;
	let comment = req.body.comment;

	let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
	let name = crypto.createHash('md5').update(ip).digest('hex');
	name = name.slice(0, 8);

	if (id == undefined || id.length != 10 || comment == undefined || comment.length < 1) {
		res.status(400).send("Bad Request");
		return;
	}

	comment = comment.trim();
	if (comment.length > 1000 || comment.length < 1) {
		res.status(400).send("Bad Request");
		return;
	}

	let date = await getKoreanTime();

	let query = "INSERT INTO comment (id, name, comment, date) VALUES ($1, $2, $3, $4)";
	await queryDB(query, [id, name, comment, date]);

	// increment comment
	query = "UPDATE news SET comment = comment + 1 WHERE id = $1";
	await queryDB(query, [id]);

	res.send("Comment added!");
});

app.get('/api/comments/:id', async (req, res) => {
	let id = req.params.id;
	if (id == undefined || id.length != 10) {
		res.status(400).send("Bad Request");
		return;
	}

	let query = "SELECT * FROM comment WHERE id = $1 ORDER BY date ASC";
	let response = await queryDB(query, [id]);
	res.send(response.rows);
});

app.post('/api/report', async (req, res) => {
	let id = req.body.id;
	
	if (id == undefined || id.length != 10) {
		res.status(400).send("Bad Request");
		return;
	}

	let query = "UPDATE news SET report = report + 1 WHERE id = $1";
	await queryDB(query, [id]);

	res.send("Reported!");
});

app.post('/api/delete', async (req, res) => {
	let id = req.body.id;
	let pw = req.body.pw;

	if (id == undefined || pw == undefined) {
		res.status(400).send("Bad Request");
		return;
	}

	if (id != process.env.ADMIN_ID || pw != process.env.ADMIN_PW) {
		res.status(401).send("Unauthorized");
		return;
	}

	let aid = req.body.aid;
	if (aid == undefined || aid.length != 10) {
		res.status(400).send("Bad Request");
		return;
	}

	let query = "DELETE FROM news WHERE id = $1";
	await queryDB(query, [aid]);

	res.send("Deleted!");
});

app.listen(port, async () => {
	console.log(`Server running on port ${port}`);

	if (process.argv[2] != "dev") {
		start();
	}
	else {
		console.log("Development mode enabled. Automation will not start.");
	}
});

async function start() {
	console.log("Starting automation...");
	await getNewTopics();

	setIntervalAndExecute(async () => {
		console.log("Target: " + topics[0].title);
		await generateArticle(topics[0].url);
		console.log("Finished one article!");
		topics.shift();
		if (topics.length == 0) {
			console.log("Getting new topics...");
			await getNewTopics();
		}
	}, 60000 * 3);
}

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

async function generateArticle(url) {
	console.log("Crawling article...");
	let article = await getNewsArticle(url);

	console.log("Running Gemini... #1");
	let prompt = [
		{text: `input: You are a mesugaki news reporter who rewrites the korean news article provided.\n\n\"mesugaki\" is a typical depiction of a mischievous, ill-behaved child or young girl character with foul mouth, in japanese manga and anime. Mesugaki disdains and mocks male adult, including the objects in the news article. It often implies lewd context.\n\n'허접♡' 이라는 단어를 문장에 적극적으로 많이 이용해 봐. 내용을 길고 자세하게 써. 각 문단에 다섯 문장 이상을 포함해. 세 문단 이상을 써. 첫 문단은 제목이야. 제목은 너무 길지 않게.\n\n한국어로 말하는 거야. 매도해. 비꼬는 말투가 중요해. "쓰레기♡", "바보♡" 같은 단어들을 적극적으로 잘 이용해봐. ♡ 를 꼭 각 문장 끝에 붙여. 존댓말을 쓰지 마. 기사 내용을 포함해. \n\n아래 뉴스 내용에 관해서 글을 써줘.\n\n${article}`},
		{text: "output: "},
	]
	let response = await gemini(prompt);

	if (response == null) {
		console.log("Gemini returned null. Skipping article.");
		return;
	}

	console.log("Running Gemini... #2");
	
	prompt = [
		{text: `Give me an "english" word to find images related to this news. Only give me the word.\n${article}`},
		{text: "output: "},
	];
	
	let img_prompt = await gemini(prompt);

	if (img_prompt == null) {
		console.log("Gemini returned null. Skipping article.");
		return;
	}

	let img = await getPhoto(img_prompt);

	response = response.split('\n');
	response = response.filter(item => item.length > 1);

	let title = response[0];
	title = title.replaceAll('#', '');
	title = title.replaceAll('*', '');
	title = title.trim();

	response = response.slice(1);
	let data = response.join('\n');
	data = data.replaceAll('#', '');
	data = data.replaceAll('*', '');
	data = data.trim();

	let date = await getKoreanTime();
	let id = getID(date);

	console.log("Querying DB...");

	let query = "INSERT INTO news (id, date, title, article, img) VALUES ($1, $2, $3, $4, $5)";
	let res = await queryDB(query, [id, date, title, data, img]);

	console.log(id);
	console.log(title);

	console.log("Uploaded to DB!");
}

async function getKoreanTime() {
	const config = {
		method: 'get',
		url: "https://worldtimeapi.org/api/timezone/Asia/Seoul"
	};

	let response = await axios(config);
	let time = Number(response.data.unixtime);
	return time * 1000;
}

function getArticleKoreanTime() {
	const curr = new Date();
	const utc = curr.getTime() + (curr.getTimezoneOffset() * 60 * 1000);
	const KR_TIME_DIFF = 9 * 60 * 60 * 1000;

	return utc + (KR_TIME_DIFF)
}

function getID(time) {
	let date = new Date(time);
	let year = date.getFullYear();
	let month = date.getMonth() + 1;
	let day = date.getDate();
	let hours = date.getHours();
	let minutes = date.getMinutes();
	let seconds = date.getSeconds();

	year = year.toString().slice(2);
	month = ("0" + month).slice(-2);
	day = ("0" + day).slice(-2);
	hours = ("0" + hours).slice(-2);
	minutes = ("0" + minutes).slice(-2);
	seconds = ("0" + seconds).slice(-2);

	let id = `${year}${month}${day}${hours}${minutes}${seconds}`;
	return Number(id).toString(16);
}

async function removeOldTopics(min) {
	let limit = await getKoreanTime() - min * 60000;
	for (let i = 0; i < news.length; i++) {
		if (news[i].date < limit) {
			news.splice(i, 1);
			i--;
		}
	}
}

async function getNewTopics() {
	try {
		console.log("Getting all articles...");
		let newsStr = await getAllNews();

		if (newsStr == "") {
			// Wait for 10 minutes
			console.log("No news found. Retrying in 10 minutes...");
			await delay(600000);
			await getNewTopics();
			return;
		}

		console.log("Running Gemini...");
		let prompt = [
			{text: `이 중에 화제가 될 만한 기사들을 말 해줘. 숫자만 한 줄로 말해줘. 같은 주제의 뉴스 기사는 겹치지 않게 꼭 제외해줘. 특정 인물이나 정당, 그룹에 관련된 기사도 제외해줘. 정치와 관련된 기사는 고르지 마.\n${newsStr}`},
			{text: "output: "},
		];
		let response = await gemini(prompt);

		if (response == null) {
			throw new Error("Gemini returned null.");
		}
	
		console.log("Processing Results...");
		// if (!response.includes(',')) {
		// 	throw new Error("Gemini did not return a valid response.");
		// }
		response = response.split(',');
		response = response.map(item => parseInt(item));
		
		console.log(`${response.length} new topics found!`);
		
		topics = [];
		for (let i of response) {
			topics.push(news[i]);
		}

		console.log(topics);

		console.log("Finished getting new topics!");
	} catch (e) {
		console.log("Error in getNewTopics()");
		console.log(e);
		console.log("Retrying...");
		await delay(30000);
		await getNewTopics();
	}
}

async function getNewsArticle(url) {
	const config = {
		method: 'get',
		url: url,
	};

	let response = await axios(config);
	let dom = new JSDOM(response.data);
	let article = dom.window.document.querySelector('.news_view');
	let contents = article.querySelectorAll('p');

	let data = "";
	for (let i = 0; i < contents.length - 2; i++) {
		data += contents[i].textContent + "\n";
	}

	return data;
}

async function getAllNews() {
	news = [];

	for (let id of ids) {
		await getNews(id);
	}

	await removeOldTopics(10);

	if (news.length < 5) {
		return "";
	}

	// randomize order
	news.sort(() => Math.random() - 0.5);

	// Remove chosen topics
	for (let topic of topics) {
		let index = news.findIndex(item => item.title == topic.title);
		if (index > -1) {
			news.splice(index, 1);
		}
	}

	let str = "";
	for (let i = 0; i < news.length; i++) {
		let item = news[i];
		str += `${i}. ${item.title}\n`;
	}

	return str;
}

async function getNews(id) {
	let data = JSON.stringify({
		"operationName": null,
		"variables": {
		  "media_home_tab_news_all_8Key": "media_home_news_all",
		  "media_home_tab_news_all_8Params": {
			"cpId": id.toString(),
			"size": 5,
			"sort": "createDt:desc",
			"searchId": ""
		  }
		},
		"query": "query ($media_home_tab_news_all_8Key: String!, $media_home_tab_news_all_8Params: Object) {\n  media_home_tab_news_all_8: page(charonKey: $media_home_tab_news_all_8Key, charonParams: $media_home_tab_news_all_8Params) {\n      items {\n      title\n      thumbnail\n      pcLink\n      meta\n      __typename\n    }\n    __typename\n  }\n}\n"
	  });
	  
	let config = {
		method: 'post',
		maxBodyLength: Infinity,
		url: 'https://hades-cerberus.v.kakao.com/graphql',
		headers: { 
		  'Content-Type': 'application/json'
		},
		data : data
	};

	let response = await axios(config);
	let items = response.data.data.media_home_tab_news_all_8.items;

	items.forEach(item => {
		news.push({
			title: item.title,
			url: item.pcLink,
			date: item.meta.createDt
		});
	});
}

// getPhoto("aliexpress");

async function getPhoto(keyword) {
	const config = {
		method: 'get',
		url: `https://unsplash.com/napi/search/photos?query=${keyword}&per_page=1`,
	};

	let response = await axios(config);
	let photo = response.data.results[0].urls.regular;
	return photo;
}

async function gemini(prompt, retry = 0) {
	if (retry > 3) {
		return null;
	}

	try {
		const genAI = new GoogleGenerativeAI(API_KEY);
		const model = genAI.getGenerativeModel({ model: MODEL_NAME });

		const generationConfig = {
			temperature: 1,
			topK: 64,
			topP: 0.95,
			maxOutputTokens: 8192,
		};

		const safetySettings = [
			{
				category: HarmCategory.HARM_CATEGORY_HARASSMENT,
				threshold: HarmBlockThreshold.BLOCK_NONE,
			},
			{
				category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
				threshold: HarmBlockThreshold.BLOCK_NONE,
			},
			{
				category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
				threshold: HarmBlockThreshold.BLOCK_NONE,
			},
			{
				category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
				threshold: HarmBlockThreshold.BLOCK_NONE,
			}
		];

		const parts = prompt;

		const result = await model.generateContent({
			contents: [{ role: "user", parts }],
			generationConfig,
			safetySettings,
		});

		const response = result.response;
		return response.text();
	} catch (e) {
		console.log("Error in gemini()");
		console.log(e);
		return null;
	}
}

async function delay(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}