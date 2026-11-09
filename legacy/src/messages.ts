// src/messages.ts
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
// 不要になった getWinCondition を削除しました
import { ROLE_CATALOG, ROLE_SELECT_OPTIONS, getRoleDescription, getShortRoleName } from './roles';
import * as DB from './db';
import { GameState, Player } from './types';
import { COLORS, UI, MSG, fill, PERSONALITY_TONES, GAYA_DICTIONARY } from './gameConfig';

// ============================================================
// 参加者プログレスバー
// ============================================================
function buildProgressBar(humanCount: number, npcCount: number): string {
    const max = 15; // 常にシステム上限の15名で固定してバーを生成
    const filled  = '■';
    const npc     = '▨';
    const empty   = '□';
    const total   = humanCount + npcCount;
    
    let bar = '';
    for (let i = 0; i < max; i++) {
        if (i < humanCount)             bar += filled;
        else if (i < humanCount + npcCount) bar += npc;
        else                            bar += empty;
    }
    return `**待機中: ${total} / ${max} 名**\n\`${bar}\``;
}


// ============================================================
// 設定のサマリーテキスト
// ============================================================
function buildSettingsSummary(settings: any): string {
    const matchText  = settings.matchType === 'ranked' ? '🏆 ランク' : '🔰 練習';
    const wolfText   = settings.wolfMode === 'auto' ? '自動' : `${settings.wolfMode}名`;
    const roles = settings.roles.map((r: string) => getShortRoleName(r)).join(' ・ ') || 'なし';

    const ruleChips: string[] = [];
    if (settings.voteTransparency === 'public') ruleChips.push('記名投票');
    if (settings.tieVoteHandling  === 'peace')  ruleChips.push('同票平和');
    if (settings.tieVoteHandling  === 'revote') ruleChips.push('決選投票');
    if (settings.continuousGuard)                ruleChips.push('連続護衛可');
    if (settings.firstNightPeace)                ruleChips.push('初日平和');
    if (!settings.autoFinishVoting)              ruleChips.push('時間固定');
    if (settings.gayaMode)                       ruleChips.push('ガヤあり');
    if (settings.loquaciousMode)                 ruleChips.push('饒舌モード');
    
    return [
        `**設定**：${matchText} (${settings.discussionTime}秒 / 狼: ${wolfText})`,
        `**役職**：${roles}`,
        `**追加**：${ruleChips.length > 0 ? ruleChips.join('、') : 'なし'}`
    ].join('\n');
}

// ============================================================
// 🏠 ロビー
// ============================================================
export async function getLobbyPayload(game: GameState, userId: string, member?: any) {
    const humanPlayers = game.players.filter((p: Player) => !p.isNpc);
    const npcCount     = game.npcCount;
    const total        = humanPlayers.length + npcCount;

    // --- 役職設定から「最低必要な人数」を計算 ---
    let baseWolves = game.settings.wolfMode === 'auto' ? 1 : (typeof game.settings.wolfMode === 'number' ? game.settings.wolfMode : 1);
    let minRequired = baseWolves;
    game.settings.roles.forEach((r: string) => {
        if (r !== 'loquacious') {
            minRequired++;
            if (r === 'freemason') minRequired++; // 共有者は2枠消費
        }
    });
    minRequired = Math.max(4, minRequired); // 最低でも4人必要
    // ------------------------------------------

    let playerDisplay: string;
    if (humanPlayers.length === 0 && npcCount === 0) {
        playerDisplay = '*プレイヤーの参加を待っています...*';
    } else {
        const humanLines = humanPlayers.map((p: Player) => {
            const isHost = p.id === game.hostId;
            const rankIcon = isHost ? '👑' : '👤';
            return `${rankIcon} **${p.name}**`;
        });

        const all = [...humanLines];
        if (npcCount > 0) all.push(`🤖 *NPC (${npcCount}名)*`);

        playerDisplay = all.join('\n');
    }

    const progressBar = buildProgressBar(humanPlayers.length, npcCount);

    const warnings: string[] = [];
    if (game.settings.matchType === 'ranked') {
        const bannedForRanked = ['teruteru', 'cupid', 'cat', 'thief', 'sorcerer', 'baker', 'psycho', 'ninja', 'fox'];
        if (humanPlayers.length < 2)
            warnings.push('⚠️ 人間が2人未満のため、開始時に自動で「練習試合」になります');
        if (game.settings.roles.some((r: string) => bannedForRanked.includes(r)))
            warnings.push('⚠️ ランクマッチ不可の役職が含まれています');
    }

    const hostPlayer = game.players.find(p => p.id === game.hostId);
    const hostName = hostPlayer ? hostPlayer.name : '不明';

    const embed = new EmbedBuilder()
        .setTitle('🐺 人狼ゲーム')
        .setColor(COLORS.LOBBY)
        .setDescription(`${progressBar}\n\n${playerDisplay}`)
        .addFields({
            name: '⚙️ ルール',
            value: buildSettingsSummary(game.settings) + (warnings.length ? `\n\n${warnings.join('\n')}` : ''),
            inline: false,
        })
        .setFooter({ text: `ホスト: ${hostName} ｜ 最低 ${minRequired} 名で開始可能` });

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('join_leave').setLabel('参加 / 退出').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('npc_add').setLabel('🤖 NPC追加').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('npc_remove').setLabel('🤖 NPC削除').setStyle(ButtonStyle.Secondary).setDisabled(npcCount === 0),
        new ButtonBuilder().setCustomId('open_settings').setLabel('⚙️ 詳細設定').setStyle(ButtonStyle.Secondary),
    );

    const canStart = total >= minRequired && total <= 15; // 最低人数クリア＆システム上限内でスタート可能
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('game_start').setLabel('▶️ ゲーム開始').setStyle(ButtonStyle.Success).setDisabled(!canStart),
        new ButtonBuilder().setCustomId('lobby_cancel').setLabel('✖ 解散').setStyle(ButtonStyle.Danger),
    );

    const isPremium = await DB.isPremiumUser(userId).catch(() => false);
    const userPresets = await DB.getPresets(userId).catch(() => []);

    const presetOptions: any[] = [
        { label: '📋 スタンダード',          value: 'preset_standard',  description: '占い師のみ / 自動人狼 / 練習' },
        { label: '🎲 完全ランダム',          value: 'preset_random',    description: 'ランダムな役職が5〜7種類選ばれます' },
    ];

    userPresets.slice(0, 5).forEach((p: any) => {
        presetOptions.push({
            label: `💾 保存済み: ${p.name}`,
            value: `load_preset_${p.name}`,
            description: `役職: ${p.settings.roles?.slice(0, 3).map((r: string) => getShortRoleName(r)).join(' / ') || 'なし'}`,
        });
    });

    const row3 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('lobby_preset')
            .setPlaceholder('📦 プリセットの読み込み (ホスト専用)')
            .addOptions(presetOptions)
    );

    return { embeds: [embed], components: [row1, row2, row3] };
}

