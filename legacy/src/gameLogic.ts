// src/gameLogic.ts
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, TextChannel } from 'discord.js';
import * as dotenv from 'dotenv';
dotenv.config();
import * as Messages from './messages';
import * as DB from './db';
import * as Phases from './phase';
import { getGame, initGame, resetGame, findGameByUserId, moveGameChannel } from './state';
import { generateGameSummary } from './aiUtils';
import * as NPC from './npcLogic';
import { GameState, Player } from './types';
import * as Roles from './roles';
import { TIMING } from './gameConfig';

// 14行目付近
const PERSONALITIES = [
    'aggressive', 'witty', 'serious', 'normal', 'sans', 'jax', 
    'logical', 'cautious', 'ninja', 'chuuni', 'dio'
];
const activeInteractions = new Set<string>();
const verifiedDmUsers = new Set<string>();

const PRESET_LABELS: Record<string, string> = {
    preset_standard:  '【スタンダード】',
    preset_random:    '【ランダム】完全カオス村',
};

// ============================================================
// 設定変更の共通処理ヘルパー
// ============================================================
type SettingApplier = (game: GameState, values: string[]) => void;

const SETTING_APPLIERS: Record<string, SettingApplier> = {
    setting_vote_transparency:  (g, v) => { g.settings.voteTransparency  = v[0] as any; },
    setting_tie_vote:           (g, v) => { g.settings.tieVoteHandling   = v[0] as any; },
    setting_continuous_guard:   (g, v) => { g.settings.continuousGuard   = v[0] === 'true'; },
    setting_first_night:        (g, v) => { g.settings.firstNightPeace   = v[0] === 'true'; },
    setting_roles:              (g, v) => { g.settings.roles              = v; },
    setting_wolves:             (g, v) => { g.settings.wolfMode           = v[0] === 'auto' ? 'auto' : parseInt(v[0]); },
    setting_time:               (g, v) => { g.settings.discussionTime     = parseInt(v[0]); },
    setting_advanced:           (g, v) => {
        g.settings.autoFinishVoting = v.includes('autofinish');
        g.settings.gayaMode         = v.includes('gaya');
        g.settings.willMode         = v.includes('will');
        g.settings.loquaciousMode   = v.includes('loquacious');
    },
};

const SETTING_SUCCESS_MSGS: Record<string, string> = {
    setting_roles:    '✅ 役職を更新しました！',
    setting_wolves:   '✅ 人狼の数を更新しました！',
    setting_time:     '✅ 議論時間を更新しました！',
    setting_advanced: '✅ 詳細ルールを更新しました！',
};

