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
let storedRatings = [];
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
            if (table === "users") return { async in() { return { data: storedRatings }; } };
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
  if (name === "http" && /dist[\\\\/]april[\\\\/]src[\\\\/]index\.js$/.test(args[0]?.filename ?? "")) {
    return { createServer(handler) {
      health = handler;
      return { listen(_port, cb) { cb(); } };
    } };
  }
  return load.call(this, name, ...args);
};
net.Socket.prototype.connect = function () { assert.fail("Network connection attempted"); };

(async () => {
  require("./dist/april/src/index.js");
  assert.ok(client && readyCallback && health);
  await readyCallback();
  assert.deepEqual(registered, ["jinro", "stats", "ranking", "reset", "preset"]);
  assert.deepEqual(jobs, []);
  assert.deepEqual(reads.sort(), ["match_players", "matches", "presets", "system_settings", "users"]);
  assert.deepEqual(writes, []);
  await health({}, {
    writeHead(status) { assert.equal(status, 200); },
    end(body) { assert.equal(body, "JinroBot legacy b2c12fa / rating 33011bd ready"); },
  });
  await health({ url: "/api/rankings", method: "GET" }, {
    setHeader() {},
    writeHead(status) { assert.equal(status, 200); },
    end(body) { assert.deepEqual(JSON.parse(body).rankings, { solo: [], friends: [] }); },
  });

  const { games, createEmptyState } = require("./dist/april/src/state.js");
  const { offerGhostBet } = require("./dist/april/src/phase.js");
  const { handleInteraction } = require("./dist/april/src/gameLogic.js");
  const { predictRatingChange, saveGameResults } = require("./dist/april/src/db.js");
  const { getNpcVoteTarget } = require("./dist/april/src/npcLogic.js");
  const npc = { id: "npc-1", role: "占い師", isNpc: true, alive: true };
  const wolf = { id: "npc-2", role: "人狼", isNpc: true, alive: true };
  const voteGame = createEmptyState();
  voteGame.players = [npc, wolf];
  voteGame.evidence = [{ from: npc.id, target: wolf.id, type: "divine", result: true, visible: false }];
  assert.deepEqual(getNpcVoteTarget(npc, voteGame), { targetId: wolf.id, reasonType: "black" });
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
  const rating = (team, people, stats, isRanked = true) => predictRatingChange(team, people, [], { isRanked }, null, stats);
  Math.random = () => 0;
  const low = await rating("villager", [{ ...winner, ghostBet: undefined }, loser], {});
  Math.random = () => 0.99;
  const high = await rating("villager", [{ ...winner, ghostBet: undefined }, loser], {});
  assert.equal(low[winner.id], 26);
  assert.equal(high[winner.id], 30);
  Math.random = () => 0.5;
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
  storedRatings = [{ id: winner.id, rate: 1712, streak: 4 }, { id: loser.id, rate: 1665, streak: 1 }];
  const existing = Object.fromEntries(storedRatings.map(row => [row.id, row]));
  const expected = await rating("villager", game.players, existing);
  const withoutBet = await rating("villager", [winner, loser], existing);
  assert.equal(expected[loser.id] - withoutBet[loser.id], 12);
  assert.deepEqual((await saveGameResults(game, "villager", null)).deltas, expected);
  assert.deepEqual(writes.map(({ table }) => table), ["matches", "users", "match_players"]);
  assert.equal(writes[1].rows[0].rate, 1712 + expected[winner.id]);
  assert.equal(writes[2].rows[0].rate_delta, expected[winner.id]);
  console.log("PASS: April Rust NPC vote, May rating and ghost-bet rules, existing ratings, and no TP.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
