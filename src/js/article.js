let id = null;

window.onbeforeunload = function () {
	window.scrollTo(0, 0);
}

document.addEventListener('DOMContentLoaded', async () => {
	id = new URLSearchParams(location.search).get('id');

	if (!id || id.length != 10) {
		location.href = '/';
		return;
	}

	let response = await fetch(`${host}/api/article/${id}`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json'
		}
	});

	response = await response.json();
	writeContent(response);
	loadComments();

	document.getElementById('like').addEventListener('click', async () => {
		alert('추천했습니다.');
		if (window.localStorage.getItem(id) == 'true') {
			alert('이미 반응하셨습니다.')
			return;
		}

		window.localStorage.setItem(id, 'true');

		let response = await fetch(`${host}/api/react`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				id: id,
				reaction: 'like'
			})
		});
		response = await response.json();
		document.getElementById('like_count').innerText = response.likes;
	});

	document.getElementById('dislike').addEventListener('click', async () => {
		alert('비추천했습니다.');
		if (window.localStorage.getItem(id) == 'true') {
			alert('이미 반응하셨습니다.')
			return;
		}
		
		window.localStorage.setItem(id, 'true');

		let response = await fetch(`${host}/api/react`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				id: id,
				reaction: 'dislike'
			})
		});
		response = await response.json();
		document.getElementById('dislike_count').innerText = response.dislikes;
	});

	document.getElementById('edit').addEventListener('input', () => {
		document.getElementById('edit').style.height = 'auto';
		document.getElementById('edit').style.height = document.getElementById('edit').scrollHeight - 20 + 'px';
	});
});

/*
<h1 id="title"></h1>
<h3 id="date"></h3>
<img id="img" src="">
<h4>(기사 속 사건과 관련 없음)</h4>
*/

async function loadComments() {
	let response = await fetch(`${host}/api/comments/${id}`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json'
		}
	});

	response = await response.json();
	document.getElementById('comment_num').innerText = response.length;

	response.forEach((comment) => {
		addComment(comment.name, comment.comment);
	});

}

function writeContent(response) {
	let title = document.createElement('h1');
	title.innerText = response.title;

	let date = document.createElement('h3');
	date.innerText = getDateString(response.date);

	let img = document.createElement('img');
	img.src = response.img;

	let content = document.getElementById('content');
	let data = response.article;

	let h4 = document.createElement('h4');
	h4.innerText = "(기사 속 사건과 관련 없음)";

	let h5 = document.createElement('h5');
	h5.innerHTML = "해당 기사는 AI 기자 <strong>뉴스가키</strong>가 작성하였습니다.";

	// Remove first children
	content.removeChild(content.firstElementChild);

	data += '\n';

	content.prepend(h5);

	let buffer = "";
	for (let i = 0; i < data.length; i++) {
		let char = data[i];

		if (char == '\n' && buffer.length > 1) {
			let p = document.createElement('p');
			p.innerHTML = buffer;
			content.insertBefore(p, h5);
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

	content.prepend(h4);
	content.prepend(img);
	content.prepend(date);
	content.prepend(title);

	document.getElementById('like_count').innerText = response.likes;
	document.getElementById('dislike_count').innerText = response.dislikes;
}

function heart(hearts) {
	let ele = document.createElement('span');
	ele.innerText = '♥️';
	ele.classList.add('heart');
	ele.classList.add("animate");

	let rect = hearts.getBoundingClientRect();

	ele.style.top = rect.top + 'px';
	ele.style.left = rect.left + 'px';

	let int = setInterval(() => {
		let rand = Math.random() * 30 - 15;
		ele.style.left = rect.left + rand + 'px';
	}, 100);
	
	setTimeout(() => {
		clearInterval(int);
		ele.remove();
	}, 1000);

	document.body.prepend(ele);
}

function addComment(name, value) {
	let div = document.createElement('div');
	div.classList.add('item');

	let h3 = document.createElement('h3');
	h3.innerText = name;

	let p = document.createElement('p');
	p.innerText = value;

	div.appendChild(h3);
	div.appendChild(p);
	
	document.getElementById("comments").appendChild(div);
}

function submit() {
	let comment = document.getElementById('edit').value.trim();
	if (comment.length < 1) {
		alert('내용을 입력해주세요.');
		return;
	}

	alert('댓글을 작성했습니다.');
	document.getElementById('edit').value = '';

	addComment("익명", comment);
}