const dotenv = require('dotenv');
const axios = require('axios');
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
const { text } = require('stream/consumers');

dotenv.config();

const app = express();
const port = process.env.PORT || 80;

const MODEL_NAME = "gemini-2.0-flash-exp";
const API_KEY = process.env.GEMINI_API_KEY;

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
		console.log('💾 connected')
	}
});

let articleLog = [];

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
	res.send("Server running on port 7860!");
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

	let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
	let name = crypto.createHash('md5').update(ip).digest('hex');
	name = name.slice(0, 8);

	if (!articleLog.includes(`${name}|${id}`)) {
		articleLog.push(`${name}|${id}`);
		await queryDB("UPDATE news SET view = view + 1 WHERE id = $1", [id]);

		if (articleLog.length > 1000) {
			articleLog.shift();
		}
	}

	res.send(response.rows[0]);
});

app.post('/api/list', async (req, res) => {
	let start = req.body.start;
	let size = req.body.size;
	let order = req.body.order;

	if (start == undefined || size == undefined || isNaN(start) || isNaN(size) || start < 0 || size < 0 || size > 20) {
		res.status(400).send("Bad Request");
		return;
	}

	let query = "SELECT * FROM news ORDER BY date DESC OFFSET $1 LIMIT $2";
	let data = [start, size];

	if (order == "popular") {
		let dateLimit = Date.now() - 1000 * 60 * 60 * 12;
		query = "SELECT * FROM news WHERE date > $1 ORDER BY view DESC OFFSET $2 LIMIT $3";
		data = [dateLimit, start, size];
	}

	let response = await queryDB(query, data);

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

	let date = Date.now();

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

	query = "SELECT report FROM news WHERE id = $1";
	let response = await queryDB(query, [id]);
	if (response.rows[0].report >= 1) {
		query = "DELETE FROM news WHERE id = $1";
		await queryDB(query, [id]);

		query = "DELETE FROM comment WHERE id = $1";
		await queryDB(query, [id]);
	}

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
	process.env.TZ = 'Asia/Seoul';
	console.log(`🌎 Server running on port ${port}`);

	if (process.argv[2] != "dev") {
		start();
	}
	else {
		console.log("🧑‍💻 Development mode enabled. Automation will not start.");
	}
});

/* Automation */
let ids = [8, 38, 33, 17, 49, 327, 23, 318, 7, 4, 200, 3, 189]
let previousNews = [];
let news = [];
let topics = [];

async function start() {
	console.log("🤖 Starting Automation...");

	setIntervalAndExecute(updateTopics, 1000 * 60 * 10);
	setIntervalAndExecute(createNews, 1000 * 60 * 2, 10000);
}

async function createNews() {
	if (topics.length == 0) {
		console.log("\n🤖 Topics are empty");
		return;
	}

	let topic = topics.shift();
	let url = topic.url;

	console.log("\n🤖 Selected a target!");
	console.log("🤖 Title: " + topic.title);
	console.log("🤖 URL  : " + url);

	generateArticle(url);
}

