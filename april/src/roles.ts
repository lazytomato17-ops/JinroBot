// src/roles.ts
// 🎭 役職のデータと、陣営判定などのヘルパー関数を管理するファイル

export const ROLE_MAP: Record<string, string> = { 
    'seer': '占い師', 'medium': '霊能者', 'guard': '騎士', 'madman': '狂人', 
    'fanatic': '狂信者', 'freemason': '共有者', 'coroner': '検死官', 'mayor': '市長', 
    'tough_guy': 'タフガイ', 'fox': '妖狐', 'fugitive': '逃亡者', 'teruteru': 'テルテル', 
    'cupid': 'キューピッド', 'sorcerer': '妖術師', 'cat': '猫又', 'thief': '怪盗', 
    'baker': 'パン屋', 'loquacious': '饒舌な人狼',
    'devotee': '純愛者', 'dictator': '独裁者', 'god': '神', 'divider': '分断者', 'necromancer': '死霊術師'
};

/** 役職名の配列を、日本語のカンマ区切り文字列に変換する関数 */
export function translateRoles(roles: string[]): string {
    return roles.map(r => ROLE_MAP[r] || r).join(', ');
}

export const ROLE_CATALOG: Record<string, { icon: string; team: 'villager' | 'wolf' | 'third'; isWolfCount?: boolean; description: string }> = {
    // 🧑‍🌾 村人陣営
    '村人': { icon: '🧑‍🌾', team: 'villager', description: '特殊能力はありませんが、推理と対話で人狼を見つけ出す主役です。' },
    '占い師': { icon: '🔮', team: 'villager', description: '毎晩1人を占い、その人が「人狼」か「人間」かを知ることができます。' },
    '霊能者': { icon: '👻', team: 'villager', description: '処刑された人が「人狼」だったか「人間」だったかを知ることができます。' },
    '騎士': { icon: '🛡️', team: 'villager', description: '毎晩、自分以外の1人を人狼の襲撃から守ることができます。' },
    '共有者': { icon: '🔗', team: 'villager', description: '絶対に人間だと分かっている相棒がいます。裏で協力して村を導きましょう。' },
    '検死官': { icon: '🔍', team: 'villager', description: '毎朝、昨晩襲撃されて死んだ人の「本当の役職」を知ることができます。' },
    '逃亡者': { icon: '💨', team: 'villager', description: '毎晩誰かの家へ逃げ込みます。逃げ込んだ先が人狼だったり襲撃されると死にます。' },
    '怪盗': { icon: '🎩', team: 'villager', description: '初日の夜に、他の誰かと役職を交換することができます。' },
    '市長': { icon: '👑', team: 'villager', description: 'あなたの投票は常に「2票分」としてカウントされます。' },
    'タフガイ': { icon: '❤️‍🩹', team: 'villager', description: '人狼に襲撃されても一度は耐え抜き、翌日の夜に遅れて死亡します。' },
    '猫又': { icon: '🐈‍⬛', team: 'villager', description: '処刑や襲撃で死亡した時、誰か1人を道連れにして殺します。' },
    '独裁者': { icon: '🗡️', team: 'villager', description: 'ゲーム中に一度だけ、議論を強制終了させて自分が選んだ相手を処刑できます。' },
    '死霊術師': { icon: '💀', team: 'villager', description: '一度だけ死者を蘇生できます。ただし、自分が死ぬと蘇生した相手も道連れになります。' },

    // 🐺 人狼陣営
    '人狼': { icon: '🐺', team: 'wolf', isWolfCount: true, description: '毎晩、人間を1人選んで襲撃します。市民を騙して生き残りましょう。' },
    '饒舌な人狼': { icon: '🐺', team: 'wolf', isWolfCount: true, description: '昼の議論中に「指定されたお題ワード」を発言しないと突然死してしまいます。' },
    '狂人': { icon: '🎭', team: 'wolf', description: '人間ですが人狼の味方です。夜に「偽の占い」を行って村を混乱させましょう。' },
    '狂信者': { icon: '🕯️', team: 'wolf', description: '人間ですが、誰が人狼かを知っています。人狼を勝利させるために嘘をつきましょう。' },
    '妖術師': { icon: '👁️', team: 'wolf', description: '毎晩1人を占い、その人の「本当の役職」を知ることができます。' },
    '分断者': { icon: '🌀', team: 'wolf', description: 'ゲーム中に一度だけ、夜にメンバーを選んで翌朝の議論を2つの部屋に分断できます。' },

    // 🌟 第三陣営
    '妖狐': { icon: ' foxes', team: 'third', description: '襲撃されても死にませんが、占われると死ぬ幻の役職。単独勝利を目指します。' },
    'テルテル': { icon: '☔', team: 'third', description: '昼の投票で処刑されることが勝利条件です。怪しまれるように行動しましょう。' },
    'キューピッド': { icon: '🏹', team: 'third', description: '初日の夜に2人を「恋人」にします。恋人陣営として最後まで生き残れば勝利！' },
    '純愛者': { icon: '❤️‍🔥', team: 'third', description: '初日に1人を「愛する人」にします。その人が勝利することがあなたの勝利条件です。' },
    '神': { icon: '🕊️', team: 'third', description: '襲撃されても死にません。特定の条件で生き残ると勝利を横取りします。' }
};

