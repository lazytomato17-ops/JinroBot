import type {
  PublicResult,
  RoleConfig,
  RoleName,
  RoleTeam,
  Winner,
} from "./types";

export const ROLE_NAMES: RoleName[] = [
  "村人",
  "人狼",
  "狂人",
  "占い師",
  "騎士",
  "霊能者",
  "共有者",
  "検死官",
  "タフガイ",
  "逃亡者",
  "暗殺者",
  "猫又",
  "狂信者",
  "妖術師",
  "分断者",
  "妖狐",
  "キューピッド",
  "純愛者",
  "方位磁針",
  "狼憑き",
  "呪われた村人",
  "パン屋",
  "市長",
  "怪盗",
  "てるてる",
  "饒舌な人狼",
];

export const LEGACY_ROLE_NAMES: RoleName[] = ROLE_NAMES.slice(6);
export const CONFIGURABLE_ROLE_NAMES: RoleName[] = ROLE_NAMES.filter(
  (role) => role !== "村人",
);

export const STANDARD_ROLE_LIMITS = {
  狂人: 1,
  占い師: 1,
  騎士: 2,
  霊能者: 1,
  共有者: 2,
  検死官: 1,
  タフガイ: 1,
  逃亡者: 1,
  暗殺者: 1,
  猫又: 1,
  狂信者: 1,
  妖術師: 1,
  分断者: 1,
  妖狐: 1,
  キューピッド: 1,
  純愛者: 1,
  方位磁針: 1,
  狼憑き: 1,
  呪われた村人: 1,
  パン屋: 1,
  市長: 1,
  怪盗: 1,
  てるてる: 1,
  饒舌な人狼: 1,
} satisfies Partial<Record<RoleName, number>>;

export interface CustomRoleOptions {
  unrestricted?: boolean;
}

export const ROLE_INFO: Record<
  RoleName,
  { icon: string; team: RoleTeam; description: string }
> = {
  村人: {
    icon: "🧑‍🌾",
    team: "villager",
    description: "能力はありません。会話と投票で人狼を見つけてください。",
  },
  人狼: {
    icon: "🐺",
    team: "wolf",
    description: "夜に村人陣営を1人襲撃します。",
  },
  狂人: {
    icon: "🃏",
    team: "wolf",
    description:
      "人狼陣営ですが、人狼が誰かは分かりません。占い・霊能では人間と判定されます。",
  },
  占い師: {
    icon: "🔮",
    team: "villager",
    description: "夜に1人を占い、人狼かどうかを確認できます。",
  },
  騎士: {
    icon: "🛡️",
    team: "villager",
    description: "夜に1人を人狼の襲撃から守れます。同じ相手も連続で守れます。",
  },
  霊能者: {
    icon: "👻",
    team: "villager",
    description: "夜に、その日に処刑された人が人狼だったか確認できます。",
  },
  共有者: {
    icon: "🤝",
    team: "villager",
    description: "もう1人の共有者が誰か分かります。2人1組で登場します。",
  },
  検死官: {
    icon: "🩺",
    team: "villager",
    description: "朝に、その夜に死亡した人の本当の役職を確認できます。",
  },
  タフガイ: {
    icon: "💪",
    team: "villager",
    description: "人狼に襲撃されてもその朝は生存し、次の夜に力尽きます。",
  },
  逃亡者: {
    icon: "🏃",
    team: "villager",
    description: "夜に1人のもとへ逃げます。相手が人狼か襲撃対象だと死亡します。",
  },
  暗殺者: {
    icon: "🗡️",
    team: "villager",
    description: "一度だけ夜に1人を暗殺できます。村人陣営を撃つと自分も死亡します。",
  },
  猫又: {
    icon: "🐈",
    team: "villager",
    description: "死亡時に道連れを起こします。処刑なら生存者、人狼襲撃なら人狼から選ばれます。",
  },
  狂信者: {
    icon: "🐾",
    team: "wolf",
    description: "人狼陣営です。人狼が誰かを最初から知っています。",
  },
  妖術師: {
    icon: "🪄",
    team: "wolf",
    description: "人狼陣営です。夜に1人の本当の役職を確認できます。",
  },
  分断者: {
    icon: "✂️",
    team: "wolf",
    description: "一度だけ夜に1人を選び、翌日の議論を2組に分断します。",
  },
  妖狐: {
    icon: "🦊",
    team: "third",
    description: "人狼の襲撃では死亡せず、占われると死亡します。決着時に生存していれば単独勝利です。",
  },
  キューピッド: {
    icon: "💘",
    team: "third",
    description: "最初の夜に恋人2人を結びます。恋人が2人とも生き残れば一緒に勝利します。",
  },
  純愛者: {
    icon: "💝",
    team: "third",
    description: "最初の夜に想い人を1人選び、その人が生存して勝利すると追加勝利します。",
  },
  方位磁針: {
    icon: "🧭",
    team: "villager",
    description: "一度だけ夜に2人を選び、同じ陣営かどうかを確認できます。",
  },
  狼憑き: {
    icon: "🌑",
    team: "villager",
    description: "村人陣営ですが、占いと霊能では人狼と判定されます。",
  },
  呪われた村人: {
    icon: "🩸",
    team: "villager",
    description: "人狼に襲撃されると死亡せず、人狼へ変化します。",
  },
  パン屋: {
    icon: "🥐",
    team: "villager",
    description: "生存中は毎朝パンを届けます。パンが届かなくなると死亡が分かります。",
  },
  市長: {
    icon: "🎖️",
    team: "villager",
    description: "投票が2票分として数えられます。",
  },
  怪盗: {
    icon: "🥷",
    team: "villager",
    description: "最初の夜に1人を選び、その人と役職を交換します。",
  },
  てるてる: {
    icon: "☀️",
    team: "third",
    description: "自分が投票で処刑されると、その時点で単独勝利します。",
  },
  饒舌な人狼: {
    icon: "🗣️",
    team: "wolf",
    description: "人狼です。毎日指定されるお題を議論中に達成できないと夜に死亡します。",
  },
};

