let host = "https://jio7-newsgaki.hf.space";
//host = "http://127.0.0.1";

document.addEventListener('DOMContentLoaded', async () => {
	document.getElementById('logo').addEventListener('click', () => {
		location.href = '/';
	});
});


function getDateString(time) {
	let date = new Date(Number(time));

	let year = date.getFullYear();
	let month = date.getMonth() + 1;
	let day = date.getDate();
	let hours = date.getHours();
	let minutes = date.getMinutes();
	let seconds = date.getSeconds();

	month = ("0" + month).slice(-2);
	day = ("0" + day).slice(-2);
	hours = ("0" + hours).slice(-2);
	minutes = ("0" + minutes).slice(-2);
	seconds = ("0" + seconds).slice(-2);

	return `${year}.${month}.${day} ${hours}:${minutes}:${seconds}`;
}