currentOffset = 10;

addEventListener('DOMContentLoaded', () => {
	updateList(0, 10, true);
});

async function updateList(start, size, emptyWhenUpdate = false) {
	let response = await fetch(`${host}/api/list`, {
		method: 'POST',
		body: JSON.stringify({ start: start, size: size }),
		headers: {
			'Content-Type': 'application/json'
		}
	});

	let data = await response.json();

	let list = document.getElementById('list');
	if (emptyWhenUpdate) {
		list.innerHTML = "";
	}

	for(let item of data) {
		let title = cleanTitle(item.title);
		let date = item.date;
		date = getDateString(date);
		let id = item.id;

		let article = createItem(title, date, id, item.comment);
		list.appendChild(article);
	}

	if (data.length == 10) {
		list.appendChild(createMore());
	}
}

function cleanTitle(title) {
	title = title.replaceAll('<h3>', '');
	title = title.replaceAll('</h3>', '');
	title = title.replaceAll('*', '');

	return title;
}

function createMore() {
	let more = document.createElement('div');
	more.classList.add('more');
	more.textContent = '기사 더보기 ⏷';

	more.addEventListener('click', async () => {
		
		more.textContent = '로딩중...';
		await updateList(currentOffset, 10);
		currentOffset += 10;
		more.remove();
	}, { once: true });

	return more;
}

function createItem(title_text, date_text, id, comment_num) {
	let item = document.createElement('div');
	item.classList.add('article');

	let title = document.createElement('h2');
	title.textContent = title_text;
	title.innerHTML += `<span>[${comment_num}]</span>`;
	item.appendChild(title);

	let date = document.createElement('h3');
	date.textContent = date_text;
	item.appendChild(date);

	if (window.localStorage.getItem(`read_${id}`)) {
		item.classList.add('read');
	}

	item.addEventListener('click', () => {
		item.classList.add('read');
		window.localStorage.setItem(`read_${id}`, true);
		location.href = `/article/${id}`;
	});

	return item;
}