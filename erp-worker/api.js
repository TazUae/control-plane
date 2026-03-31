const Fastify = require("fastify");
const { Queue } = require("bullmq");
const connection = require("./redis");
const db = require("./db");

const app = Fastify({ logger: true });

const queue = new Queue("erp-provisioning", { connection });

// POST /provision
app.post("/provision", async (req, reply) => {
  const { site } = req.body;

  if (!site) {
    return reply.status(400).send({ error: "site is required" });
  }

  const res = await db.query(
    "INSERT INTO jobs(site,status) VALUES($1,$2) RETURNING id",
    [site, "queued"]
  );

  const jobId = res.rows[0].id;

  await queue.add("provision", { site });

  return {
    jobId,
    status: "queued",
    site,
  };
});

// GET /jobs/:id
app.get("/jobs/:id", async (req, reply) => {
  const { id } = req.params;

  const res = await db.query(
    "SELECT * FROM jobs WHERE id=$1",
    [id]
  );

  if (res.rows.length === 0) {
    return reply.status(404).send({ error: "job not found" });
  }

  return res.rows[0];
});

app.listen({ port: 4000, host: "0.0.0.0" }, () => {
  console.log("🚀 Control Plane API running on :4000");
});
