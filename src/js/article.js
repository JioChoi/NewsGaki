let id = null;

window.onbeforeunload = function () {
	window.scrollTo(0, 0);
}

document.addEventListener('DOMContentLoaded', async () => {
	// Rendom comment
	if (Math.random() * 100 == 1) {
		document.getElementById('edit').value = "히잡♡"
	}

	console.log("DOM LOADED!!!");
	id = window.location.pathname.split('/')[2];

	loadComments();

	document.getElementById('url').addEventListener('click', () => {
		navigator.clipboard.writeText(url.innerText);
		alert('게시글 주소가 복사되었습니다.');
	});

	document.getElementById('report').addEventListener('click', () => {
		let yes = confirm('해당 게시글을 신고하시겠습니까?');
		if (yes) {
			fetch(`${host}/api/report`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					id: id
				})
			});
			alert('신고가 접수되었습니다.');
		}
	});

	document.getElementById('like').addEventListener('click', async () => {
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
	document.getElementById('comment_num').innerText = "댓글 " + response.length + "개";

	document.getElementById("comments").innerHTML = "";
	
	response.forEach((comment) => {
		addComment(comment.name, comment.comment);
	});

}

function heart(hearts) {
	let ele = document.createElement('span');
	ele.innerText = '♥';
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

	h3.style.color = `hsl(${parseInt(name.substring(0, 2), 16) / 255.0 * 360}, 70%, 50%)`;

	let p = document.createElement('p');
	p.innerText = value;

	div.appendChild(h3);
	div.appendChild(p);
	
	document.getElementById("comments").appendChild(div);
}

async function submit() {
	let comment = document.getElementById('edit').value.trim();
	if (comment.length < 1) {
		alert('내용을 입력해주세요.');
		return;
	}

	alert('댓글을 작성했습니다.');

	await fetch(`${host}/api/comment`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			id: id,
			comment: comment
		})
	});

	loadComments();

	document.getElementById('edit').value = '';
}