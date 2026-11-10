// src/messages.ts
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { ROLE_CATALOG, ROLE_SELECT_OPTIONS, getRoleDescription } from './roles';
import * as DB from './db';
import { GameState, Player } from './types';
import { COLORS, UI, MSG, fill, PERSONALITY_TONES } from './gameConfig';

// ▼ ロビー表示用の「絵文字＋略称」マップ
const SHORT_ROLE_MAP: Record<string, string> = {
    'seer': '🔮占い', 'medium': '👻霊能', 'guard': '🛡️騎士', 'madman': '🎭狂人',
    'fanatic': '🕯️狂信', 'freemason': '🔗共有', 'coroner': '🔍検死', 'mayor': '👑市長',
    'tough_guy': '❤️‍🩹タフ', 'fox': '🦊妖狐', 'fugitive': '💨逃亡', 'teruteru': '☔テル',
    'cupid': '🏹天使', 'sorcerer': '👁️妖術', 'cat': '🐈‍⬛猫又', 'thief': '🎩怪盗',
    'loquacious': '🐺饒舌', 'devotee': '❤️‍🔥純愛', 'dictator': '🗡️独裁',
    'god': '🕊️神', 'divider': '🌀分断', 'necromancer': '💀死霊'
};

export async function getLobbyPayload(game: GameState, userId: string, member?: any) {
    const isPremium = await DB.isPremiumUser(userId);
    const total = game.players.length + game.npcCount;
    const playerNames = game.players.length > 0 
        ? game.players.map((p: Player) => {
            const icon = p.isNpc ? '🤖' : (p.id === game.hostId ? '👑' : '👤');
            return `${icon} **${p.name}**`;
        }).join(' ｜ ') 
        : UI.lobby.waitingMessage;

    const roleCounts: Record<string, number> = {};
    game.settings.roles.forEach((r: string) => { 
        const name = SHORT_ROLE_MAP[r] || r;
        roleCounts[name] = (roleCounts[name] || 0) + 1;
        if (r === 'freemason') roleCounts[name] += 1;
    });

    const roleText = Object.entries(roleCounts)
        .map(([name, count]) => count > 1 ? `${name}x${count}` : name)
        .join(' / ') || 'なし';
    let wolfText = game.settings.wolfMode === 'auto' ? '自動' : `${game.settings.wolfMode}名`;

    let customCount = 0;
    if (game.settings.voteTransparency !== 'anonymous') customCount++;
    if (game.settings.tieVoteHandling !== 'random') customCount++;
    if (game.settings.continuousGuard !== false) customCount++;
    if (game.settings.firstNightPeace !== false) customCount++;
    if (game.settings.autoFinishVoting !== true) customCount++;
    if (game.settings.gayaMode !== false) customCount++;
    if (game.settings.willMode !== false) customCount++;
    if (game.settings.loquaciousMode !== false) customCount++;

    const optionText = customCount === 0 
        ? '標準ルール' 
        : `カスタム設定 (${customCount}項目変更)`;

    const humanCount = game.players.filter(p => !p.isNpc).length;
    const bannedForRanked = ['teruteru', 'cupid', 'cat', 'thief', 'sorcerer', 'baker', 'psycho', 'ninja', 'fox'];
    const hasBannedRole = game.settings.roles.some((r: string) => bannedForRanked.includes(r));

    let matchTypeText = game.settings.matchType === 'ranked'
        ? '🏆 ランクマッチ (戦績・レート変動あり)'
        : '🔰 練習試合 (レート変動なし)';

    if (game.settings.matchType === 'ranked') {
        if (humanCount < 2) {
            matchTypeText += '\n⚠️ *注意: 人間が2人未満のため、開始時に自動で「練習試合」になります*';
        }
        if (hasBannedRole) {
            matchTypeText += '\n⚠️ *注意: ランク不可の役職が含まれているため開始できません*';
        }
    }

    const embed = new EmbedBuilder()
        .setTitle(fill(UI.lobby.lobbyTitle, { total }))
        .setDescription(`**👥 参加者**: ${playerNames}\n\n`)
        .addFields(
            { 
                name: `⚙️ 現在のルール設定`, 
                value: `🎮 **種別**: ${game.settings.matchType === 'ranked' ? '🏆 ランク' : '🔰 練習'}\n⏳ **時間**: ${game.settings.discussionTime}秒 ｜ 🐺 **人狼**: ${wolfText}\n🃏 **役職**: ${roleText}\n📋 **詳細**: ${optionText}`, 
                inline: false 
            }
        )
        .setColor(COLORS.LOBBY);

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('join_leave').setLabel(UI.lobby.joinLeaveButton).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('npc_add').setLabel(UI.lobby.npcAddButton).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('npc_remove').setLabel(UI.lobby.npcRemoveButton).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('open_settings').setLabel(UI.lobby.settingsButton).setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('game_start').setLabel(UI.lobby.startButton).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('lobby_cancel').setLabel(UI.lobby.cancelButton).setStyle(ButtonStyle.Danger),
    );

    return { embeds: [embed], components: [row1, row2] };
}