// ============================================================
// メインハンドラ
// ============================================================
export async function handleInteraction(interaction: any) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

    // 連打対策バリア
    const lockKey = `${interaction.user.id}_${interaction.customId}`;
    if (activeInteractions.has(lockKey)) return;
    activeInteractions.add(lockKey);
    setTimeout(() => activeInteractions.delete(lockKey), 500);

    // phase.ts 側で処理する夜アクション系は早期リターン
    const nightActionPrefixes = ['vote_', 'thief_', 'divine_', 'strategy_', 'fakeresult_', 'guard_', 'kill_', 'sorcery_', 'devotee_', 'god_', 'necro_', 'dictator_', 'assassinate_', 'open_night_dashboard', 'open_fake_seer_menu', 'back_to_dashboard', 'fakemedium_', 'npc_strat_', 'npc_div_', 'compass_'];
    if (nightActionPrefixes.some(p => interaction.customId.startsWith(p))) return;

    let game: GameState;
    if (!interaction.guildId) {
        const found = findGameByUserId(interaction.user.id);
        if (!found) return;
        game = found;
    } else {
        game = getGame(interaction.channel.id);
        if (!game.channel && interaction.channel) game.channel = interaction.channel;
        if (!game.hostId) game.hostId = interaction.user.id;
    }

    const allowedWhenIdle = ['game_rematch', 'game_ai_analyze', 'select_profile_color', 'select_profile_title', 'game_delete_room', 'game_force_reset', 'show_timeline'];
    if (game.state === 'idle' && !allowedWhenIdle.includes(interaction.customId) && !interaction.customId.startsWith('shop_buy_')) return;

    try {
        // ── ゴースト賭け ──────────────────────────────────────────
        if (interaction.customId.startsWith('bet_')) {
            const player = game.players.find((p: Player) => p.id === interaction.user.id);
            if (!player) return interaction.reply({ content: 'エラー: プレイヤー情報なし', ephemeral: true });
            if (game.state !== 'playing' || game.winnerTeam || player.alive || !player.betDeadline) {
                return interaction.reply({ content: '現在、賭けを受け付けていません。', ephemeral: true });
            }
            const [, betType, deadline] = interaction.customId.split('_');
            if (!['villager', 'wolf', 'other'].includes(betType) || deadline !== String(player.betDeadline)) {
                return interaction.reply({ content: 'この賭けボタンは無効です。', ephemeral: true });
            }
            if (player.ghostBet) return interaction.reply({ content: '既に賭けています。', ephemeral: true });
            if (player.betDeadline && Date.now() > player.betDeadline) {
                return interaction.reply({ content: '⏰ **賭けの受付時間は終了しました。**\n(死亡から90秒以内に投票する必要があります)', ephemeral: true });
            }
            player.ghostBet = betType === 'villager' ? 'villager' : betType === 'wolf' ? 'wolf' : 'other';
            const teamName = betType === 'villager' ? '村人陣営' : betType === 'wolf' ? '人狼陣営' : '第三陣営';
            return interaction.reply({ content: `👻 **${teamName}** に魂を賭けました！的中すればボーナス！`, ephemeral: true });
        }

        // ── 強制リセット ──────────────────────────────────────────
        if (interaction.customId === 'game_force_reset') {
            if (game.state !== 'idle' || interaction.user.id !== game.hostId || !interaction.guildId) {
                return interaction.reply({ content: '試合終了後にホストのみ操作できます。', ephemeral: true });
            }
            resetGame(interaction.channel.id, true);
            return interaction.reply({ content: '🔄 強制リセットしました。', ephemeral: false });
        }

        // ── 再戦 ────────────────────────────────────────────────
        if (interaction.customId === 'game_rematch') {
            if (game.state !== 'idle' || !interaction.guildId) {
                return interaction.reply({ content: '試合終了後に再戦できます。', ephemeral: true });
            }
            if (!game?.players?.length) {
                return interaction.reply({ content: '🔄 **Botの再起動（または更新）が行われたため、前回のデータがリセットされました！**\nお手数ですが、`/jinro` コマンドで新しく村を建て直してください', ephemeral: true });
            }
            resetGame(interaction.channel.id, false);
            await interaction.reply({ content: '🔄 再戦準備中...', ephemeral: true });
            if (game.channel) {
                game.lobbyMessage = await game.channel.send(await Messages.getLobbyPayload(game, game.hostId, interaction.member));
            }
            return;
        }

        // ── 部屋削除 ─────────────────────────────────────────────
        if (interaction.customId === 'game_delete_room') {
            if (interaction.user.id !== game.hostId) {
                return interaction.reply({ content: '⚠️ **権限エラー**：このボタンは募集者（ホスト）のみが押せます。', ephemeral: true });
            }
            await interaction.reply({ content: '🗑️ **村を解散します。お疲れ様でした！**' });
            game.wolfChannel?.delete('ホストによる村の解散').catch(() => {});
            resetGame(interaction.channel.id, true);
            return;
        }

        // ── タイムライン表示 ──────────────────────────────────────
        if (interaction.customId === 'show_timeline') {
            const hist = (game as any).historyStr || "(記録なし)";
            return interaction.reply({ content: `**📜 タイムライン**\n\`\`\`\n${hist}\n\`\`\``, ephemeral: true });
        }

        // ── 検死官公表 ────────────────────────────────────────────
        if (interaction.customId === 'coroner_publish') {
            if (game.state !== 'playing') return interaction.reply({ content: '⚠️ 現在ゲームは進行していません。', ephemeral: true });
            const currentPlayer = game.players.find((p: Player) => p.id === interaction.user.id);
            if (currentPlayer?.role !== '検死官') return interaction.reply({ content: '⚠️ あなたは検死官ではありません。', ephemeral: true });

            await interaction.message.edit({ components: [] }).catch(()=>{});
            await interaction.reply({ content: '📢 検死結果を公表しました。', ephemeral: true });

            if (game.channel && game.coronerReport) {
                let targetCh = game.channel;
                if (game.dividedGroups) {
                    targetCh = game.dividedGroups.roomA.includes(currentPlayer.id) ? game.sectorAChannel : game.sectorBChannel;
                }
                const embed = new EmbedBuilder().setTitle('🔍 検死官の報告').setDescription(`**${currentPlayer.name}**: 「死者たちの本当の役職が判明した…！」\n\n${game.coronerReport}`).setColor(0x9B59B6);
                await Messages.safeSend(targetCh, { embeds: [embed] });
                game.chatLog.push({ id: currentPlayer.id, name: currentPlayer.name, content: `検死結果公表`, day: game.dayCount });
                game.evidence.push({ type: 'coroner_co', day: game.dayCount, from: currentPlayer.id, target: 'all', result: true, visible: true });
            }
            return;
        }

        // ── 偽検死官モーダル ──────────────────────────────────────
        if (interaction.customId === 'fakecoroner_open_modal') {
            if (game.state !== 'playing') return interaction.reply({ content: '⚠️ 現在ゲームは進行していません。', ephemeral: true });
            const currentPlayer = game.players.find((p: Player) => p.id === interaction.user.id);
            const fakeRoles = ['狂人', '狂信者', '人狼', '妖狐', 'テルテル', '妖術師'];
            if (!currentPlayer?.alive || !fakeRoles.includes(currentPlayer.role!)) {
                await interaction.message.edit({ components: [] }).catch(() => {});
                return interaction.reply({ content: '⚠️ 権限エラー：このボタンは過去の試合のものです。', ephemeral: true });
            }

            const alreadyDivining = game.actions?.some((a: any) => a.from === currentPlayer.id && a.type === 'divine')
                                 || game.evidence?.some((e: any) => e.from === currentPlayer.id && e.type === 'divine');
            const alreadyMedium   = game.evidence?.some((e: any) => e.from === currentPlayer.id && e.type === 'medium_co');
            if (alreadyDivining || alreadyMedium) {
                await interaction.message.edit({ components: [] }).catch(() => {});
                return interaction.reply({ content: '⚠️ 既に別の役職（占い師や霊能者）として行動しているため、検死官を騙ることはできません！', ephemeral: true });
            }

            const deadPlayers = game.players.filter((p: Player) => !p.alive);
            if (!deadPlayers.length) return interaction.reply({ content: '死者がいません。', ephemeral: true });

            const modal = new ModalBuilder().setCustomId('fakecoroner_modal').setTitle('🔍 偽の検死レポート作成');
            deadPlayers.slice(0, 5).forEach((dead: any, i: number) => {
                modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder().setCustomId(`fake_role_${i}`).setLabel(`${dead.name} の偽役職 (例: 村人, 占い師)`).setStyle(TextInputStyle.Short).setRequired(true)
                ));
            });
            return interaction.showModal(modal);
        }

        // ── 偽検死官モーダル送信 ──────────────────────────────────
        if (interaction.isModalSubmit() && interaction.customId === 'fakecoroner_modal') {
            if (game.state !== 'playing') return interaction.reply({ content: '⚠️ 現在ゲームは進行していません。', ephemeral: true });
            const currentPlayer = game.players.find((p: Player) => p.id === interaction.user.id);
            const fakeRoles = ['狂人', '狂信者', '人狼', '妖狐', 'テルテル', '妖術師'];
            if (!currentPlayer?.alive || !fakeRoles.includes(currentPlayer.role!)) {
                return interaction.reply({ content: '⚠️ 権限エラー：このアクションは現在実行できません。', ephemeral: true });
            }

            const deadPlayers = game.players.filter((p: Player) => !p.alive).slice(0, 5);
            let fakeReport = "🔍 **検死レポート**\n昨晩の死者の正体は以下の通りです：\n";
            deadPlayers.forEach((dead: any, i: number) => {
                fakeReport += `▪ **${dead.name}** ➔ **【${interaction.fields.getTextInputValue(`fake_role_${i}`).replace(/[【】\[\]\s]/g, '')}】**\n`;
            });

            await interaction.message.edit({ components: [] }).catch(() => {});
            await interaction.reply({ content: '📢 指定した役職で、完璧な偽の検死結果を公表しました。', ephemeral: true });

            if (game.channel) {
                let targetCh = game.channel;
                if (game.dividedGroups) {
                    targetCh = game.dividedGroups.roomA.includes(currentPlayer.id) ? game.sectorAChannel : game.sectorBChannel;
                }
                const embed = new EmbedBuilder().setTitle('🔍 検死官の報告').setDescription(`**${currentPlayer.name}**: 「死者たちの本当の役職が判明した…！」\n\n${fakeReport}`).setColor(0x9B59B6);
                await Messages.safeSend(targetCh, { embeds: [embed] });
                game.chatLog.push({ id: currentPlayer.id, name: currentPlayer.name, content: `検死結果公表`, day: game.dayCount });
                game.evidence.push({ type: 'coroner_co', day: game.dayCount, from: currentPlayer.id, target: 'all', result: false, visible: true });
            }
            return;
        }

        // ── キューピッド ──────────────────────────────────────────
        if (interaction.customId === 'cupid_select') {
            if (game.dayCount !== 1) return interaction.reply({ content: '⚠️ キューピッドの能力は初日の夜にしか使えません！', ephemeral: true });
            if (game.lovers?.length) return interaction.reply({ content: '⚠️ すでに恋人は選択済みです。', ephemeral: true });

            const [id1, id2] = interaction.values;
            if (!id1 || !id2 || interaction.values.length !== 2) return interaction.reply({ content: '2人選んでください。', ephemeral: true });

            game.lovers = [id1, id2];
            const p1 = game.players.find((p: Player) => p.id === id1);
            const p2 = game.players.find((p: Player) => p.id === id2);
            if (!p1 || !p2) return interaction.reply({ content: 'プレイヤーが見つかりませんでした。', ephemeral: true });

            if (!p1.isNpc) p1.user?.send(`💘 恋人に選ばれました！相手: ${p2.name}`).catch(() => {});
            if (!p2.isNpc) p2.user?.send(`💘 恋人に選ばれました！相手: ${p1.name}`).catch(() => {});
            return interaction.update({ content: `💘 **カップル成立**: ${p1.name} と ${p2.name}`, components: [] });
        }

        // ── 募集中ロビー ──────────────────────────────────────────
        if (game.state === 'recruiting') {
            const updatePublicLobby = async () => {
                if (game.lobbyMessage) await game.lobbyMessage.edit(await Messages.getLobbyPayload(game, game.hostId, interaction.member)).catch(() => {});
            };

            const hostOnlyActions = [
                'open_settings', 'setting_roles', 'setting_wolves', 'setting_time', 'setting_advanced',
                'setting_back', 'game_start', 'lobby_cancel', 'lobby_preset', 'npc_add', 'npc_remove',
                'setting_vote_transparency', 'setting_tie_vote', 'setting_continuous_guard', 'setting_first_night', 'setting_match_type',
            ];
            if (hostOnlyActions.includes(interaction.customId) && interaction.user.id !== game.hostId) {
                return interaction.reply({ content: `⚠️ **権限がありません！**\n設定変更やNPCの操作は、募集者（ホスト）のみが行えます。`, ephemeral: true });
            }

            // ── ロビープリセット ──
            if (interaction.customId.startsWith('lobby_preset')) {
                const preset: string = interaction.values[0];
                let targetTotal = 0;

                if (preset.startsWith('load_preset_')) {
                    const presetName = preset.replace('load_preset_', '');
                    const userPresets = await DB.getPresets(interaction.user.id);
                    const found = userPresets.find(p => p.name === presetName);
                    if (found) {
                        game.settings = { ...found.settings, roles: [...(found.settings.roles || [])] };
                        const s = game.settings;
                        const roleCount = s.roles?.length ?? 1;
                        const wolfCount = s.wolfMode === 'auto' ? 1 : (typeof s.wolfMode === 'number' ? s.wolfMode : 1);
                        const extraMasons = s.roles?.includes('freemason') ? 1 : 0;
                        targetTotal = s.playerCount ?? Math.max(4, roleCount + extraMasons + wolfCount + 1);
                    }
                } else if (preset === 'preset_standard') {
                    Object.assign(game.settings, {
                        roles: ['seer'], wolfMode: 'auto', continuousGuard: true,
                        tieVoteHandling: 'random', voteTransparency: 'public',
                        firstNightPeace: true, matchType: 'casual',
                    });
                } else if (preset === 'preset_random') {
                    const allRoles = ['seer', 'medium', 'guard', 'madman', 'fanatic', 'freemason', 'coroner', 'tough_guy', 'fox', 'fugitive', 'cupid', 'sorcerer', 'loquacious', 'devotee', 'divider', 'assassin', 'compass'];
                    
                    const shuffled = allRoles.sort(() => Math.random() - 0.5);
                    const pickCount = Math.floor(Math.random() * 3) + 5; // 5〜7個
                    const randomRoles = shuffled.slice(0, pickCount);

                    Object.assign(game.settings, {
                        roles: randomRoles,
                        wolfMode: 'auto', 
                        continuousGuard: true,
                        tieVoteHandling: 'random', 
                        voteTransparency: 'anonymous',
                        firstNightPeace: true, 
                        matchType: 'casual',
                    });

                    let roleSlots = randomRoles.length;
                    if (randomRoles.includes('freemason')) roleSlots++;

                    let wolves = 1;
                    let target = roleSlots + wolves;
                    if (target >= 6) { wolves = 2; target = roleSlots + wolves; }
                    if (target >= 11) { wolves = 3; target = roleSlots + wolves; }

                    targetTotal = target + 1;
                }
                
                // ※ ここにあった RANKED_PRESETS の読み込み処理は削除済み

                (game as any).currentPresetName = PRESET_LABELS[preset] ?? null;

                if (targetTotal > 0) {
                    const currentHumans = game.players.filter((p: Player) => !p.isNpc).length;
                    game.npcCount = Math.max(0, targetTotal - currentHumans);
                }
                return interaction.update(await Messages.getLobbyPayload(game, game.hostId, interaction.member));
            }


            // ── ロビー解散 ──
            if (interaction.customId === 'lobby_cancel') {
                resetGame(interaction.channel.id, true);
                if (game.lobbyMessage) await game.lobbyMessage.delete().catch(() => {});
                return interaction.reply({ content: '🚫 募集を中止しました。', ephemeral: false });
            }

            // ── 参加/退出 ──
            if (interaction.customId === 'join_leave') {
                const idx = game.players.findIndex((p: Player) => p.id === interaction.user.id);
                if (idx === -1) {
                    const existing = findGameByUserId(interaction.user.id);
                    if (existing && existing.channel?.id !== game.channel?.id) {
                        return interaction.reply({ content: `⚠️ あなたは既に別の村（<#${existing.channel?.id}>）に参加しています。\nあちらの村を退出するか、ゲームが終了してから参加してください。`, flags: ['Ephemeral'] });
                    }
                    if (game.players.length + game.npcCount >= 15) return interaction.reply({ content: '⚠️ 参加人数の上限に達しています。', flags: ['Ephemeral'] });
                    game.players.push({ id: interaction.user.id, user: interaction.user, name: interaction.user.username, isNpc: false, settings: undefined });
                } else {
                    game.players.splice(idx, 1);
                }
                return interaction.update(await Messages.getLobbyPayload(game, game.hostId, interaction.member));
            }

            // ── NPC 追加/削除 ──
            if (interaction.customId === 'npc_add') {
                if (game.players.length + game.npcCount >= 15) return interaction.reply({ content: '⚠️ 人数上限に達しています。', ephemeral: true });
                game.npcCount++;
                return interaction.update(await Messages.getLobbyPayload(game, game.hostId, interaction.member));
            }
            if (interaction.customId === 'npc_remove') {
                if (game.npcCount > 0) game.npcCount--;
                return interaction.update(await Messages.getLobbyPayload(game, game.hostId, interaction.member));
            }

            // ── 設定タブ ──
            if (interaction.customId.startsWith('tab_')) {
                game.settingsTab = interaction.customId.replace('tab_', '') as any;
                const isPremium = await DB.isPremiumUser(interaction.user.id);
                return interaction.update({ components: Messages.getSettingsComponents(game.settings, game.settingsTab!, isPremium) });
            }

            // ── 設定変更（ディスパッチテーブル） ──
            if (interaction.customId === 'setting_match_type') {
                game.settings.matchType = interaction.values[0] as any;
                if (game.settings.matchType === 'ranked') {
                    const banned = ['teruteru', 'cupid', 'cat', 'thief', 'sorcerer', 'baker', 'psycho', 'ninja', 'fox'];
                    game.settings.roles = game.settings.roles.filter((r: string) => !banned.includes(r));
                    if (!game.settings.roles.length) game.settings.roles = ['seer'];
                }
                const isPremium = await DB.isPremiumUser(interaction.user.id);
                await interaction.update({ components: Messages.getSettingsComponents(game.settings, game.settingsTab!, isPremium) });
                await updatePublicLobby();
                return;
            }

            if (SETTING_APPLIERS[interaction.customId]) {
                SETTING_APPLIERS[interaction.customId](game, interaction.values);
                const isPremium = await DB.isPremiumUser(interaction.user.id);
                const msg = SETTING_SUCCESS_MSGS[interaction.customId] ?? '';
                await interaction.update({ content: msg ? `🛠️ **ゲーム設定メニュー**\n${msg}` : undefined, components: Messages.getSettingsComponents(game.settings, game.settingsTab!, isPremium) });
                await updatePublicLobby();
                return;
            }

            // ── 設定メニューを開く / 閉じる ──
            if (interaction.customId === 'open_settings') {
                const isPremium = await DB.isPremiumUser(interaction.user.id);
                return interaction.reply({ content: '🛠️ **ゲーム設定メニュー**\n変更すると、自動で募集画面にも反映されます。', components: Messages.getSettingsComponents(game.settings, game.settingsTab || 'basic', isPremium), ephemeral: true });
            }
            if (interaction.customId === 'setting_back') {
                return interaction.update({ content: '✅ 設定を完了しました。(このメッセージは消去して構いません)', components: [] });
            }

            // ── ゲーム開始 ──
            if (interaction.customId === 'game_start') {
                const total = game.players.length + game.npcCount;
                if (total < 4) return interaction.reply({ content: '⚠️ 人数不足です (最低4人)。', ephemeral: true });

                let wolfCount = game.settings.wolfMode === 'auto'
                    ? (total >= 11 ? 3 : total >= 6 ? 2 : 1)
                    : game.settings.wolfMode;
                if (wolfCount >= total / 2) wolfCount = Math.floor((total - 1) / 2) || 1;

                let requiredRolesCount = wolfCount;
                game.settings.roles.forEach((r: string) => {
                    if (r !== 'loquacious') {
                        requiredRolesCount++;
                        if (r === 'freemason') requiredRolesCount++;
                    }
                });

                if (requiredRolesCount > total) {
                    return interaction.reply({ content: `⚠️ **設定エラー**\n役職の枠数（${requiredRolesCount}枠）が、現在の参加人数（${total}人）をオーバーしています。\n設定から役職を減らすか、参加者（またはNPC）を増やしてください。`, ephemeral: true });
                }

                const humanCount = game.players.filter((p: Player) => !p.isNpc).length;
                if (game.settings.matchType === 'ranked' && humanCount < 2) {
                    game.settings.matchType = 'casual';
                    (game as any).downgradeMessage = true;
                }

                game.state = 'playing';
                await interaction.deferUpdate();
                await interaction.editReply({ content: '**🐺 ゲームを開始します...**', components: [], embeds: [] });
                startGame(game, interaction).catch(e => console.error('startGameエラー:', e));
                return;
            }
        }

    } catch (error: any) {
        console.error('Interaction Error:', error);
        const msg = `⚠️ **システム内部エラーが発生しました**: ${error.message}\n(再デプロイ等の影響の可能性があります)`;
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
        } else {
            await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
        }
    }
}

