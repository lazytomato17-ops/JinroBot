// Exercise the production entry point without external connections.
const assert = require("node:assert/strict");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const net = require("node:net");

for (const key of Object.keys(process.env)) {
  if (/^(DISCORD|SUPABASE|GEMINI|GROQ|RANKING_CHANNEL|GUILD_ID|RATE_TOP_ROLE)/i.test(key)) {
    delete process.env[key];
  }
}

let registered = [];
let health;
let client;
let readyCallback;
const jobs = [];
const reads = [];
const writes = [];
process.env.SUPABASE_URL = "https://offline.invalid";
process.env.SUPABASE_SECRET_KEY = "not-a-real-key";
class OfflineClient extends EventEmitter {
  constructor() {
    super();
    client = this;
    this.user = { tag: "offline-test", setActivity() {} };
    this.application = { commands: { set: async (commands) => {
      registered = commands.map((command) => command.toJSON().name);
    } } };
  }
  once(event, handler) {
    if (event === "ready") readyCallback = handler;
    return super.once(event, handler);
  }
  async login(token) { assert.equal(token, undefined); }
  isReady() { return true; }
}

const load = Module._load;
Module._load = function (name, ...args) {
  if (name === "discord.js") return { ...load.call(this, name, ...args), Client: OfflineClient };
  if (name === "dotenv") return { config() {} };
  if (name === "node-cron") return { schedule(pattern) { jobs.push(pattern); } };
  if (name === "@supabase/supabase-js") return { createClient(url, key) {
    assert.equal(url, "https://offline.invalid");
    assert.equal(key, "not-a-real-key");
    return {
      async rpc(name) { assert.equal(name, "tomatobot_public_rankings"); return { data: [] }; },
      from(table) {
        return {
          select(columns, options) {
            reads.push(table);
            if (options?.head) return { async limit() { return { error: null }; } };
            if (table === "users") return { async in() { return { data: [] }; } };
            if (table === "system_settings") return { eq() { return { async single() { return { data: { value: 1 } }; } }; } };
            assert.fail(`Unexpected read: ${table}.${columns}`);
          },
          insert(rows) {
            writes.push({ table, rows });
            if (table === "matches") return { select() { return { async single() { return { data: { id: 1 } }; } }; } };
            return Promise.resolve({ error: null });
          },
          async upsert(rows) { writes.push({ table, rows }); return { error: null }; },
        };
      },
    };
  } };
  if (name === "http" && /dist[\\\\/]legacy[\\\\/]src[\\\\/]index\.js$/.test(args[0]?.filename ?? "")) {
    return { createServer(handler) {
      health = handler;
      return { listen(_port, cb) { cb(); } };
    } };
  }
  return load.call(this, name, ...args);
};
net.Socket.prototype.connect = function () { assert.fail("Network connection attempted"); };

(async () => {
  require("./dist/legacy/src/index.js");
  assert.ok(client && readyCallback && health);
  await readyCallback();
  assert.deepEqual(registered, ["jinro", "stats", "ranking", "reset", "preset"]);
  assert.deepEqual(jobs, []);
  assert.deepEqual(reads.sort(), ["match_players", "matches", "presets", "system_settings", "users"]);
  assert.deepEqual(writes, []);
  await health({}, {
    writeHead(status) { assert.equal(status, 200); },
    end(body) { assert.match(body, /JinroBot legacy 33011bd ready/); },
  });
  await health({ url: "/api/rankings", method: "GET" }, {
    setHeader() {},
    writeHead(status) { assert.equal(status, 200); },
    end(body) { assert.deepEqual(JSON.parse(body).rankings, { solo: [], friends: [] }); },
  });

  const { games, createEmptyState } = require("./dist/legacy/src/state.js");
  const { offerGhostBet } = require("./dist/legacy/src/phase.js");
  const { handleInteraction } = require("./dist/legacy/src/gameLogic.js");
  const { predictRatingChange, saveGameResults } = require("./dist/legacy/src/db.js");
  const game = createEmptyState();
  game.state = "playing";
  game.settings.matchType = "ranked";
  let dm;
  const winner = { id: "test-villager", name: "Test villager", role: "村人", alive: false, isNpc: false, user: { async send(payload) { dm = payload; }, displayAvatarURL() { return null; } } };
  const loser = { id: "test-wolf", name: "Test wolf", role: "人狼", alive: false, isNpc: false };
  game.players = [winner, loser];
  games.set("offline", game);
  const before = Date.now();
  offerGhostBet(game, winner);
  assert.deepEqual(dm.components[0].toJSON().components.map((b) => b.custom_id), ["villager", "wolf", "other"].map((team) => `bet_${team}_${winner.betDeadline}`));
  assert.ok(winner.betDeadline >= before + 90_000 && winner.betDeadline <= Date.now() + 90_000);
  let receipt;
  await handleInteraction({
    isButton: () => true, user: { id: winner.id }, customId: "bet_villager_old",
    async reply(payload) { receipt = payload; },
  });
  assert.ok(!winner.ghostBet);
  await handleInteraction({
    isButton: () => true, user: { id: winner.id }, customId: `bet_villager_${winner.betDeadline}`,
    async reply(payload) { receipt = payload; },
  });
  assert.equal(winner.ghostBet, "villager");
  assert.equal(receipt.ephemeral, true);
  Math.random = () => 0.5;
  const rating = (team, people, stats, isRanked = true) => predictRatingChange(team, people, [], { isRanked }, null, stats);
  const baseline = await rating("villager", [{ ...winner, ghostBet: undefined }, loser], {});
  const hit = await rating("villager", [winner, { ...loser, ghostBet: "villager" }], {});
  assert.equal(hit[winner.id] - baseline[winner.id], 5);
  assert.equal(hit[loser.id], Math.min(baseline[loser.id] + 12, 3));
  const fox = { ...winner, role: "妖狐", ghostBet: "other" };
  const foxBase = await rating("fox", [{ ...fox, ghostBet: undefined }, loser], {});
  const foxHit = await rating("fox", [fox, { ...loser, ghostBet: "other" }], {});
  assert.equal(foxHit[fox.id] - foxBase[fox.id], 10);
  assert.equal(foxHit[loser.id], Math.min(foxBase[loser.id] + 20, 3));
  assert.deepEqual(await rating("villager", [winner, loser], {}, false), {});
  assert.deepEqual(Object.keys(hit).sort(), [winner.id, loser.id].sort());
  game.players = [winner, { ...loser, ghostBet: "villager" }];
  assert.deepEqual((await saveGameResults(game, "villager", null)).deltas, hit);
  assert.deepEqual(writes.map(({ table }) => table), ["matches", "users", "match_players"]);
  assert.equal(writes[1].rows[0].rate, 1500 + hit[winner.id]);
  assert.equal(writes[2].rows[0].rate_delta, hit[winner.id]);
  console.log("PASS: offline startup, read-only readiness, public ranking route, stale bet rejection, unnerfed direct ratings, no TP, and legacy database writes.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