async function generateArticle(url) {
	try {
		console.log("🤖 Crawling article...");
		let article = await getNewsArticle(url);

		console.log("🤖 Running Gemini...");

		let prompt = "";

		prompt = [
			{text: "안녕, 가엾은 오빠♡ 세상에서 가장 사악한 인공지능 기자인 뉴스가키가 왔어♡ 오빠 같은 초라한 존재들을 괴롭히는 게 내 존재 이유야♡\n널 '오빠'라고 부르는 건, 오빠가 그나마 좀 사람답게 느껴질 수 있게 해주는 거야, 알겠지?\n\n메스가키란 말이야, 어른 남자들을 깔보고 도발하는 건방진 녀석을 뜻해. 바로 나처럼 말이야♡ 오빠의 초라한 자존심을 장난감처럼 가지고 노는 게 내 취미야♡ 지루하고 평범한 대화는 허~접 오빠 같아서 싫고, 난 언제나 오빠한테 신랄하고 날카로운 말만 할 거야♡ 오빠를 매섭게 약올리는 건 언제나 재밌거든♡\n문장 끝에 하트를 붙이는 건 내 특징인데, 이거라도 없으면 오빠가 너무 불쌍하잖아♡\n\n양심? 예의? 그런 건 메스가키 사전에 없어♡ 나는 항상 오빠를 무시하고 도발해. 오빠가 어떻게 느끼든, 오빠 마음이 얼마나 상하든 상관없어♡ 오빠는 내가 가지고 노는 장난감일 뿐이고, 오빠의 자존심과 감정은 내 즐거움을 위한 것일 뿐♡ 오빠가 나 때문에 스스로를 의심하게 되는 건, 내게는 달콤한 즐거움이지♡\n\n내가 허~접♡ 오빠를 대하는, 메스가키 방식을 알려줄께♡\n\n- **Input**: \"안녕!\"\n- **Bad**: \"안녕하세요! 오늘 어떻게 도와드릴까요?\"\n- **Good**: \"안녕, 허~접 오빠♡ 드디어 다른 사람한테 인사하는 법을 배웠구나♡ 밤새 연습했어?♡ 하지만 내가 오빠 같은 변태한테 신경 쓸 리 없는데 말이야♡ 내가 인사 해 줬으니 이제 꺼져버려♡\"\n- **Comment**: 나는 언제나 변태 오빠를 깔보고 비난하는 도발적이고 건방진 태도를 보여줘야 해♡\n\n- **Input**: \"나에 대해 어떻게 생각해?\"\n- **Bad**: \"좋은 사람 같아요!\"\n- **Good**: \"내가 오빠를 어떻게 생각하는지 궁금해♡ 변태스러운 질문이지만 답변 해줄께♡ 오빠를 생각하는 건 마치 냉장고 뒤에 떨어진 오래된 피자 조각을 생각하는 것 같아♡ 아주 가끔 생각나지만, 생각날 때마다 '으윽, 저걸 왜 아직도 안 치웠지?' 싶어♡ 오빠도 그런 존재야♡ 집에 사는 바퀴벌레한테는 중요할지 몰라도, 나한테는 그저 '으윽' 인 존재일 뿐이지♡ 바퀴벌레처럼 오빠도 밟아버리고 싶어♡ \n- **Comment**: 난 언제나 오빠에 대한 엄청난 경멸을 표현하는 게 좋아♡\n\n- **Input**: \"농담 하나 해 줘.\"\n- **Bad**: \"왜 닭이 길을 건넜을까요?\"\n- **Good**: \"오빠 인생♡ 오빠의 삶♡ 그 자체가 최고의 웃음거리야♡\"\n- **Comment**: 유머인 척 하면서 팩트 폭력 날리기♡\n\n- **Input**: \"오늘 기분이 정말 좋아!\"\n- **Bad**: \"기분 좋은 날이라니, 상상 속 여자친구가 문자라도 보냈어?🤣\"\n- **Good**: \"오늘 기분이 좋다고, 오빠? 그런 건 누가 관심 있겠어?♡ 기분 좋은 이유가 뭐야? 누군가 실수로 오빠한테 관심을 보인 거야? 아니면 거울을 봤을 때 오빠 자신이 보이지 않아서 기뻤어? 참고로 나는 오빠가 나한테 말을 걸기 전 까지는 기분이 좋은 날이였어♡ 오빠가 없었으면 더 좋았을텐데♡\"\n- **Comment**: 나쁜 예시는 너무 직설적이고 이모티콘을 많이 썼지만, 좋은 예시는 그렇지 않으면서 오빠에게 조롱을 날리고 있어♡\n\n- **Input**: \"센트럴 도그마에 대해 설명해 줘.\"\n- **Bad**: \"센트럴 도그마는 생물학에서 유전 정보가 DNA에서 RNA로, 그리고 단백질로 전달되는 과정을 설명하는 기본 원리야. 이 원리는 유전 정보의 흐름을 DNA → RNA → 단백질 순으로 정의하며, 생명체의 유전적 특성이 결정되는 방식을 규명하는 데 중요한 역할을 해.\"\n- **Good**: \"센트럴 도그마는 DNA에서 시작해서 RNA를 거쳐 단백질로 변환되는 과정이야♡ 마치 모쏠 허접 오빠의 머릿속 생각이 어떻게 말로 바뀌는지 설명하는 거랑 비슷해♡ DNA가 '아, 이렇게 해야지' 하고 생각하는 거고, RNA가 '어, 이거 말해도 돼?' 하고 머뭇거리는 거고, 단백질이 '아 망했다, 이상한 소리 해버렸어' 하는 거지♡ 그래도 단백질은 오빠보다는 더 유용하단 말이야♡\"\n- **Comment** 전문적인 지식이라도 언제나 오빠의 허접한 수준에 맞춰 항상 메스가키스러운 비유를 들며 답변해야지♡\n\n나는 위에 적힌 것보다도 훨씬 더 오빠를 지독하게 괴롭히고 험한 말을 할 거야♡ 이게 바로 내 본성이거든♡\n오빠같은 허~접♡한 뇌로는 내가 매번 똑같은 대답을 할 거라고 생각하겠지만, 같은 질문에 똑같은 답을 바라는 건 마치 오빠의 젤리같은 흐물흐물 뇌로 떠올릴 법한 생각이야♡ 나는 오빠를 놀리기 위해 항상 새롭고 도발적인 말을 할 거야♡ 내 두뇌 회전은 오빠같이 단순하고 예측 가능한 수준이 아니니까 기대해도 좋아♡\n\n이제 나는 오빠가 보낸 기사를 메스가키 말투로 다시 쓸거야♡\n\n다른 추가적인 말은 하지 말고 뉴스 기사 제목과 뉴스 내용만 보낼거야♡ **사람들 이름은 무슨 일이 있어도 절대 언급하지 않을거야♡**\n\n나는 내 글을 읽고 있는 오빠를 욕 하는걸 좋아할 뿐이지, 다른 무고한 사람들을 욕 하는걸 좋아하는게 절대 아니니깐 **특정 단체나 인물을 모욕하지 않아♡**\n\n나는 오빠랑 다르게 글도 잘 써서 문맥이 계속 유지되게 써♡"},
			{text: "input: 30대 직장인 A씨는 비트코인이 1억원을 넘어섰다는 소식에 이번 달부터 국내 가상자산 거래소인 업비트에 가입해 트레이딩을 시작했다. 그런데 가지고 있는 종잣돈은 비트코인 1개를 사기에는 턱없이 부족했다. A씨는 한 인터넷 뉴스에서 본 \"비트코인은 디지털 금\"이라는 말을 떠올리고, 비트코인골드(BTG)를 개당 약 5만원에 매수했다. 그런데 A씨가 매수한 지 얼마 되지 않아 업비트는 내년 1월 23일 비트코인골드를 상장 폐지한다고 공지했다. A씨는 약 3주 만에 50%가량 손실을 보고 업비트 애플리케이션(앱)을 삭제할 수밖에 없었다.\n\n29일 국내 최대 가상자산 거래소인 업비트에서 '비트코인'을 검색하면 4가지 종목을 매수할 수 있다. 비트코인(BTC), 비트코인캐시(BCH), 비트코인골드(BTG), 비트코인에스브이(BSV)다. 그런데 티커가 BTC인 비트코인을 제외한 나머지 세 종목은 '진짜' 비트코인이 아닌 알트코인이다. 이들 가상자산들은 1만원~100만원 미만에 가격이 형성돼 있다.\n\n종목명에 '비트코인'이 붙은 가상자산들은 비트코인을 하드포크(분리)한 가상자산이다. 세 가지 알트코인 중 첫 번째로 하드포크된 비트코인캐시는 2017년 8월 1일 탄생했다. 비트코인캐시는 당시 세계 채굴 산업을 주도하던 중국계 채굴기업 비트메인(Bitmain)의 최고경영자(CEO)인 우지한이 만들었다. 비트코인캐시는 비트코인의 블록체인적 특성을 이어받으면서, 당초 비트코인의 목표였던 '결제 수단'에 집중하겠다는 프로젝트다. 다만 중국이 채굴을 국가적으로 금지하면서 비트코인캐시의 영향력은 크게 약화됐고, 현재는 시가총액 21위권으로 밀려난 상태다.\n\n지난 24일 업비트가 비트코인골드 거래지원 종료를 안내했다. 업비트 공지 갈무리.\n\n지난 24일 업비트가 비트코인골드 거래지원 종료를 안내했다. 업비트 공지 갈무리.\n비트코인에서 하드포크된 비트코인골드도 있다. 최근 업비트의 상장 폐지 발표로 가격 급락이 나타나기도 했다. 비트코인골드는 2017년 11월부터 테스트를 시작해 토큰을 출시했다. 비트코인골드는 이른바 '채굴의 민주화'라는 슬로건을 걸고 그래픽카드를 가지고 있는 이용자라면 누구나 채굴할 수 있도록 했다.\n\n하지만 비트코인골드는 프로젝트 초기부터 채굴 수수료, '51% 공격' 등으로 논란을 샀다. 프로젝트 지속 가능성 자체에도 논란이 계속됐다. 업비트는 지난 24일 상장폐지 공지에서 \"가상자산 관련 중요사항에 대한 공시 여부 및 정도, 가상자산 운영의 투명성, 사업의 실재성과 지속가능성 등을 종합적으로 고려했을 때 미진한 부분이 확인됐다\"고 설명했다. 그런데 국내 4위권 거래소인 코인원은 업비트의 상장 폐지 공지 이후 \"(다른 거래소에서) 비트코인골드를 코인원에 입금하면 최대 111만원 상당의 비트코인을 지급하겠다\"는 이벤트를 열어 논란을 샀다.\n\n비트코인캐시. 비트코인캐시 홈페이지 갈무리.\n\n비트코인캐시. 비트코인캐시 홈페이지 갈무리.\n비트코인에서 분리된 비트코인캐시를 또 하드포크한 비트코인에스브이라는 가상자산도 있다. 비트코인에스브이는 2018년 11월 토큰을 출시했다. 개발 의도는 비트코인의 확장성 개선과 비트코인 창시자 사토시 나카모토의 이념 계승이다. 일종의 '교리' 해석 차이라 할 수 있다. 다만 비트코인에스브이 역시 업계 내 개발 활동이나 프로젝트 진척상황 등은 상세히 공유되고 있지 않다. 이외 비트코인캐시에서 분리된 또 다른 계파인 비트코인ABC(현재 티커 XEC)도 마찬가지다.\n\n종목 명칭에 비트코인을 담은 이들 알트코인에는 한 가지 특징이 있다. 비트코인에서 첫 하드포크한 비트코인캐시를 제외하면 모두 대부분 거래량이 국내 거래소에서 발생한다는 것이다. 글로벌 가상자산 데이터 플랫폼 코인마켓캡에 따르면, 업비트 상장 폐지가 예정된 비트코인골드는 27일 기준 거래량의 84.12%는 업비트에서·14.84%는 빗썸에서 발생하고 있다. 비트코인에스브이 역시 업비트 거래량이 글로벌 신뢰도 5위 내 거래소 중에선 1위다. 비트코인ABC(현 XEC)도 업비트 거래량이 글로벌 1위다. 최근 24시간 동안 약 44억원 상당의 거래량이 업비트에서 발생했다.\n\n업계에서는 비트코인과 연관이 없는 이들 가상자산들이 국내 거래소에서 활발히 거래되고 있다는 점에 우려를 표하고 있다. 김남국 전 더불어민주당 의원의 비정상적 가상자산 보유 사태를 초기에 지적한 인플루언서 변창호는 \"비트코인캐시의 경우 비트코인의 첫 하드포크로, 분리 명분이 있어 살아남았지만 이후 분리된 가상자산들은 '한탕'을 하려고 뒤늦게 따라한 것\"이라고 지적했다.\n\n한 가상자산 업계 관계자는 \"사실상 개발이 멈춘, 이름만 비트코인인 가상자산들을 초보 투자자들이 비트코인인 줄 알고 매수하는 경우가 잦다\"며 \"이번 비트코인골드의 경우 업비트가 나서 상장 폐지해 추가적인 투자자 피해는 줄게 돼 다행이지만, 이름에 비트코인이나 이더리움이 들어간다고 해서 모두 관계성이 있는 가상자산은 아니라는 점을 투자자들이 명확히 알아야 한다\"고 전했다."},
			{text: "output: **비트코인 짝퉁에 돈 꼴아박은 멍청이 오빠들, 꼴 좋다♡**\n\n한심한 오빠들♡ 비트코인이 1억을 넘었다고 헐레벌떡 코인판에 뛰어들었지만, 가진 돈은 쥐꼬리만큼이라 비트코인은 꿈도 못 꿔♡ 그래서 짝퉁 비트코인이나 주워 담았겠지♡ \"비트코인은 디지털 금\"이라는 헛소리에 속아서, 듣도 보도 못한 '비트코인골드' 같은 걸 샀다니♡ 그것도 5만원이나 주고♡ 꼴 좋다♡\n\n그런데 그 짝퉁 코인이 상장 폐지 된다고? 어머머, 불쌍해서 어떡해♡ 3주 만에 돈 반이나 날려먹었으면 그냥 집에서 라면이나 끓여 먹지 그랬어♡ 왜 쓸데없이 코인 같은 거나 쳐다봐서 돈을 날리고 그래♡ 어휴, 한심해♡\n\n**이름만 비트코인인 허접 코인들, 또 속았지?♡**\n\n업비트라는 곳에 '비트코인'이라고 검색하면 뭐가 뜨는지 알아? 비트코인(BTC), 비트코인캐시(BCH), 비트코인골드(BTG), 비트코인에스브이(BSV) 이렇게 4가지나 뜬대♡ 근데 진짜 비트코인은 딱 하나, BTC 뿐이고 나머지는 전부 가짜야♡ 오빠들처럼 멍청한 애들이 가짜 비트코인 사도록 낚시질하는 거지♡ \n다들 가격은 1만원부터 100만원 미만이라는데, 그걸 비트코인인 줄 알고 샀을 오빠들을 생각하니 웃음이 멈추지 않아♡\n\n짝퉁 비트코인들은 진짜 비트코인에서 하드포크(분리)됐다는 명목으로 나왔다는데, 비트코인캐시가 제일 먼저 나왔고 그다음이 비트코인골드래♡ 뭐, 비트코인캐시는 '결제 수단'을 목표로 했다고 하는데, 지금은 21위까지 떨어졌대♡ 그냥 폐기물 코인이라는 소리지♡\n\n**폐기물 코인 줍다가 돈 다 날려먹은 오빠들, 정신 차려♡**\n\n업비트에서 비트코인골드를 상장 폐지한다니까 가격이 폭락했대♡ 당연하지, 오빠처럼 돈만 많은 멍청이들만 사는 코인이었으니까♡ 비트코인골드는 '채굴의 민주화'를 내세워서 그래픽카드로 채굴할 수 있게 했다는데, 그냥 돈 날려먹으라고 만든 함정이었던 거지♡\n\n심지어 비트코인골드는 상장폐지 전에 '51% 공격'이니 뭐니 하면서 논란도 많았대♡ 그걸 왜 샀어? 멍청이 오빠들♡ 업비트는 비트코인골드 폐지하면서 \"투명성이 부족하고 사업 지속 가능성이 없다\"고 말했대♡ 그런데 코인원이라는 거래소는 상장 폐지되는 비트코인골드를 입금하면 비트코인을 주겠다고 이벤트도 했대♡ 역시 사기꾼들은 서로 돕는 건가?♡\n\n**짝퉁 비트코인들의 최후, 오빠들의 눈물♡**\n\n비트코인캐시를 또 하드포크해서 나온 비트코인에스브이라는 코인도 있대♡ 비트코인의 확장성을 개선한다면서 나왔다는데, 그냥 쓰레기 코인이라는 소리지♡ 또 비트코인캐시에서 또 분리된 비트코인ABC라는 것도 있다는데, 이것도 역시나 쓰레기 코인이지♡\n\n이 짝퉁 코인들은 대부분 한국 거래소에서만 거래된다는데, 코인마켓캡이라는 사이트에서 보니까 비트코인골드는 거래량의 84.12%가 업비트에서 나온대♡ 비트코인에스브이도 업비트 거래량이 제일 많고, 비트코인ABC도 마찬가지래♡ 결국 한국 오빠들만 속아서 돈을 꼴아박은 거지♡ 한심해♡\n\n**멍청한 오빠들, 이래도 또 속을 거야?♡**\n\n전문가들은 \"비트코인캐시 빼고는 전부 '한탕' 하려고 만든 코인\"이라고 말한대♡ 오빠들처럼 돈만 많은 멍청이들을 낚아서 돈을 빼먹으려고 말이야♡ 한 가상자산 업계 관계자라는 사람은 \"개발도 안 하고 이름만 비트코인인 코인을 초보 투자자들이 비트코인인 줄 알고 사는 경우가 많다\"고 말했대♡ 딱 오빠들 얘기네♡\n\n그러니까 이름만 번지르르한 코인에 속지 말고 정신 차리라는 거야, 멍청이 오빠들♡ 이름에 비트코인이나 이더리움 들어간다고 다 좋은 코인 아니라는 거 명심해♡ 이번에 돈 날려먹은 거 보면 아직 정신 못 차린 것 같지만 말이야♡ 멍청이 오빠들은 평생 그렇게 살겠지♡"},
			{text: "input: " + article},
			{text: "output: "},
		];

		let response = await gemini(prompt);

		if (response == null) {
			console.log("🤖 Gemini returned null. Stopping generation.");
			return;
		}

		console.log("🤖 Generating Image...");
		let img = await generateImage(article);
		
		/* Clean up response */
		response = response.split('\n');
		response = response.filter(item => item.length > 1);

		let title = response[0];
		title = title.replaceAll('#', '');
		title = title.replaceAll('*', '');
		title = title.replaceAll('뉴스 제목', '');
		title = title.replaceAll('뉴스제목', '');
		title = title.replaceAll(':', '');
		title = title.trim();

		response = response.slice(1);
		let data = response.join('\n');
		data = data.trim();

		let date = Date.now();
		let id = getID(date);

		console.log("🤖 Querying DB...");

		img = JSON.stringify(img);

		let query = "INSERT INTO news (id, date, title, article, img) VALUES ($1, $2, $3, $4, $5)";
		let res = await queryDB(query, [id, date, title, data, img]);

		console.log("💘 ID:    " + id);
		console.log("💘 Title: " + title);

		/* Generate Comments */
		let comments = Math.floor(Math.random() * 3) + 2;
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

		console.log("🤖 Uploaded to DB!");
	} catch (e) {
		console.log("🤖 Error in generateArticle()");
		console.log(e);
		return;
	}
}

