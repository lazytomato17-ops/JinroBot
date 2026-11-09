// src/roles.ts
// 🎭 役職のデータと、陣営判定などのヘルパー関数を管理するファイル

export const ROLE_MAP: Record<string, string> = { 
    'seer': '占い師', 'medium': '霊能者', 'guard': '騎士', 'madman': '狂人', 
    'fanatic': '狂信者', 'freemason': '共有者', 'coroner': '検死官', 'mayor': '市長', 
    'tough_guy': 'タフガイ', 'fox': '妖狐', 'fugitive': '逃亡者', 'teruteru': 'テルテル', 
    'cupid': 'キューピッド', 'sorcerer': '妖術師', 'cat': '猫又', 'thief': '怪盗', 
    'baker': 'パン屋', 'loquacious': '饒舌な人狼',
    'devotee': '純愛者', 'dictator': '独裁者', 'god': '神', 'divider': '分断者', 'necromancer': '死霊術師', 'assassin': '暗殺者', 'compass': '方位磁針',
    'wolf_possessed': '狼憑き',
    'white_wolf': '白狼',
    'cursed': '呪われた村人'
};

/** 役職名の配列を、日本語のカンマ区切り文字列に変換する関数 */
export function translateRoles(roles: string[]): string {
    return roles.map(r => ROLE_MAP[r] || r).join(', ');
}