export function getSettingsComponents(settings: any, currentTab: string = 'basic', isPremium: boolean = false) {
    const tabRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('tab_basic').setLabel(UI.settings.tabBasic).setStyle(currentTab === 'basic' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tab_rule').setLabel(UI.settings.tabRule).setStyle(currentTab === 'rule' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tab_advanced').setLabel(UI.settings.tabAdvanced).setStyle(currentTab === 'advanced' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('setting_back').setLabel(UI.settings.tabDone).setStyle(ButtonStyle.Primary)
    );
    const rows: any[] = [tabRow];

    if (currentTab === 'basic') {
        const matchOptions = [
            { label: '🔰 練習試合 (レート変動なし / 気軽に遊ぶ)', value: 'casual', default: settings.matchType === 'casual' },
            { label: '🏆 ランクマッチ (レート変動あり / 人間2人以上必須)', value: 'ranked', default: settings.matchType === 'ranked' }
        ];
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_match_type').setPlaceholder('マッチタイプ').addOptions(matchOptions)
        ));

        const wolfOptions = [
            { label: '自動 (人数に合わせて調整)', value: 'auto', default: settings.wolfMode === 'auto' },
            { label: '1人', value: '1', default: settings.wolfMode === 1 },
            { label: '2人', value: '2', default: settings.wolfMode === 2 },
            { label: '3人', value: '3', default: settings.wolfMode === 3 },
        ];
        const timeOptions = [
            { label: '30秒', value: '30', default: settings.discussionTime === 30 },
            { label: '45秒', value: '45', default: settings.discussionTime === 45 },
            { label: '60秒', value: '60', default: settings.discussionTime === 60 },
            { label: '90秒', value: '90', default: settings.discussionTime === 90 },
            { label: '120秒', value: '120', default: settings.discussionTime === 120 },
            { label: '180秒', value: '180', default: settings.discussionTime === 180 },
        ];

        const roleOptions = ROLE_SELECT_OPTIONS.map((opt: any) => ({
            ...opt,
            default: settings.roles.includes(opt.value)
        }));

        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_roles').setPlaceholder('役職を選択 (複数可)').setMinValues(1).setMaxValues(roleOptions.length).addOptions(roleOptions)
        ));
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_wolves').setPlaceholder('人狼の数').addOptions(wolfOptions)
        ));
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_time').setPlaceholder('議論時間').addOptions(timeOptions)
        ));

    } else if (currentTab === 'rule') {
        const voteOptions = [
            { label: '投票先を公開する (記名)', value: 'public', default: settings.voteTransparency === 'public' },
            { label: '投票先を隠す (無記名)', value: 'anonymous', default: settings.voteTransparency === 'anonymous' }
        ];
        const tieOptions = [
            { label: '同票時は処刑なし (平和村)', value: 'peace', default: settings.tieVoteHandling === 'peace' },
            { label: '同票時は決選投票 (再同票はランダム)', value: 'revote', default: settings.tieVoteHandling === 'revote' },
            { label: '同票時は即ランダム処刑', value: 'random', default: settings.tieVoteHandling === 'random' }
        ];
        const guardOptions = [
            { label: '連続護衛 あり', value: 'true', default: settings.continuousGuard === true },
            { label: '連続護衛 なし', value: 'false', default: settings.continuousGuard === false }
        ];
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_vote_transparency').setPlaceholder('投票の公開設定').addOptions(voteOptions)
        ));
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_tie_vote').setPlaceholder('同票時の処理').addOptions(tieOptions)
        ));
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_continuous_guard').setPlaceholder('騎士の連続護衛').addOptions(guardOptions)
        ));

    } else if (currentTab === 'advanced') {
        const nightOptions = [
            { label: '初日の夜の襲撃 あり (通常)', value: 'false', default: settings.firstNightPeace === false },
            { label: '初日の夜の襲撃 なし (平和)', value: 'true', default: settings.firstNightPeace === true }
        ];
        const advancedOptions = [
            { label: '投票全員完了で即終了', value: 'autofinish', default: settings.autoFinishVoting },
            { label: 'NPCのガヤ発言を有効化', value: 'gaya', default: settings.gayaMode },
            { label: '処刑時の遺言を有効化', value: 'will', default: settings.willMode },
            { label: '饒舌モード (人狼にお題付与)', value: 'loquacious', default: settings.loquaciousMode },
        ];
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_first_night').setPlaceholder('初日襲撃の設定').addOptions(nightOptions)
        ));
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId('setting_advanced').setPlaceholder('その他の詳細ルール').setMinValues(0).setMaxValues(advancedOptions.length).addOptions(advancedOptions)
        ));
    }

    return rows;
}

