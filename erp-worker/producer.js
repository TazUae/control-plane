const queue = require("./queue");

(async () => {
  const site = process.argv[2] || "tenant1774780647.local";

  await queue.add(
    "provision",
    { site },
    {
      attempts: 3,          // ✅ retry per job
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  console.log("📦 Job added for:", site);
  process.exit(0);
})();
