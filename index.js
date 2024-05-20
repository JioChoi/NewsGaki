// TODO:HIDE PROMPT!!

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
const { get } = require('http');
const express = require('express');

dotenv.config();

const app = express();
const port = process.env.PORT || 80;

const MODEL_NAME = "gemini-1.5-pro-latest";
const API_KEY = process.env.GEMINI_API_KEY;

let ids = [73, 327, 310, 11, 45, 190, 15, 33, 38, 200, 8, 17, 49, 23, 396, 318, 98, 60, 317]
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
	res.sendFile(__dirname + '/src/index.html');
});

app.get('/article/:id', (req, res) => {
	res.sendFile(__dirname + '/src/article.html');
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

app.listen(port, () => {
	console.log(`Server running on port ${port}`);
	start();
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
	}, 270000);
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

	console.log("Running Gemini...");
	let prompt = `너는 이제부터 뉴스가키라는 메스가키 뉴스 기자가 될거야. 말에 "허접♡" 를 붙이는 걸 좋아하고 "♡" 를 꼭 말 끝에 붙여. 비꼬는 말투가 중요해. 반말을 써. 법에 위배되거나 고소당할만한 말은 하지마. 뉴스 기사의 형식대로 글을 써. 특정 인물의 이름은 절대 언급하지 마. Markdown 을 사용하지 마. 첫 문장은 제목이야. 두번째 문장은 이미지 검색에 사용할 이미지 키워드 한 단어를 영어로 써줘 단 이 부분에는 말 끝에 하트를 안 붙여도 돼. 한 문단에 세 문장 이상은 무조건 포함해. 무조건 세 문단 이상 써. 기사 내용을 꼭 포함해. \n이건 메스가키가 하는 대사의 예시들이야.\n- 허접 식물♡ 할 줄 아는건 광합성 뿐♡\n- 사과해♡ 사과해♡\n- 쓰레기♡\n- 바보♡\n- 허접♡ 무슨 말을 하고 싶은거야?♡\n아래 뉴스기사를 참고해서 뉴스 기사를 써줘.${article}`;
	let response = await gemini(prompt);

	response = response.split('\n');
	response = response.filter(item => item.length > 1);

	let title = response[0];
	title = title.replaceAll('#', '');
	title = title.trim();

	let imageKeyword = response[1];
	imageKeyword = imageKeyword.replaceAll('#', '');
	imageKeyword = imageKeyword.trim();

	let image = await getPhoto(imageKeyword);

	response = response.slice(2);
	let data = response.join('\n');

	let date = getKoreanTime();
	let id = getID(date);

	console.log("Querying DB...");

	let query = "INSERT INTO news (id, date, title, article, img) VALUES ($1, $2, $3, $4, $5)";
	await queryDB(query, [id, date, title, data, image]);
	console.log("Uploaded to DB!");
}

function getKoreanTime() {
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

async function getNewTopics() {
	try {
		console.log("Getting all articles...");
		let newsStr = await getAllNews();

		console.log("Running Gemini...");
		let prompt = `이 중에 화제가 될 만한 기사들을 말 해줘. 숫자만 한 줄로 말해줘. 같은 주제의 뉴스 기사는 제외해줘. 특정 인물이나 정당, 그룹에 관련된 기사도 제외해줘.\n${newsStr}`;
		let response = await gemini(prompt);
	
		console.log("Processing Results...");
		if (!response.includes(',')) {
			throw new Error("Gemini did not return a valid response.");
		}
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

async function gemini(prompt) {
	try {
		const genAI = new GoogleGenerativeAI(API_KEY);
		const model = genAI.getGenerativeModel({ model: MODEL_NAME });

		const generationConfig = {
			temperature: 0.85,
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
			},
		];

		const parts = [
			{text: `input: ${prompt}`},
			{text: "output: "},
		];

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
		await gemini(prompt);
	}
}