export function createRoleCard(player: Player, alliesNames: string[], partnerName: string | null) {
    const roleData = ROLE_CATALOG[player.role || ''] || { icon: '❓', team: 'villager' };
    
    let cardColor = COLORS.VILLAGER;
    let teamName = "村人陣営";

    if (roleData.team === 'wolf') {
        cardColor = COLORS.WOLF;
        teamName = "人狼陣営";
    } else if (roleData.team === 'third') {
        cardColor = COLORS.THIRD;
        teamName = "第三陣営";
    }

    let desc = `> ${getRoleDescription(player.role || '')}`;
    
    if (['人狼', '饒舌な人狼', '忍者'].includes(player.role || '')) {
        desc += `\n\n🩸 **仲間の人狼**: ${alliesNames.length ? alliesNames.join(', ') : 'なし'}`;
    } else if (player.role === '狂信者') {
        desc += `\n\n📿 **知っている人狼**: ${alliesNames.length ? alliesNames.join(', ') : 'なし'}`;
    }
    
    if (partnerName) {
        desc += `\n\n💘 **【運命の恋人】**\nあなたの相手は **${partnerName}** です。\n相方が死ぬとあなたも後追い自殺します。`;
    }

    return new EmbedBuilder()
        .setTitle(`${roleData.icon} あなたの役職: ${player.role}`)
        .setDescription(`**所属: ${teamName}**\n\n${desc}`)
        .setColor(cardColor);
}

export function getDynamicGayaPhrase(situation: string, personality = 'normal', targetName: string | null = null) {
    const t = targetName || "あの人";
    const toneData = PERSONALITY_TONES[personality] || PERSONALITY_TONES['normal'];
    const phrases = toneData[situation] || toneData['neutral'];
    const rawPhrase = phrases[Math.floor(Math.random() * phrases.length)];
    return rawPhrase.replace('${t}', t);
}

export function createButtonRows(players: any[], actionType: string, style = ButtonStyle.Primary) {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();
    players.forEach((p, i) => {
        currentRow.addComponents(new ButtonBuilder().setCustomId(`${actionType}_${p.id}`).setLabel(p.name).setStyle(style));
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
            new ButtonBuilder().setCustomId('strategy_hide').setLabel(UI.night.hideModeButton).setStyle(ButtonStyle.Secondary)
        ));
    }
    let currentRow = new ActionRowBuilder<ButtonBuilder>();
    players.forEach((p, i) => {
        currentRow.addComponents(new ButtonBuilder().setCustomId(`${actionType}_${p.id}`).setLabel(p.name).setStyle(ButtonStyle.Secondary));
        if ((i + 1) % 5 === 0) { rows.push(currentRow); currentRow = new ActionRowBuilder<ButtonBuilder>(); }
    });
    if (currentRow.components.length > 0) rows.push(currentRow);
    return rows;
}

export function createFakeResultRows(targetId: string, targetName: string) {
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`fakeresult_white_${targetId}`).setLabel(fill(UI.night.fakeSeerWhiteBtn, { name: targetName })).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`fakeresult_black_${targetId}`).setLabel(fill(UI.night.fakeSeerBlackBtn, { name: targetName })).setStyle(ButtonStyle.Danger)
    )];
}

export function createMediumPublishRow(targetId: string, targetName: string, executedRole: string) {
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`medium_publish_${targetId}_${executedRole}`).setLabel(fill(UI.night.mediumPublishBtn, { name: targetName })).setStyle(ButtonStyle.Success)
    )];
}

export function getCupidSelection(players: any[]) {
    const options = players.map(p => ({ label: p.name, value: p.id }));
    return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId('cupid_select').setPlaceholder('恋人を2人選んでください').setMinValues(2).setMaxValues(2).addOptions(options)
    )];
}

export async function safeDM(user: any, content: any): Promise<boolean> {
    if (!user || typeof user.send !== 'function') return false; 
    try {
        await user.send(content);
        return true;
    } catch (e: any) {
        console.log(`[SafeDM] DM送信スキップ: ${user.username} - ${e.message}`);
        return false;
    }
}

export async function safeSend(channel: any, content: any): Promise<any> {
    if (!channel || typeof channel.send !== 'function') return null;
    try {
        return await channel.send(content);
    } catch (e: any) {
        console.error(`[SafeSend] チャンネル送信エラー: ${e.message}`);
        return null;
    }
}