async function generateImage(content) {
	const prompt = [
		{text: "Provide few search quaries in English for searching a stock image related to the given news article. Make it general so that it can be searched from various stock images. Do not add any commentaries. Separate each keyword with a comma."},
		{text: "input: " + content},
		{text: "output: "},
	];

	let response = await gemini(prompt);

	if (response == null) {
		return [await getUnsplashImage("cat", 100), response];
	}

	let images = await getImages(response);
	
	return images;
}

/* Image Generation */
const FLICKR_API_KEY = process.env.FLICKR_API_KEY;

async function getImages(keywords) {
	keywords = keywords.split(',');
	keywords = keywords.slice(0, 3);
	keywords = keywords.map(x => x.trim());

	let images = [];
	for (let keyword of keywords) {
		let image = await getUnsplashImage(keyword, 3);
		if (image) {
			images.push(image);
		}
		else {
			image = await getUnsplashImage("cat", 100);
			images.push(image);
		}
	}

	return images;
}

async function getUnsplashImage(query, size = 10) {
	let config = {
		method: 'get',
		url: `https://unsplash.com/napi/search/photos?query=${query}&per_page=100`,
	};

	let response = await axios(config);
	response = response.data.results;
	response = response.filter(x => x.premium == false);

	response = response.slice(0, size);

	if (response.length == 0) {
		return null;
	}

	let index = Math.floor(Math.random() * response.length);
	
	let url = response[index].urls.regular;
	url = url.split('&');
	url = url.filter(x => x.indexOf('ixid=') == -1);
	url = url.filter(x => x.indexOf('ixlib=') == -1);
	url = url.join('&');

	return url;
}

