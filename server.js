import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_PATH = process.env.GITHUB_PATH || "licenses.json";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "master";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

// === Middleware for API key authentication ===
function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key || key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// === Root endpoint (for testing server online) ===
app.get("/", (req, res) => {
  res.send("✅ Backend is running");
});

// === Helper: Fetch file from GitHub ===
async function getFile() {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${GITHUB_TOKEN}` }
  });
  if (!res.ok) throw new Error(`GitHub fetch failed: ${res.statusText}`);
  const data = await res.json();
  const content = Buffer.from(data.content, "base64").toString("utf8");
  return { obj: JSON.parse(content), sha: data.sha };
}

// === Helper: Save file back to GitHub ===
async function saveFile(obj, sha) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`;
  const content = Buffer.from(JSON.stringify(obj, null, 2)).toString("base64");
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: "Update licenses.json",
      content,
      sha,
      branch: GITHUB_BRANCH
    })
  });
  if (!res.ok) throw new Error(`GitHub save failed: ${res.statusText}`);
  return res.json();
}

// === Get all licenses ===
app.get("/api/all", requireApiKey, async (req, res) => {
  try {
    const { obj } = await getFile();
    res.json(obj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Check license by HWID ===
app.get("/api/license/:hwid", requireApiKey, async (req, res) => {
  try {
    const hwid = req.params.hwid;
    const { obj } = await getFile();

    if (!obj[hwid]) {
      return res.json({
        status: "Not Found",
        license: false,
        message: "❌ HWID not registered or not activated"
      });
    }

    const entry = obj[hwid][0];
    const expiredStr = entry.Expired;
    const [day, month, year] = expiredStr.split("-").map(Number);
    const expDate = new Date(year, month - 1, day);
    const now = new Date();

    if (!entry.Login) {
      return res.json({
        status: "Deactivated",
        license: false,
        name: entry.Name,
        expired: expiredStr,
        message: "❌ License has been deactivated by admin"
      });
    }

    if (expDate < now) {
      return res.json({
        status: "Expired",
        license: false,
        name: entry.Name,
        expired: expiredStr,
        message: "❌ License has expired, please renew"
      });
    }

    return res.json({
      status: "Active",
      license: true,
      name: entry.Name,
      expired: expiredStr,
      message: "✅ License is valid, application can run"
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Activate license ===
app.post("/api/activate", requireApiKey, async (req, res) => {
  try {
    const { hwid, host, name, expired, verify } = req.body;

    if (!hwid || !expired) {
      return res.status(400).json({ error: "HWID and Expired are required" });
    }

    const { obj, sha } = await getFile();

    const newEntry = [{
      Host: host || "Unknown-PC",
      HwID: hwid,
      Login: true,
      Name: name || "Unknown User",
      Verify: verify || 1,
      Expired: expired
    }];

    obj[hwid] = newEntry;
    await saveFile(obj, sha);

    res.json({
      status: "Success",
      license: true,
      message: `✅ License for HWID ${hwid} has been activated`,
      hwid,
      expired
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Deactivate license ===
app.post("/api/deactivate", requireApiKey, async (req, res) => {
  try {
    const { hwid } = req.body;

    if (!hwid) {
      return res.status(400).json({ error: "HWID is required" });
    }

    const { obj, sha } = await getFile();

    if (!obj[hwid]) {
      return res.status(404).json({
        status: "Not Found",
        license: false,
        message: `❌ HWID ${hwid} not found`
      });
    }

    obj[hwid][0].Login = false;
    await saveFile(obj, sha);

    res.json({
      status: "Success",
      license: false,
      message: `❌ License for HWID ${hwid} has been deactivated`,
      hwid
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Update license ===
app.post("/api/edit", requireApiKey, async (req, res) => {
  try {
    const { hwid, name, host, expired, verify } = req.body;
    if (!hwid) return res.status(400).json({ error: "HWID is required" });

    const { obj, sha } = await getFile();
    if (!obj[hwid]) return res.status(404).json({ error: "HWID not found" });

    obj[hwid][0].Name = name || obj[hwid][0].Name;
    obj[hwid][0].Host = host || obj[hwid][0].Host;
    obj[hwid][0].Expired = expired || obj[hwid][0].Expired;
    obj[hwid][0].Verify = verify ?? obj[hwid][0].Verify;

    await saveFile(obj, sha);
    res.json({ status: "Success", message: `✅ HWID ${hwid} updated` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Delete license ===
app.post("/api/delete", requireApiKey, async (req, res) => {
  try {
    const { hwid } = req.body;
    if (!hwid) return res.status(400).json({ error: "HWID is required" });

    const { obj, sha } = await getFile();
    if (!obj[hwid]) return res.status(404).json({ error: "HWID not found" });

    delete obj[hwid];
    await saveFile(obj, sha);
    res.json({ status: "Success", message: `🗑️ HWID ${hwid} deleted` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Activation backend running on port ${port}`));
