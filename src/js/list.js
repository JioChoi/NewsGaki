currentOffset = 10;
listLoaded = false;

addEventListener('DOMContentLoaded', async () => {
	await updateList(0, 3, "popular", true);
	await updateList(0, 10, "new", true);
	listLoaded = true;
});

async function updateList(start, size, list_id, emptyWhenUpdate = false) {
	if (!document.getElementById(list_id)) {
		return;
	}

	let url = "";
	let title = "";
	switch(list_id) {
		case "popular":
			url = `${host}/api/list`;
			title = "인기 뉴스";
			break;
		case "new":
			url = `${host}/api/list`;
			title = "최신 뉴스";
			break;
	}

	let response = await fetch(url, {
		method: 'POST',
		body: JSON.stringify({ order: list_id, start: start, size: size }),
		headers: {
			'Content-Type': 'application/json'
		}
	});

	let data = await response.json();

	let list = document.getElementById(list_id);
	if (emptyWhenUpdate) {
		list.innerHTML = "";

		let header = document.createElement('h1');
		header.textContent = title;
		list.appendChild(header);
	}

	for (let item of data) {
		let title = cleanTitle(item.title);
		let date = item.date;

		// Seven days
		let now = new Date().getTime();
		if (now - date < 1000 * 60 * 60 * 24 * 7) {
			let diff = now - date;
			let days = Math.floor(diff / (1000 * 60 * 60 * 24));
			let hours = Math.floor(diff / (1000 * 60 * 60)) % 24;
			let minutes = Math.floor(diff / (1000 * 60)) % 60;
			let seconds = Math.floor(diff / 1000) % 60;

			if (days) {
				date = `${days}일 전`;
			}
			else if (hours) {
				date = `${hours}시간 전`;
			}
			else if (minutes) {
				date = `${minutes}분 전`;
			}
			else {
				date = `${seconds}초 전`;
			}
		}
		else {
			date = getDateString(date);
		}

		let id = item.id;

		let article = createItem(title, date, id, item.comment, item.img);
		list.appendChild(article);
	}

	if (data.length == 10) {
		list.appendChild(createMore(list_id));
	}
}

function cleanTitle(title) {
	title = title.replaceAll('<h3>', '');
	title = title.replaceAll('</h3>', '');
	title = title.replaceAll('*', '');

	return title;
}

function createMore(list_id) {
	let more = document.createElement('div');
	more.classList.add('more');
	more.textContent = '기사 더보기 ⏷';

	more.addEventListener('click', async () => {
		more.textContent = '로딩중...';
		await updateList(currentOffset, 10, list_id);
		currentOffset += 10;
		more.remove();
	}, { once: true });

	return more;
}

function createItem(title_text, date_text, id, comment_num, image) {
	let item = document.createElement('article');
	item.classList.add('article');

	let container = document.createElement('div');

	let img = document.createElement('img');
	img.src = image;
	item.appendChild(img);

	let title = document.createElement('h2');
	title.textContent = title_text;
	container.appendChild(title);

	let info = document.createElement('div');

	let date = document.createElement('h3');
	date.textContent = date_text;
	info.appendChild(date);

	let comment = document.createElement('span');
	comment.textContent = `${comment_num}`;
	info.appendChild(comment);
	container.appendChild(info);

	item.appendChild(container);

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