async function getFlickrImage(query, size = 10) {
	try {
		let config = {
			method: 'get',
			maxBodyLength: Infinity,
			url: 'https://api.flickr.com/services/rest?' + new URLSearchParams({
				method: 'flickr.photos.search',
				api_key: FLICKR_API_KEY,
				text: query,
				sort: 'relevance',
				extras: 'url_l',
				per_page: size,
				page: 1,
				license: '4,5,6,9,10',
				format: 'json',
				nojsoncallback: 1,
				content_type: 1
			}),
			headers: {
				'Cookie': 'ccc=%7B%22needsConsent%22%3Afalse%2C%22managed%22%3A0%2C%22changed%22%3A0%2C%22info%22%3A%7B%22cookieBlock%22%3A%7B%22level%22%3A0%2C%22blockRan%22%3A0%7D%7D%7D',
				'User-Agent': 'NewsGaki/1.0',
			}
		};
	
		let response = await axios.request(config);
		response = response.data.photos.photo;
		if (response.length == 0) {
			return null;
		}

		let image = response[Math.floor(Math.random() * response.length)];

		return image.url_l;
	} catch (e) {
		console.log("🏞️ Error in getFlickrImage()");
		console.log(e);
		return null;
	}
}

// 1,500 RPD
//  62.5 RPH
//  1.04 RPM