// ============================================================
// ⚙️ 設定コンポーネント
// ============================================================
export function getSettingsComponents(settings: any, currentTab: string = 'basic', isPremium: boolean = false) {
    const tabRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('tab_basic')
            .setLabel('基本設定')
            .setStyle(currentTab === 'basic' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('tab_rule')
            .setLabel('ルール設定')
            .setStyle(currentTab === 'rule' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('tab_advanced')
            .setLabel('詳細設定')
            .setStyle(currentTab === 'advanced' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('setting_back')
            .setLabel('✅ ロビーに戻る')
            .setStyle(ButtonStyle.Primary),
    );
    const rows: any[] = [tabRow];

    if (currentTab === 'basic') {
        const matchOptions = [
            { label: '🔰 練習試合 (レート変動なし)', value: 'casual', default: settings.matchType === 'casual', description: '気軽に楽しめる。人数・役職制限なし' },
            { label: '🏆 ランクマッチ (レート変動あり)', value: 'ranked', default: settings.matchType === 'ranked', description: '人間2名以上必須。一部役職使用不可' },
        ];
        const wolfOptions = [
            { label: '🐺 自動 (人数に合わせて調整)', value: 'auto', default: settings.wolfMode === 'auto', description: '4名=1匹 / 6名=2匹 / 11名=3匹' },
            { label: '🐺 1名', value: '1', default: settings.wolfMode === 1 },
            { label: '🐺🐺 2名', value: '2', default: settings.wolfMode === 2 },
            { label: '🐺🐺🐺 3名', value: '3', default: settings.wolfMode === 3 },
        ];
        const timeOptions = [
            { label: '⚡ 30秒 (スピード戦)', value: '30', default: settings.discussionTime === 30 },
            { label: '⏱️ 45秒', value: '45', default: settings.discussionTime === 45 },
            { label: '⏱️ 60秒 (標準)', value: '60', default: settings.discussionTime === 60 },
            { label: '🕐 90秒', value: '90', default: settings.discussionTime === 90 },
            { label: '🕑 120秒 (熟考型)', value: '120', default: settings.discussionTime === 120 },
            { label: '🕒 180秒 (じっくり)', value: '180', default: settings.discussionTime === 180 },
        ];
        const roleOptions = ROLE_SELECT_OPTIONS.map((opt: any) => ({ ...opt, default: settings.roles.includes(opt.value) }));

        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_match_type')
                .setPlaceholder('🎮 マッチ種別の選択')
                .addOptions(matchOptions)
        ));
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_roles')
                .setPlaceholder('🃏 役職の編成')
                .setMinValues(1).setMaxValues(roleOptions.length).addOptions(roleOptions)
        ));
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_wolves')
                .setPlaceholder('🐺 人狼数の設定')
                .addOptions(wolfOptions)
        ));
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_time')
                .setPlaceholder('⏱️ 議論時間の設定')
                .addOptions(timeOptions)
        ));

    } else if (currentTab === 'rule') {
        const voteOptions = [
            { label: '📢 記名投票 (投票先を公開)', value: 'public', default: settings.voteTransparency === 'public', description: '誰が誰に投票したか全員わかる' },
            { label: '🔒 無記名投票 (投票先を隠す)', value: 'anonymous', default: settings.voteTransparency === 'anonymous', description: '集計結果の票数のみ公開される' },
        ];
        const tieOptions = [
            { label: '🕊️ 平和村 (同票時は処刑なし)', value: 'peace', default: settings.tieVoteHandling === 'peace', description: '同票の場合は誰も処刑されない' },
            { label: '🔁 決選投票 (同票者だけで再投票)', value: 'revote', default: settings.tieVoteHandling === 'revote', description: '再同票ならランダム処刑' },
            { label: '🎲 ランダム (同票時はランダム処刑)', value: 'random', default: settings.tieVoteHandling === 'random', description: 'サイコロで同票者の中から1人を処刑' },
        ];
        const guardOptions = [
            { label: '🛡️ 連続護衛あり', value: 'true', default: settings.continuousGuard === true, description: '前日護衛した人を翌日も護衛できる' },
            { label: '🛡️ 連続護衛なし', value: 'false', default: settings.continuousGuard === false, description: '前日護衛した人は翌日護衛できない' },
        ];

        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_vote_transparency')
                .setPlaceholder('📋 投票公開の設定')
                .addOptions(voteOptions)
        ));
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_tie_vote')
                .setPlaceholder('⚖️ 同票処理の設定')
                .addOptions(tieOptions)
        ));
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_continuous_guard')
                .setPlaceholder('🛡️ 連続護衛の設定')
                .addOptions(guardOptions)
        ));

    } else if (currentTab === 'advanced') {
        const nightOptions = [
            { label: '🌕 初日襲撃あり (通常ルール)', value: 'false', default: settings.firstNightPeace === false, description: '1日目の夜から人狼が襲撃できる' },
            { label: '🌙 初日襲撃なし (競技ルール推奨)', value: 'true', default: settings.firstNightPeace === true, description: '1日目の夜は全員安全。2日目から襲撃' },
        ];
        const advancedOptions = [
            { label: '⚡ 全員投票完了で即終了', value: 'autofinish', default: settings.autoFinishVoting, description: '全プレイヤーが投票したら時間を待たず即集計' },
            //{ label: '💬 NPCのガヤ発言を有効化', value: 'gaya', default: settings.gayaMode, description: 'NPCが議論中に自然な相槌や発言をする' },
            { label: '🎯 饒舌モード (人狼にお題付与)', value: 'loquacious', default: settings.loquaciousMode, description: '人狼は議論中に指定キーワードを発言する必要がある' },
        ];

        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_first_night')
                .setPlaceholder('🌙 初日襲撃の設定')
                .addOptions(nightOptions)
        ));
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_advanced')
                .setPlaceholder('📦 その他の詳細ルール (複数選択可)')
                .setMinValues(0).setMaxValues(advancedOptions.length)
                .addOptions(advancedOptions)
        ));
    }

    return rows;
}

