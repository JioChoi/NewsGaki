let host = "https://jio7-newsgaki.hf.space";
host = "http://127.0.0.1";

document.addEventListener('DOMContentLoaded', async () => {
	document.getElementById('logo').addEventListener('click', () => {
		location.href = '/';
	});
});

function getDateString(time) {
	let date = new Date(Number(time));

	let year = date.getUTCFullYear();
	let month = date.getUTCMonth() + 1;
	let day = date.getUTCDate();
	let hours = date.getUTCHours();
	let minutes = date.getUTCMinutes();
	let seconds = date.getUTCSeconds();

	month = ("0" + month).slice(-2);
	day = ("0" + day).slice(-2);
	hours = ("0" + hours).slice(-2);
	minutes = ("0" + minutes).slice(-2);
	seconds = ("0" + seconds).slice(-2);

	return `${year}.${month}.${day} ${hours}:${minutes}:${seconds}`;
}