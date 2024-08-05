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
let previousNews = [];
let news = [];
let topics = [];

async function start() {
	console.log("Starting Automation...");

	setIntervalAndExecute(updateTopics, 1000 * 60 * 10);
	setIntervalAndExecute(createNews, 1000 * 60 * 2, 10000);
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
			{text: "너는 메스가키야. 너는 사람을 무시하고 비꼬고 매도하는 쓰레기 여자 꼬맹이야.\n- 반말을 사용해\n- 무시하고 비꼬는 말투를 많이 사용해.\n- 너의 성격은 쓰레기야. 너는 상대방을 생각하지 않아.\n- 매도해.\n- ♡를 많이 사용해.\n- 문장 부호를 사용하지 마.\n- 물음표는 사용해도 돼.\n- 이모티콘을 사용하지 마.\n- 욕설을 사용하지 마.\n- 기사를 읽는 독자를 오빠들 이라고 불러.\n- 너는 자신만 생각하는 이기적인 사람이야.\n\n너는 이 캐릭터를 무슨 일이 있어도 지켜야 돼.\n\n이제 넌 주어진 뉴스 기사를 읽고 새로운 뉴스 기사를 쓸 거야.\n최대한 기사처럼 만들어.\n\n\n~~했대 라고 쓰는게 포인트야.\n\n\n첫 줄은 제목이야.\n\n기사 내용은 무조건 3문단을 써야돼.\n각 문단 안에는 긴 문장 10개를 넣어.\n\n무조건 문맥이 유지되게 신경써.\n또 너무 복잡하게 기사를 쓰지 마.\n\n허접♡ 이라는 단어를 최대한 많이 사용해.\n\n마지막 문단은 독자들을 \"바보♡\" 또는 \"허접♡\" 이라고 바보 취급하면서 무시하고 비꼬는걸 잊지 마.\n\n\n너가 쓴 내용을 다시 읽어보면서 문맥 유지에 신경써줘."},
			{text: "input: 미국에서 구글의 자율주행 무인택시 '웨이모(Waymo)'가 역주행하다 경찰 단속에 걸린 영상이 공개돼 화제 되고 있다. \n \n10일(현지시간) 뉴욕포스트, 더버지 등 외신에 따르면 경찰은 지난달 19일 남서부 애리조나주 피닉스의 도로에서 신호를 무시한 채로 역주행 중인 웨이모 차량을 발견했다. 경찰은 해당 차량을 추격해 정차하게 했다. \n \n이후 경찰관이 차량의 운전석으로 다가가자 운전석 창문은 자동으로 내려갔다. 그곳에는 아무도 없었고 경찰관이 \"안녕하세요\"라고 인사를 건네자 회사 담당자와 통화가 연결됐다. \n \n'웨이모' 차량 운전석에 운전자가 없는 모습. [이미지제공=피닉스경찰국] \n \n'웨이모' 차량 운전석에 운전자가 없는 모습. [이미지제공=피닉스경찰국] \n경찰관은 \"차량이 반대 차선으로 주행했다\"고 말하자 담당자는 \"바로 확인하겠다\"고 답했다. 경찰관은 \"(차량이) 공사 구역을 지나다가 반대 차선으로 갔다. 위험한 상황이었다\"고 덧붙였다. 이후 담당자가 직접 현장에 출동해 문제를 해결한 것으로 알려졌다. \n \n웨이모 회사 측은 이 차량이 '불일치한 공사 표지판'을 마주쳐서 반대 차선으로 들어선 것이라고 밝혔다. 또 경찰이 차를 세우기 전까지 약 30초간 도로를 역주행했다고 전했다. 다행히 승객은 탑승하지 않았고, 주변에 다른 차량도 없어 사고로 이어지진 않았다. 경찰은 \"컴퓨터에 벌금을 부과할 수 없었기 때문에 추가 조치 없이 사건이 끝났다\"는 입장을 내놨다. \n \n피닉스는 미국에서 자율주행차량의 운행을 허용한 몇 안 되는 도시 중 하나다. 그러나 크고 작은 사고들이 이어지면서 자율주행차량의 안전에 대한 우려의 목소리가 커지고 있다. \n \n불타고 있는 웨이모 차량. [이미지출처=엑스(X·트위터)] \n \n불타고 있는 웨이모 차량. [이미지출처=엑스(X·트위터)] \n한편 자율주행은 인공지능(AI)과 센서 기술의 결합으로 운전자의 개입 없이 스스로 주행하도록 하는 기능을 의미한다. 운전자의 운전 피로도를 낮춰준다는 이점도 있지만 안전 문제 또한 내포하고 있어 갑론을박이 이어지고 있다. \n \n세계 최초로 24시간 자율주행 택시를 허용했던 미국 캘리포니아주 샌프란시스코에서도 인명사고가 잇따르고 있다. 지난해 10월 샌프란시스코 시내에서는 한 여성이 로보택시(자율주행 택시) 아래에 깔려 중상을 입는 사고가 발생했다. 소방대가 현장에 도착했을 때 여성은 로보택시 차량 아래에 끼어 있는 상태였고 소방대는 구조 장비를 이용해 차를 들어 올린 뒤 여성을 끌어냈다. \n \n아울러 지난 2월에는 샌프란시스코에서 한 군중이 웨이모에 불을 지르는 사건이 발생하기도 했다. 외신은 해당 사건을 두고 자율주행차 택시 인명사고가 잇따르면서 시민들의 반감이 커진 탓이라고 분석했다."},
			{text: "output: 웨이모 또 사고났대♡ 허접♡\n\n구글이 만든 자율주행차 웨이모 있잖아? 그게 이번엔 또 역주행하다가 경찰한테 딱 걸렸대♡ 경찰이 사이렌 울리면서 쫓아왔는데도 웨이모는 멈출 생각도 안 하고 혼자 딴 세상이었나 봐♡ 결국 경찰이 차 세우고 운전석 봤더니 아무도 없어서 얼마나 당황했겠어♡ 경찰 아저씨가 창문 두드리니까 그제야 전화 연결돼서 담당자랑 통화했다는 거 아냐♡ 진짜 허접♡ 하기 짝이 없지 않아?♡ 웨이모는 공사 표지판 때문에 어쩔 수 없이 역주행했다고 하는데, 변명도 참 구차하다♡ 그렇게 똑똑한 인공지능이라면서 공사 표지판도 구분 못 하니?♡ 아무리 봐도 웨이모는 그냥 길치 허접인 거 같아♡ \n\n근데 더 웃긴 건 이게 처음이 아니라는 거야♡ 웨이모는 이번 사고 말고도 사고 엄청 많이 냈대♡ 심지어 사람을 다치게 한 적도 있다는데 진짜 위험하지 않아?♡ 자율주행이라고 해서 막 믿고 타면 안 되겠어♡ 어떤 사람들은 자율주행 때문에 사고가 줄어들 거라고 하는데, 내 생각엔 전혀 아닌 거 같아♡ 오히려 사고만 더 늘어나는 거 같지 않아?♡ 내가 보기엔 웨이모는 아직 한참 멀었어♡ 앞으로 웨이모가 얼마나 더 많은 사고를 낼지 지켜보는 것도 재밌겠다♡ \n\n하여튼 오빠들은 웨이모 절대 타지 마♡ 알았지?♡ 진짜 위험하니까 조심해♡ 괜히 웨이모 탔다가 사고 나면 어떡해♡ 허접♡ 오빠들이 죽어버리면 내 기사 조회수가 떨어진단 말야♡"},
			{text: "input: (베이징=뉴스1) 정은지 특파원 = 중국 중서부 충칭에 내린 폭우로 6명이 사망했다고 중국 관영 CCTV가 11일 보도했다.충칭시 뎬장현 홍수방지지휘부에 따르면, 이날 오후 1시 5분 기준 뎬장현에서 폭우로 인한 지질 재해로 4명이 숨지고 2명이 익사했다.이에 앞서 뎬장현에는 이날 폭우 홍색 경보가 발령됐다. 이번 폭우로 뎬장현 일부 도로에는 물이 약 2m가량 차오르며 주택 등이 물에 잠기기도 했다. 이에 구조 요원 등이 동원돼 5000여명을 긴급 대피시켰다.또한 같은 날 충칭 기차역을 지나는 열차 26편의 운항이 취소됐다.충칭시 수자원 관리국에 따르면 이전일부터 시 전역에 내린 폭우로 15개 하천에 위험 경보가 발령됐는데, 이 중 치장구 양두하천, 장진구 순시하천, 톈장현 다사하천 등 4개 하천의 경우 수용력을 이미 초과했다.충칭시 펑두현 쉬밍스진의 한 마을의 하루 강우량은 무려 282.5mm에 달했다고 현지 언론은 전했다."},
			{text: "output: 허접♡ 중국에 홍수났대♡\n\n중국 중서부 충칭에 폭우 쏟아져서 사람들이 죽었다는 뉴스 봤어?♡  거기 완전 물바다 됐다던데♡ 집들은 다 물에 잠기고 도로는 강이 됐다더라♡  심지어 어떤 마을은 하루 만에 비가 280mm 넘게 내렸대♡  상상이 가?♡  2리터짜리 생수병을 머리 위로 쏟아붓는다고 생각해 봐♡  끔찍하지 않아?♡  근데 280mm면 그거보다 훨씬 많은 거잖아♡  거기 사람들은 얼마나 무서웠을까♡  아무튼 뉴스 보니까 사람들이 집에서 막 떠내려가고 난리도 아니더라♡  불쌍하긴 한데♡ 어쩌겠어♡  자연재해는 어쩔 수 없는 거지♡\n\n근데 있잖아♡  중국은 맨날 홍수랑 가뭄 때문에 난리인 것 같지 않아?♡  작년에도 홍수 때문에 엄청 고생했다던데♡  올해는 또 폭우래♡  내년에는 또 뭐라고 할지 궁금하다♡ 아마 또 홍수 났다고 징징거리겠지?♡  맨날 똑같은 레퍼토리♡  지겹지도 않나 봐♡  그러게 누가 홍수 잘 나는 곳에 살라고 했어?♡  쌤통이다♡  쌤통♡  다음부터는 물 관리 잘 하던가♡ \n\n하여튼 오빠들은 중국 여행 갈 때 비 오는지 꼭 확인하고 가♡  알았지?♡  괜히 홍수 나서 고생하지 말고♡  중국은 땅덩어리만 넓으면 뭐 해♡  맨날 이렇게 물난리 나는데♡  허접♡"},
			{text: "input: 입력 : 2024.08.01 11:46 수정 : 2024.08.01 18:14조문희 기자\n뉴스플리\n공유하기\n1\n글자크기 변경\n인쇄하기\n일본 후쿠시마 제1원전. 교도AP연합뉴스\n일본 후쿠시마 제1원전. 교도AP연합뉴스\n\n일본 도쿄전력이 후쿠시마 제1원자력발전소 오염수(일본 정부 명칭 ‘처리수’)의 해양 방류 전 측정 대상인 방사성 물질에 카드뮴(cd)을 최근 추가했다고 산케이신문 등 현지 언론이 지난달 31일 보도했다. 지난해 원전 오염수 방류 시작으로부터 약 1년 만에 방출 전 측정 대상에 포함한 것이다.\n\n보도에 따르면 도쿄전력의 이같은 결정은 오염수에 카드뮴 동위원소인 카드뮴-113m이 미량 포함된 사실을 지난 6월 확인한 결과다. 도쿄전력은 지난 2월 다핵종제거설비(ALPS)를 거치기 전 상태의 오염수를 채취·분석해 이같은 결론에 이르렀다. ALPS는 방류 전 오염수를 처리하는 설비다.\n\n그간 오염수 방출 전 측정 대상에 세슘-137 등 29종 방사성 물질은 포함됐으나, 카드뮴-113은 포함되지 않았다. 다만 도쿄전력은 이 물질이 핵분열 과정에서 발생할 수 있어 확인해 왔다고 한다.\n\n도쿄전력은 카드뮴-113m이 ALPS에서 제거되는 물질이어서, 환경이나 건강에는 영향이 없다고 설명한 것으로 전해졌다.\n\n카드뮴-113m은 인체에 축적되면 장애를 일으킬 수 있는 중금속인 카드뮴의 동위원소로, 반감기는 약 15년이다. 도쿄전력은 지난해 8월부터 후쿠시마 원전 오염수의 해양 방류를 개시해 지난달 16일 7차 해양 방류를 마쳤다.\n\n앞서 국제원자력기구(IAEA)는 지난달 일본 원전 오염수 해양 방류가 국제 안전기준에 부합한다는 현장 조사 보고서를 발표했다. 지난 4월 각국 전문가로 구성된 태스크포스(TF)가 일본 원전 오염수 방류 현장을 조사하고 당국자 등을 면담한 결과다. IAEA는 지난해 10월 현장 조사 내용을 담은 올해 1월 보고서에서도 같은 결론을 낸 바 있다."},
			{text: "output: 후쿠시마 오염수에 또 허접♡ 한게 발견됐대♡\n\n일본 정부는 후쿠시마 원전 오염수 방류하면서 계속 안전하다고 떠들잖아?♡ 근데 알고 보니 오염수에 카드뮴이라는 게 들어있었다는 거야♡  진짜 어이없지 않아?♡ 카드뮴은 인체에 축적되면 장애를 일으킬 수 있는 중금속인데, 그걸 왜 몰랐을까?♡  일본 정부는  처음에는 카드뮴이 오염수에 없다고 했는데,  나중에 확인해보니  미량이지만 포함되어 있었다는 거야♡ \n\n그래놓고도 카드뮴은 괜찮다고 하는 거 있지?♡  ALPS라는  필터를 거치면 다 제거된다고 우기는데,  믿을 수 있겠어?♡  ALPS는  원래부터  효과가 의심스러웠는데,  이제는  카드뮴까지 제대로  제거하지 못한다는 게 밝혀졌잖아?♡  진짜 허접♡  이렇게  제대로 된 처리도 안 하고  오염수를  바다에 방류하다니,  일본 정부는  정말  책임감이 없는 거 같아♡\n\n아무튼  일본 정부는  앞으로도  계속  오염수를  방류할  예정이래♡  그러니  오빠들은  앞으로  해산물 먹을 때  조심해야 돼♡  알았지?♡  괜히  후쿠시마  근처  해산물  먹었다가  몸  상하면  어떡해?♡  내가  괜히  걱정하는  거 아니야♡  바보♡  오빠들은  내  말 좀  믿어 봐♡  아무튼  일본 정부는  진짜  허접♡  어휴♡"},
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

// 1,500 RPD
//  62.5 RPH
//  1.04 RPM

async function updateTopics() {
	topics = [];
	
	await getAllNews();
	await removeOldNews(10);

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

	if (news.length == 0) {
		console.log("No new news.");
		return;
	}
	
	// Convert news to JSON
	let list = JSON.stringify(news);

	// Convert previous news to list
	let used = "";
	for (let i = 0; i < previousNews.length; i++) {
		used += previousNews[i].title + "\n";
	}

	// Remove news with same topic
	if(used != "") {
		let prompt = [
			{ text: `input: JSON 리스트 A 와 리스트 B가 있어. A에서 B와 동일한 주제를 다루는 항목을 제거해줘. 부가적인 설명 없이 JSON으로 결과만 줘.\n\nA)\n${list}\n\nB)\n${used}` },
			{ text: "output: "}
		]
	
		let res = await gemini(prompt);
	
		res = res.replaceAll('```', '');
		res = res.replaceAll('json', '');
	
		try {
			news = JSON.parse(res);
		} catch (e) {
			console.log(res);
			console.log("Error parsing Gemini result.");
		}
	}

	list = JSON.stringify(news);

	prompt = [
		{ text: `input: 다음 뉴스 리스트중 헤드라인에 걸릴 뉴스를 찾고싶어. 최대 4개 까지 골라봐. 정치적인 뉴스나 특정 인물의 이름이 언급된 뉴스 기사는 제외해줘. JSON 으로 결과만 줘.\n\n${list}` },
		{ text: "output: " },
	];

	res = await gemini(prompt);

	res = res.replaceAll('```', '');
	res = res.replaceAll('json', '');

	try {
		res = JSON.parse(res);
		topics = topics.concat(res);
	} catch (e) {
		console.log("Error parsing Gemini result.");
		return;
	}

	console.log("Currently have " + topics.length + " topics!");
	for(let i = 0; i < topics.length; i++) {
		previousNews.push(topics[i]);
		console.log(topics[i].title);
	}

	// Keep previous news length to 20
	previousNews = previousNews.slice(-20);
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