// ============================================================
// 🎴 役職カード（極限までシンプルに。勝利条件とフッターを削除）
// ============================================================
export function createRoleCard(player: Player, alliesNames: string[], partnerName: string | null) {
    const roleData = ROLE_CATALOG[player.role || ''] || { icon: '❓', team: 'villager' };

    let cardColor = COLORS.VILLAGER;
    let teamName  = '🔵 村人陣営';
    if (roleData.team === 'wolf')  { cardColor = COLORS.WOLF;  teamName = '🔴 人狼陣営'; }
    if (roleData.team === 'third') { cardColor = COLORS.THIRD; teamName = '🟣 第三陣営'; }

    const descBlocks: string[] = [];
    
    // 役職の説明だけを配置
    descBlocks.push(getRoleDescription(player.role || ''));

    if (['人狼', '饒舌な人狼', '忍者'].includes(player.role || '')) {
        const allyStr = alliesNames.length ? alliesNames.join(' / ') : 'なし（一匹狼）';
        descBlocks.push(`**【 仲間の人狼 】**\n${allyStr}`);
    } else if (player.role === '狂信者') {
        const allyStr = alliesNames.length ? alliesNames.join(' / ') : '不明';
        descBlocks.push(`**【 知っている人狼 】**\n${allyStr}`);
    }

    if (partnerName) {
        descBlocks.push(`**【 運命の恋人 】**\nあなたの相手は **${partnerName}** です。\n相方が死ぬとあなたも後追い自殺します。`);
    }

    return new EmbedBuilder()
        .setAuthor({ name: teamName })
        .setTitle(`${roleData.icon} ${player.role}`)
        .setDescription(descBlocks.join('\n\n'))
        .setColor(cardColor);
        // フッターと勝利条件フィールドを完全撤去！
}