export const ROLE_SELECT_OPTIONS = [
    { label: '🔮 占い師', value: 'seer', description: '毎晩、誰か1人の正体を知る' },
    { label: '👻 霊能者', value: 'medium', description: '処刑された人の正体を知る' },
    { label: '🛡️ 騎士', value: 'guard', description: '毎晩、誰か1人を人狼の襲撃から守る' },
    { label: '🎭 狂人', value: 'madman', description: '人間だが、人狼陣営の勝利を目指す' },
    { label: '🔗 共有者', value: 'freemason', description: '互いに人間であると知っている(2人セット)' },
    { label: '👑 市長', value: 'mayor', description: '自分の投票が常に2票分になる' },
    { label: '🗡️ 独裁者', value: 'dictator', description: '1度だけ、強制的に誰かを処刑できる' },
    { label: '🔍 検死官', value: 'coroner', description: '朝、前夜の死者の本当の役職を知る' },
    { label: '🐈‍⬛ 猫又', value: 'cat', description: '死亡時に誰か1人を道連れにする' },
    { label: '❤️‍🩹 タフガイ', value: 'tough_guy', description: '襲撃されても、翌日の夜まで死なない' },
    { label: '💨 逃亡者', value: 'fugitive', description: '毎晩誰かの家に逃げる' },
    { label: '🎩 怪盗', value: 'thief', description: '初日の夜に誰かと役職を交換する' },
    { label: '💀 死霊術師', value: 'necromancer', description: '1度だけ蘇生できるが、死ぬと蘇生相手も死ぬ' },
    { label: '🕯️ 狂信者', value: 'fanatic', description: '誰が人狼か知っている狂人' },
    { label: '👁️ 妖術師', value: 'sorcerer', description: '毎晩、誰か1人の具体的な役職を見抜く' },
    { label: '🌀 分断者', value: 'divider', description: '1度だけ、朝の議論を2空間に引き裂く' },
    { label: '🦊 妖狐', value: 'fox', description: '最後まで生存で単独勝利（占われると死亡）' },
    { label: '☔ テルテル', value: 'teruteru', description: '昼に処刑されれば単独勝利' },
    { label: '🏹 キューピッド', value: 'cupid', description: '初日に2人を恋人にする' },
    { label: '❤️‍🔥 純愛者', value: 'devotee', description: '初日に1人選び、その人が勝利すれば追加勝利' },
    { label: '🕊️ 神', value: 'god', description: '襲撃無効。特定の条件で勝利を奪う' }
];

// 以下のヘルパー関数もすべて重要！
export function getRoleDescription(role: string) { return ROLE_CATALOG[role]?.description || '役職情報なし'; }
export function isWolfTeam(role: string) { return ROLE_CATALOG[role]?.team === 'wolf'; }
export function isActualWolf(role: string) { return ROLE_CATALOG[role]?.isWolfCount === true; }