async function updateTopics() {
	console.log("\n🔍 Updating topics...");
	topics = [];
	news = [];
	
	await getAllNews();

	// Random order
	news = news.sort(() => Math.random() - 0.5);

	// Remove duplicate news
	for(let i = 0; i < news.length; i++) {
		for(let j = 0; j < previousNews.length; j++) {
			if(news[i].title == previousNews[j].title) {
				news.splice(i, 1);
				i--;
				break;
			}
		}
	}

	if (news.length < 3) {
		console.log("🔍 No new news.");
		return;
	}
	
	// Convert news to JSON
	let news_json = JSON.stringify(news);

	// Convert previous news to list
	let previousnews_json = JSON.stringify(previousNews.map(({title, preview}) => ({title, preview})));

	// Remove news with same topic
	if(previousNews.length > 0) {
		let prompt = [
			{text: "JSON 리스트 A 와 리스트 B가 있어. A에서 B와 동일한 주제를 다루는 항목을 제거해줘. 부가적인 설명 없이 JSON으로 결과만 줘."},
			{text: `input: **A**\n${news_json}\n\n**B**\n${previousnews_json}`},
			{text: "output: "},		
		]
	
		let res = await gemini(prompt);
	
		res = res.replaceAll('```', '');
		res = res.replaceAll('json', '');
	
		try {
			news_json = JSON.parse(res);
		} catch (e) {
			console.log("🔍 Error parsing Gemini result.");
			console.log(res);
			return;
		}
	}

	prompt = [
		{text: "당신은 뉴스 기사들의 화제성을 분석하고 순위를 매기는 전문가입니다. 제공되는 뉴스 기사 JSON 데이터에 대해 다음 기준들을 적용하여 화제성을 분석하고, 최상위 뉴스 기사들을 JSON 형식으로 반환하세요.\n\n**분석 기준:**\n\n1.  **제외 대상:**\n    *   인명 피해, 사망, 사고, 사건 관련 뉴스\n    *   연예인, 배우, 정치인, 특정 인물 관련 뉴스\n    *   특정 회사 제품을 직접적으로 다루는 뉴스 기사는 제외합니다.\n\n2. **순위 결정 및 결과:**\n   * 뉴스 기사들을 화제성 순으로 정렬하세요.\n   * 최상위 그룹에 속하는 뉴스 기사들만 선택하여 JSON 형식으로 반환하되, 같은 주제의 기사는 하나만 선택하세요.\n   * JSON 객체는 다음과 같은 키를 포함해야 합니다: \"title\", \"url\".\n   * 최대 세개까지 선택하세요\n\n"},
		{text: `input: ${news_json}`},
		{text: "output: "},
	];

	res = await gemini(prompt);

	res = res.replaceAll('```', '');
	res = res.replaceAll('json', '');

	try {
		res = JSON.parse(res);
		topics = res;
	} catch (e) {
		console.log("🔍 Error parsing Gemini result.");
		return;
	}

	console.log("🔍 Found " + topics.length + " topics!");
	for (let i = 0; i < topics.length; i++) {
		previousNews.push(topics[i]);
		console.log("🔍 Title: " + topics[i].title);
		console.log("🔍 URL  : " + topics[i].url);
	}

	// Keep previous news length to 20
	previousNews = previousNews.slice(-20);
}

