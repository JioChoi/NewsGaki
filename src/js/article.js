document.addEventListener('DOMContentLoaded', async () => {
	let id = window.location.pathname.split('/')[2];
	let response = await fetch(`${host}/api/article/${id}`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json'
		}
	});

	response = await response.json();

	writeContent(response);
});

/*
<h1 id="title"></h1>
<h3 id="date"></h3>
<img id="img" src="">
<h4>(기사 속 사건과 관련 없음)</h4>
*/

function writeContent(response) {
	let title = document.createElement('h1');
	title.innerText = response.title;

	let date = document.createElement('h3');
	date.innerText = new Date(Number(response.date)).toLocaleString("JA-JP").replaceAll('/', '.');

	let img = document.createElement('img');
	img.src = response.img;

	let content = document.getElementById('content');
	let data = response.article;

	content.innerHTML = "";
	content.appendChild(title);
	content.appendChild(date);
	content.appendChild(img);

	data += '\n';

	let buffer = "";
	for (let i = 0; i < data.length; i++) {
		let char = data[i];

		if (char == '\n' && buffer.length > 1) {
			let p = document.createElement('p');
			p.innerText = buffer;
			content.appendChild(p);
			buffer = "";
		}

		if (char != '\n') {
			buffer += char;
		}
	}

	let h5 = document.createElement('h5');
	h5.innerHTML = "해당 기사는 AI 기자 <strong>뉴스가키</strong>가 작성하였습니다.";
	content.appendChild(h5);
}