const { parentPort, workerData } = require("worker_threads");
const yts = require("yt-search");

yts(workerData.query)
  .then((res) => {
    parentPort.postMessage({ success: true, data: res });
  })
  .catch((err) => {
    parentPort.postMessage({ success: false, error: err.message });
  });
