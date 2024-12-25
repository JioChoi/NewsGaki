const frames = 479;
let startAnime = false;
let i = 0;

let data = [];

window.addEventListener('load', async () => {
	document.body.classList.add('noscroll');
	let [text, day, encrypted, newdata] = await getDaily();

	if (newdata == undefined) {
		document.getElementById("checkmsg").style.display = 'none';
	}

	document.body.classList.remove('noscroll');
	document.getElementById('main_loading').style.display = 'none';
});

function spawnBgHeart() {
	let heart = document.createElement('span');
	heart.innerHTML = '♡';

	let size = Math.floor(Math.random() * 20 + 15);
	let x = Math.random() * 100;

	heart.style.left = `${x}%`;
	heart.style.fontSize = `${size}px`;

	document.getElementById('loading_bg').appendChild(heart);
}

async function sakiIn() {
	document.getElementById('loadbar').style.backgroundImage = 'linear-gradient(90deg, #FF5782 0%, #ECECEC 0)'
	document.getElementById('daily_loading').style.display = 'flex';
	document.body.classList.add('noscroll');

	let loadstart = new Date().getTime();

	let [text, day, encrypted] = await getDaily();

	document.getElementById("checkmsg").style.display = 'none';
	document.getElementById('day').textContent = `${day}일차`;

	await loadAssets();

	if (new Date().getTime() - loadstart < 1000) {
		await new Promise((resolve, reject) => {
			setTimeout(() => {
				resolve();
			}, 1000 - (new Date().getTime() - loadstart));
		});
	}

	document.getElementById('daily_loading').style.opacity = 0;
	document.getElementById('daily_loading').style.animation = 'loadinghide 0.3s ease-out';
	await new Promise((resolve, reject) => {
		setTimeout(() => {
			document.getElementById('daily_loading').style.display = 'none';
			document.getElementById('daily_loading').style.animation = 'loadingshow 0.5s ease-out';
			document.getElementById('daily_loading').style.opacity = 1;
			document.getElementById('loadbar').style.backgroundImage = 'linear-gradient(90deg, #FF5782 0%, #ECECEC 0)'
			resolve();
		}, 300);
	});

	// Loaded
	document.getElementById('daily').style.display = 'flex';
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

		localStorage.setItem('daily', encrypted);
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
}

function sakiOut() {
	document.getElementById('msg').classList.remove('in');

	setTimeout(() => {
		// Remove saki character
		document.getElementById('saki_panel').className = "out";

		setTimeout(() => {
			// Remove saki msg box
			document.getElementById('saki').style.opacity = 0;
			setTimeout(() => {
				// Everything is gone, now reset
				document.getElementById('saki').style.display = 'none';
				document.body.classList.remove('noscroll');

				document.getElementById('saki_panel').classList.remove('out');
				document.getElementById('saki').style.opacity = 1;

				// Unload assets
				for(let i = 0; i < frames; i++) {
					data[i].src = "";
					data[i] = null;
				}
				data = [];
			}, 500);
		}, 300);
	}, 400);
}

async function waitInput (controller = new AbortController()) {
	return new Promise((resolve, reject) => {
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

	let interval;

	await new Promise((resolve, reject) => {
		setTimeout(() => {
			resolve();
		}, 100);
	});

	return new Promise(async (resolve, reject) => {
		const controller = new AbortController();

		interval = setInterval(() => {
			if (i < text.length) {
				msg.textContent += text.charAt(i);
				i++;
			} else {
				controller.abort();
				msg.innerHTML += "<span class='arrowDown'> ⏷</span>";
				clearInterval(interval);
				resolve();
			}
		}, speed);

		await waitInput(controller);
		clearInterval(interval);
		msg.innerHTML = text + "<span class='arrowDown'> ⏷</span>";
		await new Promise((resolve, reject) => {
			setTimeout(() => {
				resolve();
			}, 100);
		});
		resolve();
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
			let percent = Math.floor(Math.pow(loaded / frames, 2) * 100);
			document.getElementById('loadbar').style.backgroundImage = `linear-gradient(90deg, #FF5782 ${percent}%, #ECECEC 0)`;
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

	return [response.text, response.day + 1, response.encrypted, response.newdata];
}