let id = null;

window.onbeforeunload = function () {
	window.scrollTo(0, 0);
}

document.addEventListener('DOMContentLoaded', async () => {
	// Rendom comment
	if (Math.random() * 50 == 1) {
		document.getElementById('edit').value = "히잡♡"
	}

	console.log("DOM LOADED!!!");
	id = window.location.pathname.split('/')[2];

	let date = new Date(Number(document.getElementById('date').innerText));
	document.getElementById('date').innerText = getDateString(Number(document.getElementById('date').innerText));

	loadComments();

	document.getElementById('url').addEventListener('click', () => {
		navigator.clipboard.writeText(url.innerText);
		alert('게시글 주소가 복사되었습니다.');
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

function report() {
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
}

function share() {
	if (!navigator.share) {
		navigator.clipboard.writeText(url.innerText);
		alert('게시글 주소가 복사되었습니다.');
		return;
	}

	window.navigator.share({
		title: document.getElementById('title').innerText,
		url: window.location.href
	});
}

function capture() {
	let element = document.createElement('div');
	element.appendChild(document.getElementsByClassName('header')[0].cloneNode(true));
	
	let content = document.getElementById('content').cloneNode(true);
	content.querySelector('.reaction').remove();
	content.style.border = 'none';
	content.style.margin = '0px';
	let img = content.querySelector('img');
	img.style.backgroundImage = `url(${img.src})`;
	img.style.backgroundSize = 'cover';
	img.style.backgroundPosition = 'center';
	img.src = 'https://newsgaki.com/assets/empty.png';

	element.appendChild(content);
	
	element.style.position = 'absolute';
	element.style.top = '0px';
	element.style.left = '0px';
	element.style.zIndex = '-1';

	element.style.width = '450px';

	document.body.prepend(element);

	html2canvas(element, {
		scale: 2,
		proxy: `${host}/api/proxy`
	}).then(canvas => {
		let link = document.createElement('a');
		link.download = `뉴스가키 - ${document.getElementById('title').innerText}.png`;

		element.remove();

		link.href = canvas.toDataURL('image/png');
		link.click();
	});
}