// 💡 改善ポイント：winCondition（勝利条件）と shortName（略称）をカタログに一元化しました
export const ROLE_CATALOG: Record<string, { icon: string; team: 'villager' | 'wolf' | 'third'; isWolfCount?: boolean; description: string; winCondition: string; shortName?: string }> = {
    // 🧑‍🌾 村人陣営 (デフォルトの勝利条件：人狼を全員処刑する)
    '村人': { icon: '🧑‍🌾', team: 'villager', description: '特殊能力はありませんが、推理と対話で人狼を見つけ出す主役です。', winCondition: '人狼を全員処刑する' },
    '占い師': { icon: '🔮', team: 'villager', description: '毎晩1人を占い、その人が「人狼」か「人間」かを知ることができます。', winCondition: '人狼を全員処刑する' },
    '霊能者': { icon: '👻', team: 'villager', description: '処刑された人が「人狼」だったか「人間」だったかを知ることができます。', winCondition: '人狼を全員処刑する' },
    '騎士': { icon: '🛡️', team: 'villager', description: '毎晩、自分以外の1人を人狼の襲撃から守ることができます。', winCondition: '人狼を全員処刑する' },
    '共有者': { icon: '🔗', team: 'villager', description: '絶対に人間だと分かっている相棒がいます。裏で協力して村を導きましょう。', winCondition: '人狼を全員処刑する' },
    '検死官': { icon: '🔍', team: 'villager', description: '毎朝、昨晩襲撃されて死んだ人の「本当の役職」を知ることができます。', winCondition: '人狼を全員処刑する' },
    '逃亡者': { icon: '💨', team: 'villager', description: '毎晩誰かの家へ逃げ込みます。逃げ込んだ先が人狼だったり襲撃されると死にます。', winCondition: '人狼を全員処刑する' },
    '怪盗': { icon: '🎩', team: 'villager', description: '初日の夜に、他の誰かと役職を交換することができます。', winCondition: '盗んだ役職の勝利条件に従う' },
    '市長': { icon: '👑', team: 'villager', description: 'あなたの投票は常に「2票分」としてカウントされます。', winCondition: '人狼を全員処刑する' },
    'タフガイ': { icon: '❤️‍🩹', team: 'villager', description: '人狼に襲撃されても一度は耐え抜き、翌日の夜に遅れて死亡します。', winCondition: '人狼を全員処刑する' },
    '猫又': { icon: '🐈‍⬛', team: 'villager', description: '処刑や襲撃で死亡した時、誰か1人を道連れにして殺します。', winCondition: '村人陣営を勝利させる（処刑時に道連れ発動）' },
    '独裁者': { icon: '🗡️', team: 'villager', description: 'ゲーム中に一度だけ、議論を強制終了させて自分が選んだ相手を処刑できます。', winCondition: '村人陣営を勝利させる（一度だけ即処刑が可能）' },
    '死霊術師': { icon: '💀', team: 'villager', description: '一度だけ死者を蘇生できます。ただし、自分が死ぬと蘇生した相手も道連れになります。', winCondition: '人狼陣営を勝利させる（一度だけ蘇生が可能）' },
    '暗殺者': { icon: '🔪', team: 'villager', description: 'ゲーム中に一度だけ、夜に誰かを暗殺できます。村人を撃つと自爆します。', winCondition: '村人陣営の勝利' },
    '方位磁針': { icon: '🧭', team: 'villager', description: 'ゲーム中に一度だけ、夜に二人を選び、その二人が同じ陣営かどうかを知ることができます。', winCondition: '人狼を全員処刑する' },
    '狼憑き': { icon: '🐺?', team: 'villager', description: 'ただの村人ですが、占い師に占われると「人狼」と判定されてしまう不憫な役職です。', winCondition: '人狼を全員処刑する' },
    '呪われた村人': { icon: '🧟', team: 'villager', description: '人狼に襲撃されると死なず、その翌日から「人狼」に変化してしまいます。', winCondition: '村人陣営の勝利（変化後は人狼陣営の勝利）' },

    // 🐺 人狼陣営 (デフォルトの勝利条件：村人を減らし、人狼と同数以下にする)
    '人狼': { icon: '🐺', team: 'wolf', isWolfCount: true, description: '毎晩、人間を1人選んで襲撃します。市民を騙して生き残りましょう。', winCondition: '村人を減らし、人狼と同数以下にする' },
    '饒舌な人狼': { icon: '🐺', team: 'wolf', isWolfCount: true, description: '昼の議論中に「指定されたお題ワード」を発言しないと突然死してしまいます。', winCondition: '村人を減らし、人狼と同数以下にする', shortName: '饒舌狼' },
    '狂人': { icon: '🎭', team: 'wolf', description: '人間ですが人狼の味方です。夜に「偽の占い」を行って村を混乱させましょう。', winCondition: '人狼陣営を勝利させる（自身が死んでも可）' },
    '狂信者': { icon: '🩸', team: 'wolf', description: '人間ですが、誰が人狼かを知っています。人狼を勝利させるために嘘をつきましょう。', winCondition: '人狼陣営を勝利させる（自身が死んでも可）' },
    '妖術師': { icon: '👁️', team: 'wolf', description: '毎晩1人を占い、その人の「本当の役職」を知ることができます。', winCondition: '人狼陣営を勝利させる（自身が死んでも可）' },
    '分断者': { icon: '🌀', team: 'wolf', description: 'ゲーム中に一度だけ、夜にメンバーを選んで翌朝の議論を2つの部屋に分断できます。', winCondition: '村人を減らし、人狼と同数以下にする' },
    '白狼': { icon: '🤍', team: 'wolf', isWolfCount: true, description: '人狼ですが、占い師に占われると「人間」と判定されます。', winCondition: '村人を減らし、人狼と同数以下にする' },

    // 🌟 第三陣営
    '妖狐': { icon: '🦊', team: 'third', description: '襲撃されても死にませんが、占われると死ぬ幻の役職。単独勝利を目指します。', winCondition: '処刑されず、ゲーム終了まで生き残る' },
    'テルテル': { icon: '☔', team: 'third', description: '昼の投票で処刑されることが勝利条件です。怪しまれるように行動しましょう。', winCondition: '村人たちに疑われ、自身が処刑される' },
    'キューピッド': { icon: '🏹', team: 'third', description: '初日の夜に2人を「恋人」にします。恋人陣営として最後まで生き残れば勝利！', winCondition: '恋人2人が最後まで生き残る' },
    '純愛者': { icon: '❤️‍🔥', team: 'third', description: '初日に1人を「愛する人」にします。その人が勝利することがあなたの勝利条件です。', winCondition: '指定した相手をゲーム終了まで生き残らせる' },
    '神': { icon: '🕊️', team: 'third', description: '襲撃されても死にません。特定の条件で生き残ると勝利を横取りします。', winCondition: '村人陣営を勝利させる（一度だけ蘇生が可能）' }
};

