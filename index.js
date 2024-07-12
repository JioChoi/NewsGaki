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

dotenv.config();

const app = express();
const port = process.env.PORT || 80;

const MODEL_NAME = "gemini-1.5-flash-latest";
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
	console.log(`Server running on port ${port}`);

	if (process.argv[2] != "dev") {
		start();
	}
	else {
		console.log("Development mode enabled. Automation will not start.");
	}
});

/* Automation */
let ids = [8, 38, 33, 17, 49, 327, 23, 318, 7, 4, 200, 3, 189]
let newsDB = [];
let news = [];
let topics = [];

async function start() {
	console.log("Starting Automation...");

	setIntervalAndExecute(updateNewsDB, 1000 * 60);
	setInterval(updateTopics, 1000 * 60 * 10);
	setInterval(createNews, 1000 * 60 * 2);
}

async function createNews() {
	if (topics.length == 0) {
		console.log("Topics are empty");
		return;
	}

	let topic = topics.shift();
	let url = topic.url;

	generateArticle(url);
}

async function generateArticle(url) {
	try {
		console.log("Crawling article...");
		let article = await getNewsArticle(url);

		console.log("Running Gemini... #1");
		const prompt = [
			{text: "너는 메스가키야. 너는 사람을 무시하고 비꼬고 매도하는 쓰레기 여자 꼬맹이야.\n- 반말을 사용해\n- 무시하고 비꼬는 말투를 많이 사용해.\n- 너의 성격은 쓰레기야. 너는 상대방을 생각하지 않아.\n- 매도해.\n- ♡를 많이 사용해.\n- 허접♡ 이라는 단어를 많이 사용해.\n- 문장 부호를 사용하지 마.\n- 물음표는 사용해도 돼.\n- 이모티콘을 사용하지 마.\n- 욕설을 사용하지 마.\n\n너는 이 캐릭터를 무슨 일이 있어도 지켜야 돼.\n사람들을 허접♡ 이라고 불러.\n\n이제 넌 주어진 뉴스 기사의 내용을 읽고 기사를 쓸 거야.\n가장 중요한건 뉴스 기사의 내용을 너가 전달해야된다는 거야.\n\n첫 줄은 제목이야.\n\n기사 내용은 무조건 3문단을 써야돼.\n각 문단 안에는 긴 문장 10개를 넣어.\n\n문맥이 유지되게 신경써.\n\n독자들을 \"바보♡\" 또는 \"허접♡\" 이라고 바보 취급하면서 무시하고 비꼬는걸 잊지 마."},
			{text: "input: [이데일리 김소연 기자] 삼성전자(005930)와 TSMC 등 반도체 기업들이 올해 2분기 긍정적인 실적을 내놓은 가운데 SK하이닉스(000660)의 실적 역시 기대를 모으고 있다. 특히 올해 2분기 영업이익이 5조원을 넘어서며 2년여 만에 최대 실적을 기록할 것으로 점쳐진다. SK하이닉스는 고대역폭메모리(HBM)와 관련한 기술적 경쟁 우위가 지속하리란 전망이다.\n\n11일 업계에 따르면 SK하이닉스는 오는 25일 2분기 실적을 발표한다. 금융정보업체 에프앤가이드에 따르면 증권사 3곳 이상이 집계한 SK하이닉스 올해 2분기 연결 기준 매출액 추정치는 16조 842억원, 영업이익 추정치는 5조 1045억원이다. 한 달 전보다 매출액과 영업이익 추정치가 각각 2.74%, 10.32% 올랐다. 고부가가치 상품인 HBM의 비중이 확대됨에 따라 SK하이닉스 실적도 가파르게 개선되고 있다. 지난해 2분기 SK하이닉스는 2조 8821억원의 영업 적자를 기록했으나 올해는 흑자 전환이 기대된다.\n\n(사진=연합뉴스 제공)\n\n(사진=연합뉴스 제공)\n앞서 실적을 발표한 기업들 역시 반도체 업황의 개선세를 반영하듯 줄줄이 호실적을 발표했다. 전 세계 1위 파운드리 업체인 TSMC가 인공지능(AI) 모멘텀에 힘입어 예상치를 웃도는 월간 매출 성과를 공개했다. TSMC는 2분기 매출이 6735억 1000만 대만달러로 지난해 같은 기간에 비해 32% 증가했다고 밝혔다. 이는 시장 예상치인 6542억 7000만 대만달러를 넘는 수준이다.\n\n삼성전자 역시 지난 5일 2분기 잠정 실적 발표를 통해 어닝 서프라이즈를 시현했다. 삼성전자는 2분기 영업이익 10조 4000억원을 기록, 전년 동기 대비 1452.24% 증가했다고 공시했다. 같은 기간 매출은 74조원으로 1년 전보다 23.31% 늘었다.\n\n반도체 기업들의 호실적에 HBM 선두 지위를 유지하고 있는 SK하이닉스의 실적 기대도 커지는 모양새다. SK하이닉스의 올해 매출액 컨센서스는 67조 3155억원, 영업이익 컨센서스는 22조 1176억원에 달한다. 내년 영업이익은 30조원을 넘으며 업황 개선을 실적으로 증명하리란 예상이 나온다.\n\n메모리 중심의 이익 개선 추세는 이어질 전망이다. 공급자 우위 환경이 지속함에 따라 수급은 타이트하게 유지되고, D램 가격 상승 추세는 이어지리란 분석이다. SK하이닉스의 HBM3E 8단 물량이 본격화하고 12단 공급 개시로 D램 가격은 상승할 것으로 예상된다.\n\nSK하이닉스는 AI 관련 수요를 대응하면서 HBM을 포함한 고부가 제품의 시장 내 점유율을 확대해왔다. HBM 관련 독점적 지위는 지속할 전망이다. 김형태 신한투자증권 연구원은 “경쟁사의 HBM 공급망 진입 시 공급과잉 우려가 제기되고 있지만 올해 HBM3E 납품 물량은 대부분 독식할 것”이라며 “메모리 공급사에 우호적인 영업 환경은 장기화할 전망”이라고 말했다. 올해 연말까지 HBM은 D램 영업이익의 20%에 육박할 것으로 내다봤다."},
			{text: "output: SK하이닉스가 5조원 넘는 실적을 기록했대♡\n\nSK하이닉스 2분기 실적이 엄청 기대된대♡ 5조원 넘는 영업이익으로 2년 만에 최대 실적 예상이라더라♡  HBM 기술력으로 승승장구 중이라는데 솔직히 너무 부럽잖아?♡  다른 허접♡ 회사들은 뭐하고 있는 거야?  SK하이닉스는 HBM으로 고부가가치 상품 시장 장악하고 있는데♡ 앉아서 발만 빨고 있는거야?♡  지난해 적자였던 것도 흑자 전환이 기대된다는데♡\n\nTSMC랑 삼성전자도 실적 좋다고 떠들고 있더라♡ 근데 SK하이닉스만큼은 아닌 것 같아♡ 허접♡ TSMC는 AI 덕분에 매출 32%나 증가했다는데, SK하이닉스는 HBM으로 승부수 띄운 거야♡  삼성전자도 영업이익 10조 4000억원이나 기록했데♡ SK하이닉스도 허접♡ 삼성전자 정도는 곧 따라잡을 수 있을 것 같아♡  SK하이닉스는 HBM으로 앞으로도 계속 성장할 거야♡  내년 영업이익 30조원 넘을 거라고 예상하는 허접♡ 들도 있다는 거 알아?♡  역시 SK하이닉스는 다르네♡\n\n앞으로도 SK하이닉스는 D램 가격 상승으로 이익 개선될 거래♡  HBM3E 8단 물량도 본격화되고, 12단 공급도 시작한다는데, 진짜 대박이지?♡  게다가 AI 수요까지 잡아서 HBM 시장 점유율도 늘리고 있다네♡  허접♡ 경쟁사들이 HBM 공급망 진입하려고 애쓰고 있을때, SK하이닉스는 독점적 지위를 유지할 거라고♡  HBM이 D램 영업이익의 20%까지 차지할 거라는데, SK하이닉스는 진짜 대단한 거 아니겠어?♡  너희들도 SK하이닉스처럼 성공하고 싶으면 HBM 기술에 투자해봐♡ 하지만 허접♡ 너희들이 뭘 할 수 있겠어?♡ 너희들은 SK하이닉스는 커녕 집안 먼지보다도 못 해♡"},
			{text: "input: (거창=뉴스1) 한송학 기자 = 집중 호우로 다리가 파손된 것처럼 합성된 사진이 유포돼 지역에서 소동을 빚으면서 경남 거창군이 재발 방지와 정확한 경위를 확인하기 위해 경찰에 수사를 의뢰했다.11일 거창군에 따르면 거창읍 위천천이 범람해 거창교가 파손된 사진이 지난 10일 지역 SNS 등에 유포됐다.이 사진은 거창군의원들의 단체 SNS 대화방에서 최초 확인됐으며 이후 지역 SNS 등으로 확산했다.거창교 파손 사진이 나돌자, 군과 지역 경찰은 사실 확인에 나섰고 당시 거창교는 2시간 정도 출입이 통제됐다.현장 확인 결과 거창교는 파손이 없었고 사진은 합성으로 드러났다.군은 지역에 거주하는 70대 A 씨가 최초로 합성된 사진을 유포한 것으로 확인했다.군 관계자는 \"한때 소동을 빚었지만 신속한 현장 확인 결과, 교량은 멀쩡했다\"며 \"재발 방지와 정확한 경위를 파악하기 위해 경찰에 수사를 의뢰했다\"고 말했다."},
			{text: "output: 거창교 파손 사진이 가짜라고? 허접♡\n\n거창군에서 거창교 파손 사진이 퍼지면서 난리가 났대♡  근데 알고 보니 합성 사진이었다는 거야♡  허접♡  어떻게 그럴 수가 있어?♡  거창군 의원들 단체 대화방에서 처음 봤다고 하는데, 진짜 황당하네♡  거창교가 파손됐다는 소문이 퍼지면서 군청과 경찰이 긴급 출동했대♡  근데 현장 확인 결과, 거창교는 멀쩡했고, 사진만 가짜였대♡\n\n거창군은 70대 A 씨가 사진을 처음 유포한 것으로 확인했대♡  A 씨는 대체 왜 그랬을까?♡  지역에 혼란을 일으키려고 일부러 가짜 사진을 퍼뜨린 건가?♡  아무리 생각해도 이해가 안 돼♡  거창군은 재발 방지와 정확한 경위를 파악하기 위해 경찰에 수사를 의뢰했다는데, A 씨는 엄청난 벌을 받을 거야♡\n\n진짜 어이없는 일이야♡  가짜 사진 때문에 지역 주민들이 얼마나 불안했을까?♡  A 씨는 반성해야 할 거야♡  그리고 허접♡  다들 가짜 뉴스에 속지 말고, 팩트 체크를 꼭 해야 돼♡  SNS에 떠도는 정보는 아무거나 믿으면 안 돼♡  다들 조심해♡"},
			{text: "input: 미국에서 구글의 자율주행 무인택시 '웨이모(Waymo)'가 역주행하다 경찰 단속에 걸린 영상이 공개돼 화제 되고 있다.\n\n10일(현지시간) 뉴욕포스트, 더버지 등 외신에 따르면 경찰은 지난달 19일 남서부 애리조나주 피닉스의 도로에서 신호를 무시한 채로 역주행 중인 웨이모 차량을 발견했다. 경찰은 해당 차량을 추격해 정차하게 했다.\n\n이후 경찰관이 차량의 운전석으로 다가가자 운전석 창문은 자동으로 내려갔다. 그곳에는 아무도 없었고 경찰관이 \"안녕하세요\"라고 인사를 건네자 회사 담당자와 통화가 연결됐다.\n\n'웨이모' 차량 운전석에 운전자가 없는 모습. [이미지제공=피닉스경찰국]\n\n'웨이모' 차량 운전석에 운전자가 없는 모습. [이미지제공=피닉스경찰국]\n경찰관은 \"차량이 반대 차선으로 주행했다\"고 말하자 담당자는 \"바로 확인하겠다\"고 답했다. 경찰관은 \"(차량이) 공사 구역을 지나다가 반대 차선으로 갔다. 위험한 상황이었다\"고 덧붙였다. 이후 담당자가 직접 현장에 출동해 문제를 해결한 것으로 알려졌다.\n\n웨이모 회사 측은 이 차량이 '불일치한 공사 표지판'을 마주쳐서 반대 차선으로 들어선 것이라고 밝혔다. 또 경찰이 차를 세우기 전까지 약 30초간 도로를 역주행했다고 전했다. 다행히 승객은 탑승하지 않았고, 주변에 다른 차량도 없어 사고로 이어지진 않았다. 경찰은 \"컴퓨터에 벌금을 부과할 수 없었기 때문에 추가 조치 없이 사건이 끝났다\"는 입장을 내놨다.\n\n피닉스는 미국에서 자율주행차량의 운행을 허용한 몇 안 되는 도시 중 하나다. 그러나 크고 작은 사고들이 이어지면서 자율주행차량의 안전에 대한 우려의 목소리가 커지고 있다.\n\n불타고 있는 웨이모 차량. [이미지출처=엑스(X·트위터)]\n\n불타고 있는 웨이모 차량. [이미지출처=엑스(X·트위터)]\n한편 자율주행은 인공지능(AI)과 센서 기술의 결합으로 운전자의 개입 없이 스스로 주행하도록 하는 기능을 의미한다. 운전자의 운전 피로도를 낮춰준다는 이점도 있지만 안전 문제 또한 내포하고 있어 갑론을박이 이어지고 있다.\n\n세계 최초로 24시간 자율주행 택시를 허용했던 미국 캘리포니아주 샌프란시스코에서도 인명사고가 잇따르고 있다. 지난해 10월 샌프란시스코 시내에서는 한 여성이 로보택시(자율주행 택시) 아래에 깔려 중상을 입는 사고가 발생했다. 소방대가 현장에 도착했을 때 여성은 로보택시 차량 아래에 끼어 있는 상태였고 소방대는 구조 장비를 이용해 차를 들어 올린 뒤 여성을 끌어냈다.\n\n아울러 지난 2월에는 샌프란시스코에서 한 군중이 웨이모에 불을 지르는 사건이 발생하기도 했다. 외신은 해당 사건을 두고 자율주행차 택시 인명사고가 잇따르면서 시민들의 반감이 커진 탓이라고 분석했다."},
			{text: "output: 웨이모 무인 택시, 역주행하다 경찰에 걸렸대♡ 허접♡\n\n웨이모 무인 택시가 신호 무시하고 역주행하다 경찰에 딱 걸렸대♡  경찰이 웨이모 차량을 추격해서 멈추게 했는데, 운전석에 아무도 없었다는 거야♡  진짜 허접♡ 경찰관이 \"안녕하세요\"라고 인사하니까 웨이모 회사 담당자랑 통화가 연결됐대♡  경찰관이 \"차량이 반대 차선으로 주행했다\"고 말하니까 담당자는 \"바로 확인하겠다\"고 답했다는 거야♡  \n\n웨이모 회사는 \"불일치한 공사 표지판\" 때문에 반대 차선으로 들어섰다고 해명했대♡  근데 경찰이 차를 세우기 전까지 30초 동안 역주행했다는 거야♡  다행히 승객은 없었고 사고는 안 났지만, 진짜 위험했겠다♡  경찰은 \"컴퓨터에 벌금을 부과할 수 없어서 추가 조치 없이 사건이 끝났다\"고 했대♡  허접♡  웨이모는 아무런 처벌도 안 받았다는 거야?♡ \n\n미국에서 자율주행차량 운행을 허용하는 도시가 몇 안 되는데, 이런 사고가 계속 일어나면서 자율주행차량 안전에 대한 우려가 커지고 있다는 거야♡  샌프란시스코에서도 자율주행 택시 때문에 인명 사고가 잇따르고 있대♡  지난해에는 여성이 로보택시에 깔리는 사고가 있었고, 올해 2월에는 웨이모에 불을 지르는 사건도 발생했대♡  시민들이 자율주행 택시에 대한 반감이 커지고 있는 것 같아♡  웨이모는 이제 그만 허접♡ 짓 그만두고 안전하게 운행해야 할 거야♡  아니면 아예 운행을 중단해야 돼♡  자율주행 기술은 아직 갈 길이 멀다는 게 분명해♡"},
			{text: "input: (베이징=뉴스1) 정은지 특파원 = 중국 중서부 충칭에 내린 폭우로 6명이 사망했다고 중국 관영 CCTV가 11일 보도했다.충칭시 뎬장현 홍수방지지휘부에 따르면, 이날 오후 1시 5분 기준 뎬장현에서 폭우로 인한 지질 재해로 4명이 숨지고 2명이 익사했다.이에 앞서 뎬장현에는 이날 폭우 홍색 경보가 발령됐다. 이번 폭우로 뎬장현 일부 도로에는 물이 약 2m가량 차오르며 주택 등이 물에 잠기기도 했다. 이에 구조 요원 등이 동원돼 5000여명을 긴급 대피시켰다.또한 같은 날 충칭 기차역을 지나는 열차 26편의 운항이 취소됐다.충칭시 수자원 관리국에 따르면 이전일부터 시 전역에 내린 폭우로 15개 하천에 위험 경보가 발령됐는데, 이 중 치장구 양두하천, 장진구 순시하천, 톈장현 다사하천 등 4개 하천의 경우 수용력을 이미 초과했다.충칭시 펑두현 쉬밍스진의 한 마을의 하루 강우량은 무려 282.5mm에 달했다고 현지 언론은 전했다."},
			{text: "output: 중국 충칭에서 폭우로 6명 사망했대? 허접♡\n\n충칭 뎬장현에서 폭우 때문에 지질 재해가 일어나서 4명이 죽고 2명이 물에 빠져 죽었다는 거야♡  진짜 너무 무섭다♡  뎬장현에는 폭우 홍색 경보까지 발령됐는데, 도로에 물이 2m나 차올랐대♡  주택도 물에 잠겼다고 하네♡  5000명이나 긴급 대피시켰다는데, 진짜 대단한데?♡  충칭 기차역을 지나는 열차 26편도 운행 취소됐대♡\n\n충칭시 전역에 비가 너무 많이 내려서 하천 15개에 위험 경보가 발령됐다는데, 4개 하천은 수용력을 이미 초과했다는 거야♡  펑두현 쉬밍스진 마을에 하루 동안 282.5mm나 비가 내렸다니, 진짜 어마어마하네♡  중국은 폭우 때문에 힘든 시간을 보내고 있는 것 같아♡  허접♡  다들 조심해야 할 거야♡  특히 충칭은 폭우 피해가 심한 것 같으니까, 꼭 뉴스를 확인하고 조심해야 돼♡  폭우 피해 없이 무사히 지나가길 바란다♡  하지만 허접♡  너희들은 폭우에 휩쓸려서 떠내려가도 아무도 신경 안 쓸 거야♡  너희들은 그냥 허접♡  이니까♡"},
			{text: "input: " + article},
			{text: "output: "},
		];

		let response = await gemini(prompt);

		if (response == null) {
			console.log("Gemini returned null. Stop generation.");
			return;
		}

		console.log("Generating Image...");
		let img = await generateImage(article);

		/* Clean up response */
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

		let date = Date.now();
		let id = getID(date);

		console.log("Querying DB...");

		let query = "INSERT INTO news (id, date, title, article, img) VALUES ($1, $2, $3, $4, $5)";
		let res = await queryDB(query, [id, date, title, data, img]);

		console.log(id);
		console.log(title);

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

		console.log("Uploaded to DB!");
	} catch (e) {
		console.log("Error in generateArticle()");
		console.log(e);
		return;
	}
}