// ============================================================
// ゲーム中ガヤ発言ヘルパー
// ============================================================
const FALLBACK_TONE: Record<string, string[]> = {
    attacking: ['${t}が怪しいんじゃないか？', '${t}の動き、どうも納得できないな。'],
    defensive: ['俺を疑うなんてどうかしてるぜ！', 'ちょっと待ってくれ、俺じゃない！'],
    neutral:   ['うーん、難しいな…', '誰が人狼なんだろうな。', '慎重に行こうぜ。']
};

export function getDynamicGayaPhrase(situation: string, personality = 'normal', targetName: string | null = null) {
    const t = targetName || 'あの人';
    
    const typedDict = GAYA_DICTIONARY as Record<string, Record<string, string[]>>;
    const toneData = typedDict[personality] || typedDict['normal'] || FALLBACK_TONE;
    const phrases  = toneData[situation] || toneData['neutral'] || FALLBACK_TONE[situation] || FALLBACK_TONE['neutral'];
    
    const rawPhrase = phrases[Math.floor(Math.random() * phrases.length)];
    return rawPhrase.replace('${t}', t);
}

// ============================================================
// ボタン・セレクトメニュー生成ヘルパー群
// ============================================================
export function createButtonRows(players: any[], actionType: string, style = ButtonStyle.Secondary) {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();
    players.forEach((p, i) => {
        currentRow.addComponents(
            new ButtonBuilder().setCustomId(`${actionType}_${p.id}`).setLabel(p.name).setStyle(style)
        );
        if ((i + 1) % 5 === 0) { rows.push(currentRow); currentRow = new ActionRowBuilder<ButtonBuilder>(); }
    });
    if (currentRow.components.length > 0) rows.push(currentRow);
    return rows;
}

export function createNightActionRows(players: any[], actionType: string, roleName: string) {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    if (roleName === '占い師' || roleName === '偽占い') {
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('strategy_co').setLabel(UI.night.coButton).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('strategy_hide').setLabel(UI.night.hideModeButton).setStyle(ButtonStyle.Secondary),
        ));
    }
    let currentRow = new ActionRowBuilder<ButtonBuilder>();
    players.forEach((p, i) => {
        currentRow.addComponents(
            new ButtonBuilder().setCustomId(`${actionType}_${p.id}`).setLabel(p.name).setStyle(ButtonStyle.Secondary)
        );
        if ((i + 1) % 5 === 0) { rows.push(currentRow); currentRow = new ActionRowBuilder<ButtonBuilder>(); }
    });
    if (currentRow.components.length > 0) rows.push(currentRow);
    return rows;
}

export function createFakeResultRows(targetId: string, targetName: string) {
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`fakeresult_white_${targetId}`).setLabel(fill(UI.night.fakeSeerWhiteBtn, { name: targetName })).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`fakeresult_black_${targetId}`).setLabel(fill(UI.night.fakeSeerBlackBtn, { name: targetName })).setStyle(ButtonStyle.Danger),
    )];
}

export function createMediumPublishRow(targetId: string, targetName: string, executedRole: string) {
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`medium_publish_${targetId}_${executedRole}`)
            .setLabel(fill(UI.night.mediumPublishBtn, { name: targetName }))
            .setStyle(ButtonStyle.Primary),
    )];
}

export function getCupidSelection(players: any[]) {
    const options = players.map(p => ({ label: p.name, value: p.id }));
    return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('cupid_select')
            .setPlaceholder('💘 恋人にする2人を選んでください')
            .setMinValues(2).setMaxValues(2)
            .addOptions(options)
    )];
}

// ============================================================
// 安全送信ヘルパー
// ============================================================
export async function safeDM(user: any, content: any): Promise<boolean> {
    if (!user || typeof user.send !== 'function') return false;
    try { await user.send(content); return true; }
    catch (e: any) { console.log(`[SafeDM] スキップ: ${user.username} - ${e.message}`); return false; }
}

export async function safeSend(channel: any, content: any): Promise<any> {
    if (!channel || typeof channel.send !== 'function') return null;
    try { return await channel.send(content); }
    catch (e: any) { console.error(`[SafeSend] エラー: ${e.message}`); return null; }
}
