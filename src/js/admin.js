let tries = 0;

let id = null;
let pw = null;

async function login() {
	id = sha256(document.getElementById('id').value);
	pw = sha256(document.getElementById('pw').value);

	tries++;
	if (tries >= 3 && tries <= 5) {
		alert('ip 차단되었습니다.');
		return;
	}
	else {
		alert('로그인 실패');
	}

	if (tries > 5) {
		let response = await fetch(`${host}/api/list`, {
			method: 'POST',
			body: JSON.stringify({ start: 0, size: 20 }),
			headers: { 'Content-Type': 'application/json' }
		});
		response = await response.json();

		let posts = document.getElementById('posts');
		for (let i = 0; i < response.length; i++) {
			let post = document.createElement('div');
			post.innerHTML = `
				<div class="post">
					<h4>${response[i].title}<h4>
					<h4>${response[i].id}<h4>
					<br>
				</div>
			`;
			posts.appendChild(post);
		}

		document.getElementById('tool').style.display = 'block';
	}
}

async function deleteArticle() {
	let aid = document.getElementById('aid').value;

	let response = await fetch(`${host}/api/delete`, {
		method: 'POST',
		body: JSON.stringify({ aid: aid, id:id, pw:pw }),
		headers: { 'Content-Type': 'application/json' }
	});
}