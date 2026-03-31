const { Queue } = require("bullmq");
const connection = require("./redis");

const provisioningQueue = new Queue("erp-provisioning", { connection });

module.exports = provisioningQueue;
