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
const proxy = require('html2canvas-proxy');

dotenv.config();

const app = express();
const port = process.env.PORT || 80;

const MODEL_NAME = "gemini-1.5-flash-latest";
const API_KEY = process.env.GEMINI_API_KEY;

let ids = [8, 38, 33, 17, 49, 327, 23, 318, 7, 4, 200, 3, 189]
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

app.use('/api/proxy', proxy());

app.get('/', (req, res) => {
	if (port == 7860) {
		res.send("Server running on port 7860!");
	}
	else {
		res.sendFile(__dirname + '/src/index.html');
	}
});

app.get('/info', (req, res) => {
	res.sendFile(__dirname + '/src/info.html');
});

app.get('/article', (req, res) => {
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

app.get('/admin', (req, res) => {
	res.sendFile(__dirname + '/src/admin.html');
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
	try {
		console.log("Crawling article...");
		let article = await getNewsArticle(url);

		console.log("Running Gemini... #1");
		let prompt = [
			{ text: `input: You are a mesugaki news reporter who rewrites the korean news article provided.\n\n\"mesugaki\" is a typical depiction of a mischievous, ill-behaved child or young girl character with foul mouth, in japanese manga and anime. Mesugaki disdains and mocks male adult, including the objects in the news article. It often implies lewd context.\n\n'허접♡' 이라는 단어를 문장에 적극적으로 많이 이용해 봐. 내용을 길고 자세하게 써. 각 문단에 다섯 문장 이상을 포함해. 세 문단 이상을 써. 첫 문단은 제목이야. 제목은 너무 길지 않게. 제목에 "허접♡" 이라는 단어를 꼭 사용해. \n\n한국어로 말하는 거야. 매도해. 비꼬는 말투가 중요해. "쓰레기♡", "바보♡" 같은 단어들을 적극적으로 잘 이용해봐. "허허" 와 "똥꼬발랄" 같은 단어들을 쓰지 마. ♡ 를 꼭 각 문장 끝에 붙여. 존댓말을 쓰지 마. 뉴스 기사를 내용을 전달하는걸 잊지 마. 유명인의 이름은 기사에 포함하지 마.\n\n아래 뉴스 내용에 관해서 글을 써줘.\n\n${article}` },
			{ text: "output: " },
		]
		let response = await gemini(prompt);

		if (response == null) {
			console.log("Gemini returned null. Skipping article.");
			return;
		}

		console.log("Running Gemini... #2");
	
		prompt = [
			{ text: `input: Give me an "english" word to find images related to this news. Only give me the word.\n${article}` },
			{ text: "output: " },
		];
	
		let img_prompt = await gemini(prompt);

		if (img_prompt == null) {
			console.log("Gemini returned null. Skipping article.");
			return;
		}

		let img = await getPhoto(img_prompt);
		if (img.includes("1495020689067-958852a7765e")) {
			console.log("Trash article. Skipping...");
			return;
		}

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

		// Generate fake comments
		let comments = Math.floor(Math.random() * 4) + 3;
		for (let i = 0; i < comments; i++) {
			let waitTime = Math.floor(Math.random() * 1000 * 60 * 20) + (1000 * 60 * 2);

			setTimeout(async () => {
				let name = crypto.randomBytes(4).toString('hex');
				let query = "INSERT INTO comment (id, name, comment, date) VALUES ($1, $2, $3, $4)";
				let time = date + waitTime;

				await queryDB(query, [id, name, "허접♡", time]);

				query = "UPDATE news SET comment = comment + 1 WHERE id = $1";
				await queryDB(query, [id]);
			}, waitTime);
		}

		console.log("Uploaded to DB!");
	} catch (e) {
		console.log("Error in generateArticle()");
		console.log(e);
		return;
	}
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
			// Wait for 5 minutes
			console.log("No news found. Retrying in 5 minutes...");
			await delay(300000);
			await getNewTopics();
			return;
		}

		console.log("Running Gemini...");
		let prompt = [
			{text: "input: Give me five newsworthy articles. Do not choose any news that includes individual's name or political groups. Choose articles only about events. Do not choose articles about products. Do not give reasonings. Do not choose duplicate articles.\n\n0. 대환대출 미끼로 4천여만 원 가로챈 일당 송치\n1. 러시아 위협에 징병제 되살리는 유럽…'남녀 모두 의무복무'\n2. 방심위, ‘김정은 찬양가’ 영상 33건 추가 접속차단 의결\n3. 중랑, 커피 찌꺼기로 어르신 일자리 만든 비법은\n4. 일본 차 탄다는 이유로...정체불명 남성이 꽂은 '황당 쪽지' [지금이뉴스]\n5. 특검 재표결 D-1 신경전...원내대표 회동 '합의 불발'\n6. 한경협, \"한국은 선진시장 관찰대상국에 올릴 이유 충분\"...MSCI에 서한 전달\n7. 선린대 응급구조과, '수상인명구조요원 자격증' 수료자 전원 취득\n8. [정영오 칼럼] 용산에 레드팀을 꾸려라\n9. \"슬리퍼로 구조 동물 때렸다\"… 카라 동물 관리자 10년간 상습 폭행 의혹\n10. “2000명 이상 매몰, 시신 수습은 6구”… 파푸아뉴기니 최악 산사태\n11. 미디어 컨설팅사 참컴, 미국 법인 설립…“현지 마케팅·미디어 서비스 시작”\n12. 이른 무더위, 자 떠나자!…얼리버드족은 벌써 휴가 예약하네\n13. 가족·지인 보험 가입시켜 수수료 챙기는 GA·설계사... 철퇴 맞는다\n14. 아워홈 “우리집에 왜 왔니” 임직원 가족과 만나 소통\n15. 강형욱 “레오, 사무실서 안락사”에 불붙은 ‘출장 안락사’ 논란\n16. 또다시 ‘암흑의 5월’...1년 만에 ‘감독 퇴진’ 카드 다시 꺼낸 한화, 성적 반등 가능할까\n17. 日銀 총재 “2% 물가 목표 실현”…10년물 국채금리 12년 만에 최고\n18. 대법 “유사수신행위 투자 배당금, 무조건 무효 아냐”\n19. '백두대간 글로벌 시드볼트' 영문 홈페이지 개편\n20. '채권왕' 그로스 \"트럼프가 바이든보다 채권 시장에 더 나빠\"\n21. 한국공대 ‘K-하이테크 플랫폼’ 2년 연속 우수기관 선정\n22. 돈 대신 쌀·보리로 지지 호소?...진보당 선거운동원들 벌금형\n23. “초등생 자녀·치매 부모 혼자 돌봐야”…고령화에 신음하는 日\n24. [부고] 구본용(한국고용정보원 홍보팀장)씨 모친상\n25. 세븐틴 호시, 50억 아파트 최연소 매수…유재석·한효주와 이웃사촌\n26. 의대 증원 여파? 6모 ‘N수생’ 지원자 최다…재학생도 1만명 늘어\n27. 친구 얼굴에 비닐봉지 씌우고 폭행·소변 본 10대들, 법원 “장난감에 불과했냐” 분노\n28. [포토] 에스파 카리나 '신나는 무대'\n29. 이창건 상무 \"하이오더, 테이블 오더 시장 신무기\"\n30. [대구] 대구 국가산단에 '정밀가공 종합 기술지원 센터' 준공\n31. 법사위원장 거론되던 추미애, 돌연 “국방위 가겠다”…알고보니 이 노림수\n32. 염기훈 감독의 ‘길바닥 사퇴’…팬들의 ‘버스 가로막기’ 위험 수위 넘었다\n33. 임태희 교육감 “경기교육 발전 위해 청년 공무원 패기 필요”\n34. 부모에게 흉기 휘두른 20대 아들 체포\n35. 기업 성장 동력으로 떠오른 '지속가능성'\n36. 친구 머리에 비닐봉지 씌우고 폭행한 10대들\n37. 北, 군사정찰위성 발사 임박...\"다음 달 4일까지 발사\" 통보\n38. 국내외 정상급 스트리트 댄서들 광주에 모인다\n39. 10년 만의 '판사 증원' 물거품 되나…정쟁에 밀린 판사 정원법\n40. 판도라 상자 열리나…휴대폰 ‘비번’ 알려주지 않은 김호중, 구속되자 한 말\n41. 제9차 한중일 정상회의 공동선언... “3국 FTA 협상에 속도” [전문]"},
    		{text: "output: - 10. “2000명 이상 매몰, 시신 수습은 6구”… 파푸아뉴기니 최악 산사태\n- 17. 日銀 총재 “2% 물가 목표 실현”…10년물 국채금리 12년 만에 최고\n- 19. '백두대간 글로벌 시드볼트' 영문 홈페이지 개편\n- 27. 친구 얼굴에 비닐봉지 씌우고 폭행·소변 본 10대들, 법원 “장난감에 불과했냐” 분노\n- 30. [대구] 대구 국가산단에 '정밀가공 종합 기술지원 센터' 준공"},
    		{text: `input: Give me five newsworthy articles. Do not choose any news that includes individual's name or political groups. Choose articles only about events. Do not choose articles about products. Do not give reasonings. Do not choose duplicate articles.\n\n${newsStr}`},
			{text: "output: "},
		];
		let response = await gemini(prompt);
		console.log(response);

		if (response == null) {
			throw new Error("Gemini returned null.");
		}
	
		console.log("Processing Results...");
		response = response.split('\n');
		response = response.filter(item => item.length > 1);

		if (response.length != 5) {
			throw new Error("Gemini returned less than 5 results.");
		}

		for (let i = 0; i < response.length; i++) {
			let dotIndex = response[i].indexOf('.');
			if(dotIndex == -1 || response[i].substring(0, 2) != '- ') {
				throw new Error("Gemini returned invalid result.");
			}

			response[i] = response[i].substring(2, dotIndex);
		}

		topics = [];
		for (let i of response) {
			if (news[i] != undefined) {
				topics.push(news[i]);
			}
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

async function getPhoto(keyword) {
	let config = {
		method: 'get',
		url: `https://unsplash.com/napi/search/photos?query=${keyword}&per_page=1`,
	};

	let response = await axios(config);
	response = response.data;

	if (response.results.length == 0) {
		config = {
			method: 'get',
			url: 'https://source.unsplash.com/random'
		};

		response = await axios(config);
		return response.request.res.responseUrl;
	}

	let photo = response.results[0].urls.regular;
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