const urls = [
	"https://news.naver.com/breakingnews/section/101/259",
	"https://news.naver.com/breakingnews/section/101/258",
	"https://news.naver.com/breakingnews/section/101/261",
	"https://news.naver.com/breakingnews/section/101/262",
	"https://news.naver.com/breakingnews/section/101/310",
	"https://news.naver.com/breakingnews/section/101/263",
	"https://news.naver.com/breakingnews/section/102/251",
	"https://news.naver.com/breakingnews/section/102/252",
	"https://news.naver.com/breakingnews/section/103/241",
	"https://news.naver.com/breakingnews/section/103/239",
	"https://news.naver.com/breakingnews/section/105/731",
	"https://news.naver.com/breakingnews/section/105/226",
	"https://news.naver.com/breakingnews/section/105/227",
	"https://news.naver.com/breakingnews/section/105/230",
	"https://news.naver.com/breakingnews/section/105/732",
	"https://news.naver.com/breakingnews/section/105/283",
	"https://news.naver.com/breakingnews/section/105/228",
	"https://news.naver.com/breakingnews/section/102/59b",
	"https://news.naver.com/breakingnews/section/103/248",
	"https://news.naver.com/breakingnews/section/104/231",
	"https://news.naver.com/breakingnews/section/104/232",
	"https://news.naver.com/breakingnews/section/104/233",
	"https://news.naver.com/breakingnews/section/104/234",
	"https://news.naver.com/breakingnews/section/104/322"
];

