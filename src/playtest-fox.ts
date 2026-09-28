import { simulateGame } from "./playtest-engine";
import type { RoleName, Winner } from "./types";

const trials = Number(process.env.TOMATOBOT_FOX_TRIALS ?? 2000);
if (!Number.isInteger(trials) || trials <= 0) {
  throw new Error("TOMATOBOT_FOX_TRIALSは1以上の整数にしてください。");
}

// 総人数・人間プレイヤー数・人狼数・その他の基本役は固定。
// 2妖狐側だけ村人1人を妖狐に置き換え、同じ乱数種を使用する。
const oneFox: RoleName[] = [
  "人狼",
  "狂人",
  "占い師",
  "騎士",
  "霊能者",
  "妖狐",
  "村人",
  "村人",
  "村人",
  "村人",
];
const twoFox: RoleName[] = [...oneFox.slice(0, -1), "妖狐"];

function measure(roles: RoleName[]): {
  wins: Record<Winner, number>;
  timeouts: number;
} {
  const wins: Record<Winner, number> = {
    villager: 0,
    wolf: 0,
    fox: 0,
    lovers: 0,
    teruteru: 0,
  };
  let timeouts = 0;
  for (let index = 0; index < trials; index += 1) {
    const result = simulateGame(roles, 12_345 + index * 97, 2);
    wins[result.winner] += 1;
    if (result.timedOut) timeouts += 1;
  }
  return { wins, timeouts };
}

console.log(`妖狐比較｜10人・人間2人・各${trials}試合`);
for (const [label, roles] of [
  ["妖狐1", oneFox],
  ["妖狐2", twoFox],
] as const) {
  const { wins, timeouts } = measure(roles);
  console.log(
    `${label}｜妖狐 ${((wins.fox / trials) * 100).toFixed(1)}% (${wins.fox})｜人狼 ${((wins.wolf / trials) * 100).toFixed(1)}% (${wins.wolf})｜村人 ${((wins.villager / trials) * 100).toFixed(1)}% (${wins.villager})｜20日超過 ${timeouts}`,
  );
}
console.log(
  "注意: NPCと人間操作を近似した自動対戦です。本番利用者の勝率予測ではありません。",
);
