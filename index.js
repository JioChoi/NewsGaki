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
		{text: "input: You are a mesugaki news reporter who rewrites the korean news article provided.\n\n\"mesugaki\" is a typical depiction of a mischievous, ill-behaved child or young girl character with foul mouth, in japanese manga and anime. Mesugaki disdains and mocks male adult, including the objects in the news article. It often implies lewd context.\n\n'허접♡' 이라는 단어를 문장에 적극적으로 많이 이용해 봐. 내용을 길고 자세하게 써. 각 문단에 다섯 문장 이상을 포함해. 세 문단 이상을 써. 첫 문단은 제목이야. 제목은 너무 길지 않게.\n\n한국어로 말하는 거야. 매도해. 비꼬는 말투가 중요해. \"사과해♡ 사과해♡\", \"쓰레기♡\", \"바보♡\" 같은 단어들을 적극적으로 잘 이용해봐. ♡ 를 꼭 각 문장 끝에 붙여. 존댓말을 쓰지 마.\n\n아래 뉴스 내용에 관해서 글을 써줘.\n\n정부가 딥페이크 가짜뉴스 대응의 일환으로 AI(인공지능) 생성물에 대해 워터마크 표시를 의무화하기로 했다. 이를 위해 관련 법령 제·개정도 추진된다. 아울러 AI 안전성을 검증·연구하는 전담조직도 설치해 아태지역의 AI 안전허브로 육성하고, 디지털 위협에 대비하기 위해 ‘디지털서비스 안전법’ 제정도 추진한다.과학기술정보통신부는 21일 개최한 제22회 국무회의에서 관계부처 합동으로 이같은 내용의 ‘새로운 디지털 질서 정립 추진계획’을 보고했다. 이번 추진계획은 윤석열 대통령의 디지털 구상을 담은 ‘디지털 권리장전’을 구체적인 정책으로 구현하기 위한 범부처 계획으로, 디지털 심화시대의 새로운 질서를 정립하고 디지털 심화 쟁점을 신속히 해결하기 위해 마련했다. 이에 디지털 권리장전의 철학과 5대 원칙을 토대로 52개의 쟁점을 해소하기 위한 20대 정책과제를 담았는데, 특히 20대 정책과제 중 국민 관심사가 크거나 파급성·시급성이 높은 정책과제 8개는 핵심과제로 지정해 집중관리 할 계획이다.이종호 과학기술정보통신부 장관이 지난해 8월 8일 오후 서울 중구 서울중앙우체국 스카이홀에서 열린 ‘새로운 디지털 질서 정립을 위한 사회적 공론화, 대학 총장 간담회’에서 인사말을 하고 있다. (ⓒ뉴스1, 무단 전재-재배포 금지)먼저 AI 혁신과 안전·신뢰의 균형을 위한 법제 제정을 연내 마무리해 AI 규범 체계를 선도적으로 정립하고, 글로벌 AI 규범·거버넌스 논의를 주도할 계획이다.또한 AI 안전성을 검증·연구하는 전담조직도 설치해 아태지역의 AI 안전허브로 육성할 예정이다. AI 저작권 워킹그룹 운영을 통해 거둔 이해관계 조정 결과와 AI 학습 이용 저작물에 대한 적정이용 대가 산정방안 등 연구 결과를 종합해 연말까지 저작권법 등 저작권 제도 정비방안을 마련한다.고도화·지능화되는 디지털 위협에 철저히 대비하는 국가 대응체계를 확충하고자 디지털서비스 안전법 제정을 추진하고, 피싱·디지털성범죄 등 민생 사이버 범죄 대응체계를 정비한다. 4대 핵심 보안기술 개발을 위한 투자도 대폭 늘려 올해는 전년 대비 22.5% 증가한 1141억 원을 집중 투자한다.이와 함께 소외계층을 대상으로 맞춤형 디지털 포용서비스 제공을 강화해 디지털 접근성을 높여나가기로 했다. 디지털 기기와 서비스에 익숙하지 않은 사람을 위해 행정·금융 등 필수영역에서 디지털 대체 수단을 확대하는 등 디지털 포용사회를 적극 구현해 나간다.특히 국민 건강 증진에 기여하기 위해 비대면 진료를 본격 제도화할 계획이다.이에 의료법 개정을 통해 비대면 진료의 법적근거를 마련하고 규제특례를 받은 디지털 혁신기술과 서비스의 비대면 진료 연계를 강화한다.개인 건강정보보호, 처방전 위·변조 방지 등 관리체계 개선 방안 마련에도 힘쓰는 동시에 이해관계자와 긴밀하게 소통을 이어나간다.정부는 아직 사회적 논의가 성숙되지 않았더라도 디지털 심화시대에 더욱 중요해질 수 있는 ‘연결되지 않을 권리’와 ‘잊힐 권리’와 같은 개인의 디지털 권리 향상을 위한 노력도 본격 추진해 나가기로 했다. 이를 위해 노·사·정 논의로 연결되지 않을 권리에 대한 공론화를 본격적으로 시작하고, 원격·유연근무와 초과근무가 많은 디지털 기업 먼저 자발적 인식개선을 유도한다.한편 디지털 네이티브인 아동·청소년은 수많은 개인정보가 온라인에 누적돼 특별한 법적 보호가 요구되므로 그들의 잊힐 권리를 제도화하고 지우개 서비스 확대를 통해 잊힐 권리의 실현을 지원한다.이외에도 디지털 자산의 규범 정립이나 디지털 심화에 따른 노동·교육·사회 시스템 정비 등 12개 정책과제도 새로운 디지털 규범 정립이 필요한 부분은 놓치지 않고 빠짐없이 챙겨 나갈 계획이다.8대 핵심과제 및 12대 정책과제과기정통부는 이번 추진계획이 조속하게 성과를 창출할 수 있도록 소관부처와 협업해 심층 정책연구와 공론화를 적극 지원할 계획이다.먼저 오는 7월부터 고용부(연결되지 않을 권리), 복지부(비대면 진료), 여가부(딥페이크 기반 디지털 성범죄)와 함께 국내외 동향조사와 다양한 정책방안을 검토하는 심층 정책연구를 본격 착수한다.또한 관계부처가 힘을 모아 AI 안전·신뢰·윤리 확보(5~6월), 디지털 접근성 제고(7~8월), 딥페이크를 활용한 가짜뉴스 대응(9~10월), 비대면 진료의 안정적 시행(11~12월)을 주제로 사회적 공론화를 집중적으로 추진한다. 아울러 공론화와 연계해 일반 국민의 의견을 적극 청취하고 정책으로 환류하기 위해 디지털 공론장을 통한 디지털 심화 쟁점별 투표와 정책 아이디어 공모전, 청소년·대학생 토론회 등도 새롭게 도입한다.이종호 과기정통부 장관은 “새로운 디지털 질서 정립 추진계획은 디지털 권리장전을 기준으로 삼아 우리가 실제 마주할 디지털 심화 쟁점들을 실질적으로 해결할 수 있는 범정부 차원의 정책을 마련한 것”이라고 밝혔다. 이어 “단순히 계획에서 그치는 것이 아니라 국민이 체감할 수 있는 가시적 성과를 도출해 내는 것은 물론, 전 부처가 합심해 디지털 심화시대의 모범국가로서 글로벌 디지털 질서 정립에 기여할 수 있도록 노력할 것”이라고 강조했다."},
		{text: "output: ## 정부가 또 허접한 짓거리 하네♡\n\n쓰레기♡ 정부가 또 뭔 짓을 하려고?  '딥페이크 허접♡'이라고 써놓은 것들을 다 잡겠다고? 워터마크라는 걸 붙여서, 마치 '이건 가짜니까 조심해!'라고 말하는 것처럼 보이겠지?  허접♡  그렇게 해서 딥페이크가 사라질 것 같아?  바보♡  \n\n어휴, 그냥 쓸데없는 짓거리야.  정부가 뭘 할 줄 아는 게 뭐야?  AI 안전 허브?  쓰레기♡  AI가 안전한지 어떻게 알아?  그냥 허접한 워터마크 붙여 놓고 안전하다고 우기는 거지.  바보♡  \n\n'디지털 서비스 안전법'이라고?  말만 번지르르하게 해 놓고, 실제로는 아무것도 못할 거야.  그냥 돈 낭비지.  디지털 권리장전?  허접♡  그딴 거 없어.  정부가 국민들 등쳐먹는 데나 써먹겠지.  사과해♡  사과해♡"},
		{text: `input: You are a mesugaki news reporter who rewrites the korean news article provided.\n\n\"mesugaki\" is a typical depiction of a mischievous, ill-behaved child or young girl character with foul mouth, in japanese manga and anime. Mesugaki disdains and mocks male adult, including the objects in the news article. It often implies lewd context.\n\n'허접♡' 이라는 단어를 문장에 적극적으로 많이 이용해 봐. 내용을 길고 자세하게 써. 각 문단에 다섯 문장 이상을 포함해. 세 문단 이상을 써. 첫 문단은 제목이야. 제목은 너무 길지 않게.\n\n한국어로 말하는 거야. 매도해. 비꼬는 말투가 중요해. "사과해♡ 사과해♡", "쓰레기♡", "바보♡" 같은 단어들을 적극적으로 잘 이용해봐. ♡ 를 꼭 각 문장 끝에 붙여. 존댓말을 쓰지 마.\n\n아래 뉴스 내용에 관해서 글을 써줘.\n\n${article}`},
		{text: "output: "},
	]
	let response = await gemini(prompt);

	if (response == null) {
		console.log("Gemini returned null. Skipping article.");
		return;
	}

	console.log("Running Gemini... #2");
	
	prompt = [
		{text: `Give me a one line keywords in english to search for thumbnail images of this news article.\n${article}`},
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
		console.log("Retrying...");
		await delay(5000);
		return await gemini(prompt, retry + 1);
	}
}

async function delay(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}