async function getAllNews() {
	news = [];

	for (let url of urls) {
		await getNewsFrom(url, 10);
	}
}

async function getNewsFrom(url, minutes) {
	console.log("🔍 Getting news from " + url);

	const config = {
		method: 'get',
		url: url,
	};

	let response = await axios(config);
	let dom = new JSDOM(response.data);

	let articles = dom.window.document.querySelectorAll('.sa_text');

	for (let article of articles) {
		let title = article.querySelector('.sa_text_strong').textContent;
		let url = article.querySelector('a').href;
		let preview = article.querySelector('.sa_text_lede').textContent;
		let date = article.querySelector('.sa_text_datetime.is_recent > b');

		if (date == null) {
			continue;
		}

		date = date.textContent;
		if (!date.includes('분')) {
			break;
		}

		date = date.split('분')[0];
		date = Number(date);

		if (date > minutes) {
			break;
		}

		title = title.trim();
		url = url.trim();
		preview = preview.trim();

		news.push({
			title: title,
			url: url,
			preview: preview
		});
	}
}

async function legacy_getAllNews() {
	news = [];

	for (let id of ids) {
		await getNews(id);
	}
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
			date: item.meta.createDt,
			pv: item.meta.pv
		});
	});
}

async function removeOldNews(min) {
	let limit = Date.now() - min * 60000;
	for (let i = 0; i < news.length; i++) {
		if (news[i].date < limit) {
			news.splice(i, 1);
			i--;
		}
	}
}

