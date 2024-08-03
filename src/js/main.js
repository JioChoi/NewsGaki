const frames = 479;
let startAnime = false;
let i = 0;

let data = [];

window.addEventListener('DOMContentLoaded', async function() {
	document.body.classList.add('noscroll');
	let [text, day] = await getDaily();

	document.getElementById('day').textContent = `${day}일차`;

	if (text == "" || text == undefined) {
		document.body.classList.remove('noscroll');
		document.getElementById('main_loading').style.display = 'none';
		return;
	}

	console.log(text);
	await loadAssets();

	// Loaded
	document.getElementById('main_loading').style.display = 'none';
	document.getElementById('saki').style.display = 'flex';

	document.getElementById('daily').classList.add('in');

	setTimeout(() => {
		document.getElementById('daily').style.display = 'none';
		document.getElementById('saki_panel').classList.add('in');
	}, 1500 + 100);

	setTimeout(async () => {
		document.getElementById('msg').classList.add('in');

		for(let i = 0; i < text.length; i++) {
			await typeWriter(text[i], 60);
			await waitInput();
		}

		sakiOut();
		clearInterval(interval);
	}, 1500 + 100 + 400);

	let interval = setInterval(() => {
		if (startAnime) {
			const canvas = document.getElementById('saki_panel');
			const ctx = canvas.getContext('2d');
			const f = frames - Math.abs((frames - 1) - i) - 1;

			canvas.width = 752;
			canvas.height = 1360;
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(data[f], 0, 0, canvas.width, canvas.height);

			i++;
			if (i >= frames * 2 - 2) {
				i = 0;
			}
		}
	}, 1000 / 50);
});

function sakiOut() {
	document.getElementById('msg').classList.remove('in');

	setTimeout(() => {
		document.getElementById('saki_panel').className = "out";

		setTimeout(() => {
			document.getElementById('saki').style.opacity = 0;
			setTimeout(() => {
				document.getElementById('saki').style.display = 'none';
				document.body.classList.remove('noscroll');
			}, 500);
		}, 300);
	}, 400);
}

async function waitInput () {
	return new Promise((resolve, reject) => {
		const controller = new AbortController();

		window.addEventListener('click', () => {
			controller.abort();
			resolve();
		}, { signal: controller.signal });

		window.addEventListener('keydown', (e) => {
			if(e.key == 'Enter') {
				controller.abort();
				resolve();
			}
		}, { signal: controller.signal });

		window.addEventListener('touchend', () => {
			controller.abort();
			resolve();
		}, { signal: controller.signal });
	});
}

async function typeWriter(text, speed) {
	let i = 0;
	let msg = document.getElementById('msg');
	msg.textContent = "";

	return new Promise((resolve, reject) => {
		const interval = setInterval(() => {
			if (i < text.length) {
				msg.textContent += text.charAt(i);
				i++;
			} else {
				msg.innerHTML += "<span class='arrowDown'> ⏷</span>";
				clearInterval(interval);
				resolve();
			}
		}, speed);
	});
}

async function loadAssets() {
	data = [];
	let loaded = 0;

	for(let i = 0; i < frames; i++) {
		let img = new Image();
		img.src = `https://huggingface.co/Jio7/NewsGaki/resolve/main/${i+1}.webp`;
		data.push(img);

		img.onload = () => {
			loaded++;
		}
	}

	return new Promise((resolve, reject) => {
		const interval = setInterval(() => {
			if(loaded >= frames && listLoaded) {
				startAnime = true;
				clearInterval(interval);
				resolve();
			}
		}, 100);
	});
}

async function getDaily() {
	let daily = localStorage.getItem('daily');
	if (daily == null || daily == undefined) {
		daily = "";
	}

	let response = await fetch('/daily', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ data: daily })
	});

	response = await response.json();

	if(response.encrypted == undefined) {
		return "";
	}

	localStorage.setItem('daily', response.encrypted);
	return [response.text, response.day + 1]
}