// ============================================================
// ゲーム開始処理
// ============================================================
async function startGame(game: GameState, interaction: any) {
    const finalPlayers = [...game.players];
    for (let i = 0; i < game.npcCount; i++) {
        finalPlayers.push({
            id: `npc_${game.channel?.id}_${i}`,
            user: null,
            name: `🤖NPC${i + 1}`,
            isNpc: true,
            personality: PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)],
            settings: undefined,
        });
    }

    // 連勝中アナウンス
    const streakMessages = (await Promise.all(
        finalPlayers.map(async p => {
            if (p.isNpc) return null;
            const s = await DB.getCurrentStreak(p.id);
            return s >= 2 ? `🔥 **${p.name}** は現在 **${s}連勝中** です！` : null;
        })
    )).filter(Boolean);
    const streakAnnounce = streakMessages.length ? `\n${streakMessages.join('\n')}\n` : '';

    const total = finalPlayers.length;
    const rolesSource = Phases.decideRoles(game, total);

    // 役職内訳テキスト
    const roleCounts: Record<string, number> = {};
    rolesSource.forEach((r: any) => { roleCounts[r] = (roleCounts[r] || 0) + 1; });
    const roleOrder = ['人狼', '狂信者', '狂人', '妖狐', '妖術師', 'テルテル', 'キューピッド', '猫又', '怪盗', '占い師', '霊能者', '騎士', '共有者', '逃亡者', '検死官', '市長', 'タフガイ', '村人', '方位磁針'];
    const roleBreakdown = Object.entries(roleCounts)
        .sort(([a], [b]) => {
            const ia = roleOrder.indexOf(a), ib = roleOrder.indexOf(b);
            return ia === -1 ? 1 : ib === -1 ? -1 : ia - ib;
        })
        .map(([r, c]) => `${r}**${c}**`)
        .join(' / ');

    // シャッフル
    for (let i = rolesSource.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rolesSource[i], rolesSource[j]] = [rolesSource[j], rolesSource[i]];
    }

    game.players = finalPlayers.map((p, i) => ({
        ...p, role: rolesSource[i], alive: true, isFakeSeer: false, knownWolf: null, isHiding: false, hideStrategy: false,
    }));
    Phases.setupSpecialRoles(game, total);

    if ((game as any).downgradeMessage) {
        await game.channel?.send('⚠️ **人数が足りないため、自動的に「練習試合」として開始します。**\n(ランクマッチには人間プレイヤーが最低2人必要です)');
        delete (game as any).downgradeMessage;
    }

    // 役職DMを全員に送信
    game.players.forEach((p: Player) => {
        if (p.isNpc) return;
        const alliesNames = (Roles.ROLE_CATALOG[p.role as string]?.isWolfCount || p.role === '狂信者')
            ? game.players.filter((x: Player) => Roles.ROLE_CATALOG[x.role as string]?.isWolfCount && x.id !== p.id).map((x: Player) => x.name)
            : [];
        // ★修正：メタ読み防止のため、初日のRoleCardでは恋人の名前をnullにして隠す（夜に別途DMで通知する）
        const partnerName = null; 
        p.user?.send({ embeds: [Messages.createRoleCard(p, alliesNames, partnerName)] }).catch(e => console.error('DM Error:', e.message));
    });

    let startMessage = `🌙 **ゲーム開始**\n参加: ${total}名\n📜 **内訳**: ${roleBreakdown}`;
    if (streakAnnounce) {
        startMessage += `${streakAnnounce}`;
    }

    await game.channel?.send({ content: startMessage });

    const wolfTeamIds = game.players
        .filter((p: Player) => !p.isNpc && (Roles.isActualWolf(p.role as string) || p.role === '分断者'))
        .map((p: Player) => p.id);

    if (wolfTeamIds.length > 0 && game.channel?.guild) {
        try {
            const { ChannelType, PermissionFlagsBits } = require('discord.js');
            game.wolfChannel = await game.channel.guild.channels.create({
                name: '🐺人狼の隠れ家',
                type: ChannelType.GuildText,
                parent: game.channel.parentId,
                permissionOverwrites: [
                    { id: game.channel.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: game.channel.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    ...wolfTeamIds.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] })),
                ],
            });
            await Messages.safeSend(game.wolfChannel, '🌑 **【秘匿通信回線：確立】**\nここは人狼と分断者のみがアクセスできる裏のチャンネルだ。死者は自動的に追放される。存分に陰謀を企てるがいい……。');
        } catch (e) {
            console.error("人狼チャット作成エラー:", e);
        }
    }

    game.dayCount = 0;
    Phases.startNightPhase(game);
}

export async function showStats(userId: string, interaction: any) { await DB.showStats(userId, interaction); }