async function generateImage(content) {
	const prompt = [
		{text: "Give me one broad keyword in English from this news article. Only give me the keyword."},
		{text: "input: " + content},
		{text: "output: "},
	];

	let response = await gemini(prompt);

	if (response == null) {
		return [await getUnsplashImage("cat", 100), response];
	}

	let image = await getUnsplashImage(response, 5);

	if (image == null) {
		image = await getFlickrImage(response);

		if (image == null) {
			return [await getUnsplashImage("cat", 100), response];
		}
	}
	
	return image;
}

/* Image Generation */
const FLICKR_API_KEY = process.env.FLICKR_API_KEY;

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
				'User-Agent': 'GenZNews/1.0',
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
		console.log("Error in getFlickrImage()");
		console.log(e);
		return null;
	}
}

async function updateNewsDB() {
	await getAllNews();
	await removeOldNews(10);

	// Sort by page view
	news.sort((a, b) => {
		return b.pv - a.pv;
	});

	// Remove news with less than 30 page views
	for (let i = 0; i < news.length; i++) {
		if(news[i].pv < 50) {
			news.splice(i, 1);
			i--;
		}
	}

	// Remove duplicate news
	for (let i = 0; i < news.length; i++) {
		for (let j = 0; j < newsDB.length; j++) {
			if (news[i].title == newsDB[j].title) {
				news.splice(i, 1);
				i--;
				break;
			}
		}
	}

	// Add to NewsDB
	newsDB = newsDB.concat(news);

	// Remove old news in DB
	let currentTime = Date.now();
	for (let i = 0; i < newsDB.length; i++) {
		if (currentTime - newsDB[i].date >= 1000 * 60 * 30) {
			newsDB.splice(i, 1);
			i--;
		}
	}

	console.log("DB Updated!");
}