export function emptyRoleConfig(): RoleConfig {
  return Object.fromEntries(ROLE_NAMES.map((role) => [role, 0])) as RoleConfig;
}

export function isActualWolfRole(role?: RoleName): boolean {
  return role === "人狼" || role === "饒舌な人狼";
}

export function isWolfTeamRole(role?: RoleName): boolean {
  return Boolean(role && ROLE_INFO[role].team === "wolf");
}

export function isLegacyRole(role?: RoleName): boolean {
  return Boolean(role && LEGACY_ROLE_NAMES.includes(role));
}

export function seerResultForRole(role?: RoleName): PublicResult {
  return isActualWolfRole(role) || role === "狼憑き" ? "人狼" : "人間";
}

export function buildRoles(playerCount: number): RoleName[] {
  if (playerCount < 4 || playerCount > 15) {
    throw new Error("プレイヤー数は4〜15人にしてください。");
  }

  const wolfCount = playerCount >= 7 ? 2 : 1;
  const roles: RoleName[] = Array<RoleName>(wolfCount).fill("人狼");

  roles.push("占い師");
  if (playerCount >= 5) roles.push("騎士");
  if (playerCount >= 6) roles.push("霊能者");
  while (roles.length < playerCount) roles.push("村人");

  return roles;
}

export function roleConfigFromRoles(roles: RoleName[]): RoleConfig {
  const config = emptyRoleConfig();
  for (const role of roles) config[role] += 1;
  return config;
}

