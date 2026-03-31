const { Worker } = require("bullmq");
const connection = require("./redis");
const ERPAdapter = require("./erpAdapter");
const db = require("./db");

const adapter = new ERPAdapter();

const steps = ["createApiUser", "healthCheck"];

async function updateJob(id, data) {
  const keys = Object.keys(data);
  const values = Object.values(data);

  const setClause = keys.map((k, i) => `${k}=$${i + 1}`).join(", ");

  await db.query(
    `UPDATE jobs SET ${setClause}, updated_at=NOW() WHERE id=$${keys.length + 1}`,
    [...values, id]
  );
}

new Worker("erp-provisioning",
  "erp-provisioning",
  async (job) => {
    const { site } = job.data;

    // create DB record
    const res = await db.query(
      "INSERT INTO jobs(site,status) VALUES($1,$2) RETURNING id",
      [site, "running"]
    );

    const jobId = res.rows[0].id;
    console.log("🧠 JOB ID:", jobId);

    const results = {};

    try {
      for (const step of steps) {
        console.log("➡️ STEP:", step);

        await updateJob(jobId, {
          current_step: step,
        });

        const output = await adapter[step](site);
        results[step] = output;

        console.log("✅ DONE:", step);
      }

      await updateJob(jobId, {
        status: "completed",
        result: results,
      });

      return results;

    } catch (err) {
      console.error("❌ ERROR:", err.message);

      await updateJob(jobId, {
        status: "failed",
        error: err.message,
      });

      throw err;
    }
  },
  {
    connection,
    concurrency: 2,
  }
);

console.log("🚀 Worker running with DB tracking...");