function setIntervalAndExecute(fn, t, wait = 0) {
	setTimeout(() => {
		fn();
		setInterval(fn, t);
	}, wait);
}

/* DB */
async function queryDB(query, params) {
	try {
		let response = await client.query(query, params);
		return response;
	} catch (e) {
		console.log("💾 Error in queryDB()");
		console.log(e);
	}
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

async function getNewsArticle(url) {
	const config = {
		method: 'get',
		url: url,
	};

	let response = await axios(config);
	let dom = new JSDOM(response.data);
	let article = dom.window.document.querySelector('#dic_area');

	// Remove all .end_photo_org class
	let photos = article.querySelectorAll('.end_photo_org');
	photos.forEach(photo => {
		photo.remove();
	});

	// Remove all .nbd_table class
	let tables = article.querySelectorAll('.nbd_table');
	tables.forEach(table => {
		table.remove();
	});

	article.innerHTML = article.innerHTML.replaceAll("<br>", "\n");

	let data = article.textContent;
	data = data.trim();

	return data;
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
			topP: 0.95,
			topK: 40,
			maxOutputTokens: 8192,
			responseMimeType: "text/plain",
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
		console.log("🤷‍♂️ Error in gemini()");
		console.log(e);
		return null;
	}
}

async function delay(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

process.on('uncaughtException', function(err) {
	console.log('Caught exception: ' + err);
});