export function buildCustomRoles(
  playerCount: number,
  counts: Partial<Omit<RoleConfig, "村人">> & Pick<RoleConfig, "人狼">,
  options: CustomRoleOptions = {},
): RoleName[] {
  if (playerCount < 4 || playerCount > 15) {
    throw new Error("プレイヤー数は4〜15人にしてください。");
  }

  const normalized = emptyRoleConfig();
  for (const role of CONFIGURABLE_ROLE_NAMES) {
    normalized[role] = counts[role as Exclude<RoleName, "村人">] ?? 0;
  }
  const values = CONFIGURABLE_ROLE_NAMES.map((role) => normalized[role]);
  if (!values.every((count) => Number.isInteger(count) && count >= 0)) {
    throw new Error("役職人数は0以上の整数で入力してください。");
  }
  const actualWolfCount = CONFIGURABLE_ROLE_NAMES.reduce(
    (sum, role) => sum + (isActualWolfRole(role) ? normalized[role] : 0),
    0,
  );
  if (actualWolfCount < 1) throw new Error("人狼は1人以上必要です。");
  if (!options.unrestricted) {
    for (const [role, limit] of Object.entries(STANDARD_ROLE_LIMITS) as Array<
      [RoleName, number]
    >) {
      if (normalized[role] > limit) {
        throw new Error(`${role}は${limit}人まで設定できます。`);
      }
    }
    if (normalized.共有者 === 1) {
      throw new Error("共有者は0人または2人で設定してください。");
    }
  }

  const specialCount = values.reduce((sum, count) => sum + count, 0);
  if (specialCount > playerCount) {
    throw new Error("役職の合計がプレイ人数を超えています。");
  }
  const nonWolfCount = playerCount - actualWolfCount;
  if (actualWolfCount >= nonWolfCount) {
    throw new Error(
      "開始時点で人狼の勝利条件を満たすため、人狼を減らしてください。",
    );
  }

  const wolfTeamCount = CONFIGURABLE_ROLE_NAMES.reduce(
    (sum, role) =>
      sum + (ROLE_INFO[role].team === "wolf" ? normalized[role] : 0),
    0,
  );
  const configuredVillagerCount = CONFIGURABLE_ROLE_NAMES.reduce(
    (sum, role) =>
      sum + (ROLE_INFO[role].team === "villager" ? normalized[role] : 0),
    0,
  );
  const villagerTeamCount = configuredVillagerCount + playerCount - specialCount;
  if (villagerTeamCount < 1) {
    throw new Error("村人陣営は1人以上必要です。");
  }
  if (!options.unrestricted && wolfTeamCount >= villagerTeamCount) {
    throw new Error("人狼陣営が多すぎます。村人陣営より少なくしてください。");
  }

  return [
    ...CONFIGURABLE_ROLE_NAMES.flatMap((role) =>
      Array<RoleName>(normalized[role]).fill(role),
    ),
    ...Array<RoleName>(playerCount - specialCount).fill("村人"),
  ];
}

export function usesUnrestrictedRoleConfig(config: RoleConfig): boolean {
  const playerCount = Object.values(config).reduce(
    (sum, count) => sum + count,
    0,
  );
  const wolfTeamCount = ROLE_NAMES.reduce(
    (sum, role) => sum + (ROLE_INFO[role].team === "wolf" ? config[role] : 0),
    0,
  );
  const villagerTeamCount = playerCount - wolfTeamCount;
  return (
    LEGACY_ROLE_NAMES.some((role) => config[role] > 0) ||
    (Object.entries(STANDARD_ROLE_LIMITS) as Array<[RoleName, number]>).some(
      ([role, limit]) => config[role] > limit,
    ) ||
    wolfTeamCount >= villagerTeamCount
  );
}

export function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function getWinner(
  roles: Array<{ id?: string; role?: RoleName; alive: boolean }>,
  context: {
    loverPairs?: ReadonlyArray<readonly [string, string]>;
  } = {},
): Winner | null {
  const alive = roles.filter((player) => player.alive);
  const wolves = alive.filter((player) => isActualWolfRole(player.role)).length;
  const humans = alive.length - wolves;

  const normalWinner: Winner | null =
    wolves === 0 ? "villager" : wolves >= humans ? "wolf" : null;
  if (!normalWinner) return null;

  const aliveIds = new Set(alive.flatMap((player) => (player.id ? [player.id] : [])));
  if (
    context.loverPairs?.some(
      ([left, right]) => aliveIds.has(left) && aliveIds.has(right),
    )
  ) {
    return "lovers";
  }
  if (alive.some((player) => player.role === "妖狐")) return "fox";
  return normalWinner;
}