// src/roles.ts

export const ROLE_SELECT_OPTIONS = [
    { label: '🔮 占い師', value: 'seer', description: '毎晩、誰か1人の正体を知る' },
    { label: '👻 霊能者', value: 'medium', description: '処刑された人の正体を知る' },
    { label: '🛡️ 騎士', value: 'guard', description: '毎晩、誰か1人を人狼の襲撃から守る' },
    { label: '🎭 狂人', value: 'madman', description: '人間だが、人狼陣営の勝利を目指す' },
    { label: '🔗 共有者', value: 'freemason', description: '互いに人間であると知っている(2人セット)' },
    { label: '🔍 検死官', value: 'coroner', description: '朝、前夜の死者の本当の役職を知る' },
    { label: '❤️‍🩹 タフガイ', value: 'tough_guy', description: '襲撃されても、翌日の夜まで死なない' },
    { label: '💨 逃亡者', value: 'fugitive', description: '毎晩誰かの家に逃げる' },
    { label: '🔪 暗殺者', value: 'assassin', description: '1度だけ夜に暗殺できる（村人を撃つと自爆）' },
    { label: '🩸 狂信者', value: 'fanatic', description: '誰が人狼か知っている狂人' },
    { label: '👁️ 妖術師', value: 'sorcerer', description: '毎晩、誰か1人の具体的な役職を見抜く' },
    { label: '🌀 分断者', value: 'divider', description: '1度だけ、朝の議論を2空間に引き裂く' },
    { label: '🦊 妖狐', value: 'fox', description: '最後まで生存で単独勝利（占われると死亡）' },
    { label: '🏹 キューピッド', value: 'cupid', description: '初日に2人を恋人にする' },
    { label: '❤️‍🔥 純愛者', value: 'devotee', description: '初日に1人選び、その人が勝利すれば追加勝利' },
    { label: '🧭 方位磁針', value: 'compass', description: '1度だけ、2人が同陣営か判定する' },
    { label: '🐺 狼憑き', value: 'wolf_possessed', description: '占われると人狼判定が出る不憫な村人' },
    { label: '🤍 白狼', value: 'white_wolf', description: '占われても人間判定が出る人狼' },
    { label: '🧟 呪われた村人', value: 'cursed', description: '襲撃されると人狼に変化する村人' }
];
export function getRoleDescription(role: string) { return ROLE_CATALOG[role]?.description || '役職情報なし'; }
export function isWolfTeam(role: string) { return ROLE_CATALOG[role]?.team === 'wolf'; }
export function isActualWolf(role: string) { return ROLE_CATALOG[role]?.isWolfCount === true; }

/** * 絵文字付きの短い役職名を取得する (例: "seer" -> "🔮 占い師") 
 * 長い名前は shortName プロパティでスッキリさせます
 */
export function getShortRoleName(roleKey: string): string {
    const jpName = ROLE_MAP[roleKey] || roleKey;
    const roleData = ROLE_CATALOG[jpName];
    if (!roleData) return `❓ ${jpName}`;
    
    // shortName が設定されていればそれを使い、なければ元の名前を使う
    const displayName = roleData.shortName || jpName;
    return `${roleData.icon} ${displayName}`;
}

/** * 役職ごとの正しい勝利条件を取得する 
 * if文の羅列をやめ、CATALOGから直接引っ張ることでバグを0にしました
 */
export function getWinCondition(roleName: string): string {
    return ROLE_CATALOG[roleName]?.winCondition || '不明な勝利条件です'; 
}