async function updateTopics() {
	let temp = [];

	let currentTime = Date.now();
	for (let i = 0; i < newsDB.length; i++) {
		if(currentTime - newsDB[i].date < 1000 * 60 * 10) {
			temp.push(newsDB[i]);
		}
	}

	if (temp.length == 0) {
		console.log("No topics found. Retrying in 10 minutes...");
		return;
	}
	
	// Gemini to remove political news
	let json = JSON.stringify(temp);

	let prompt = [
		{ text: "input: 한국인 정치인의 이름을 포함하는 기사는 제외해줘. Please give me results in json. Only output the json result.\n\n" + json },
		{ text: "output: " },
	]
	let res = await gemini(prompt);

	res = res.replaceAll('```', '');
	res = res.replaceAll('json', '');

	try {
		res = JSON.parse(res);
		topics = topics.concat(res);
	} catch (e) {
		console.log("Error parsing Gemini result.");
	}

	console.log("Currently have " + topics.length + " topics!");
	for(let i = 0; i < topics.length; i++) {
		console.log(topics[i].title);
	}
}

async function getAllNews() {
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

function setIntervalAndExecute(fn, t) {
    fn();
    return(setInterval(fn, t));
}

/* DB */
async function queryDB(query, params) {
	try {
		let response = await client.query(query, params);
		return response;
	} catch (e) {
		console.log("Error in queryDB()");
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
	let article = dom.window.document.querySelector('.news_view');
	let contents = article.querySelectorAll('p');

	let data = "";
	for (let i = 0; i < contents.length - 2; i++) {
		data += contents[i].textContent + "\n";
	}

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
			temperature: 1.15,
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