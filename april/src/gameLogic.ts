// src/gameLogic.ts
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits, TextChannel } from 'discord.js';
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

const PERSONALITIES = ['aggressive', 'cautious', 'logical', 'normal', 'witty', 'joker', 'gal', 'serious'];

const activeInteractions = new Set<string>();

const verifiedDmUsers = new Set<string>();

export async function handleInteraction(interaction: any) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;
    
    // 【連打対策バリア】
    const lockKey = `${interaction.user.id}_${interaction.customId}`;
    if (activeInteractions.has(lockKey)) {
        return; 
    }
    activeInteractions.add(lockKey);
    setTimeout(() => activeInteractions.delete(lockKey), 500); 

    const ignoreIds = ['vote_', 'thief_', 'divine_', 'strategy_', 'fakeresult_', 'guard_', 'kill_', 'sorcery_', 'devotee_', 'god_', 'necro_', 'dictator_', 'open_night_dashboard', 'open_fake_seer_menu', 'back_to_dashboard'];
    if (ignoreIds.some(id => interaction.customId.startsWith(id))) {
        return; 
    }
    
    let game;
    if (!interaction.guildId) {
        game = findGameByUserId(interaction.user.id);
        if (!game) return; 
    } else {
        game = getGame(interaction.channel.id);
        
        if (!game.channel && interaction.channel) {
            game.channel = interaction.channel;
        }
        if (!game.hostId) {
            game.hostId = interaction.user.id; 
        }
    }
        const allowedWhenIdle = ['game_rematch', 'game_ai_analyze', 'select_profile_color', 'select_profile_title', 'game_delete_room', 'game_force_reset',　'show_timeline'];
        if (game.state === 'idle' && !allowedWhenIdle.includes(interaction.customId) && !interaction.customId.startsWith('shop_buy_')) {
            return;
        }
        try {
            if (interaction.customId.startsWith('bet_')) {
            const player = game.players.find((p: Player) => p.id === interaction.user.id);
            if (!player) return interaction.reply({ content: 'エラー: プレイヤー情報なし', ephemeral: true });
            if (game.state !== 'playing' || game.winnerTeam || player.alive || !player.betDeadline)
                return interaction.reply({ content: '現在、賭けを受け付けていません。', ephemeral: true });
            const [, betType, deadline] = interaction.customId.split('_');
            if (!['villager', 'wolf', 'other'].includes(betType) || deadline !== String(player.betDeadline))
                return interaction.reply({ content: 'この賭けボタンは無効です。', ephemeral: true });
            if (player.ghostBet) return interaction.reply({ content: '既に賭けています。', ephemeral: true });

            if (player.betDeadline && Date.now() > player.betDeadline) {
                return interaction.reply({ content: '⏰ **賭けの受付時間は終了しました。**\n(死亡から90秒以内に投票する必要があります)', ephemeral: true });
            }

            if (betType === 'villager') player.ghostBet = 'villager';
            else if (betType === 'wolf') player.ghostBet = 'wolf';
            else player.ghostBet = 'other';
            
            const teamName = betType === 'villager' ? '村人陣営' : (betType === 'wolf' ? '人狼陣営' : '第三陣営');
            await interaction.reply({ content: `👻 **${teamName}** に魂を賭けました！的中すればボーナス！`, ephemeral: true });
            return;
        }

        if (interaction.customId === 'game_force_reset') {
            if (!interaction.guildId || game.state !== 'idle' || interaction.user.id !== game.hostId)
                return interaction.reply({ content: '試合終了後にホストのみ操作できます。', ephemeral: true });
            resetGame(interaction.channel.id, true);
            await interaction.reply({ content: '🔄 強制リセットしました。', ephemeral: false });
            return;
        }
        
        if (interaction.customId === 'game_rematch') {
            if (!interaction.guildId || game.state !== 'idle')
                return interaction.reply({ content: '試合終了後に再戦できます。', ephemeral: true });
            if (!game.players.some((p: Player) => !p.isNpc && p.id === interaction.user.id) || findGameByUserId(interaction.user.id))
                return interaction.reply({ content: '前の試合に参加し、現在ほかの村に入っていない人だけ再戦できます。', ephemeral: true });
            if (!game || !game.players || game.players.length === 0) {
                return interaction.reply({ 
                    content: '🔄 **Botの再起動（または更新）が行われたため、前回のデータがリセットされました！**\nお手数ですが、`/jinro` コマンドで新しく村を建て直してください', 
                    ephemeral: true 
                });
            }
            resetGame(interaction.channel.id, false);
            await interaction.reply({ content: '🔄 再戦準備中...', ephemeral: true });
            
            if (game.channel) {
                const payload = await Messages.getLobbyPayload(game, game.hostId, interaction.member);
                const lobbyMsg = await game.channel.send(payload);
                game.lobbyMessage = lobbyMsg;
            }
            return;
        }

        if (interaction.customId === 'game_delete_room') {
            if (interaction.user.id !== game.hostId) {
                return interaction.reply({ content: '⚠️ **権限エラー**：このボタンは募集者（ホスト）のみが押せます。', ephemeral: true });
            }
            
            await interaction.reply({ content: '🗑️ **村を解散します。お疲れ様でした！**' });
            
            // 🐺 人狼チャットがあれば先に削除
            if (game.wolfChannel) {
                game.wolfChannel.delete('ホストによる村の解散').catch(() => {});
            }

            resetGame(interaction.channel.id, true);
            

            return;
        }

        if (interaction.customId === 'show_timeline') {
            const hist = (game as any).historyStr || "(記録なし)";
            return interaction.reply({ content: `**📜 タイムライン**\n\`\`\`\n${hist}\n\`\`\``, ephemeral: true });
        }

        if (interaction.customId.startsWith('medium_publish_')) {
            if (game.state !== 'playing') return interaction.reply({ content: '⚠️ 現在ゲームは進行していません。', ephemeral: true });
            const currentPlayer = game.players.find((p: Player) => p.id === interaction.user.id);
            if (!currentPlayer || currentPlayer.role !== '霊能者') return interaction.reply({ content: '⚠️ あなたは現在のゲームの霊能者ではありません。', ephemeral: true });

            const dataStr = interaction.customId.replace('medium_publish_', '');
            const lastUnderscore = dataStr.lastIndexOf('_');
            const targetId = dataStr.substring(0, lastUnderscore);
            const executedRole = dataStr.substring(lastUnderscore + 1); 
            
            const targetPlayer = game.players.find((p: Player) => p.id === targetId);
            const targetName = targetPlayer ? targetPlayer.name : "不明なプレイヤー";

            await interaction.message.edit({ components: [] });
            await interaction.reply({ content: '📢 公表しました。', ephemeral: true });
            
            if (game.channel) {
                const medEmbed = new EmbedBuilder()
                    .setTitle('👻 霊能結果')
                    .setDescription(`**${interaction.user.username}**: 「${targetName} は **【${executedRole}】** だ…」`)
                    .setColor(0x3498DB);
                await game.channel.send({ embeds: [medEmbed] });
                
                game.chatLog.push({ id: interaction.user.id, name: interaction.user.username, content: `霊媒結果: ${targetName} は ${executedRole}`, day: game.dayCount });
                if (!game.evidence) game.evidence = [];
                game.evidence.push({ type: 'medium_co', day: game.dayCount, from: interaction.user.id, target: targetId, result: executedRole === '人狼', visible: true });
            }
            return;
        }

        // ▼▼ 'fakemedium_' のブロックを「結果を保存するだけ」の処理に変更 ▼▼
        if (interaction.customId.startsWith('fakemedium_')) {
            if (game.state !== 'playing') return interaction.reply({ content: '⚠️ 現在ゲームは進行していません。', ephemeral: true });
            const currentPlayer = game.players.find((p: Player) => p.id === interaction.user.id);
            
            if (!currentPlayer || !currentPlayer.alive || !['狂人', '狂信者', '人狼', '妖狐', 'テルテル', '妖術師'].includes(currentPlayer.role)) {
                await interaction.message.edit({ components: [] }).catch(e => console.error('Silent Error:', e.message));
                return interaction.reply({ content: '⚠️ 権限エラー：このボタンは過去の試合のものです。', ephemeral: true });
            }
            
            const alreadyDivining = game.actions?.some((a: any) => a.from === currentPlayer.id && a.type === 'divine') || 
                                    game.evidence?.some((e: any) => e.from === currentPlayer.id && e.type === 'divine');
            const alreadyCoroner = game.evidence?.some((e: any) => e.from === currentPlayer.id && e.type === 'coroner_co');

            if (alreadyDivining || alreadyCoroner) {
                await interaction.message.edit({ components: [] }).catch(e => console.error('Silent Error:', e.message));
                return interaction.reply({ content: '⚠️ 既に別の役職（占い師や検死官）として行動しているため、霊能者を騙ることはできません！', ephemeral: true });
            }

            const isBlack = interaction.customId.includes('_black_');
            const executedId = interaction.customId.replace('fakemedium_white_', '').replace('fakemedium_black_', '');
            
            // 発表せずに、アクションとして記録しておく（朝にまとめて発表するため）
            if (!game.actions) game.actions = [];
            game.actions = game.actions.filter((a: any) => !(a.type === 'fake_medium' && a.from === currentPlayer.id)); // 連打対策で上書き
            game.actions.push({ type: 'fake_medium', from: currentPlayer.id, target: executedId, result: isBlack });

            const reportedRole = isBlack ? '人狼🐺' : '人間👤';

            await interaction.message.edit({ components: [] });
            await interaction.reply({ content: `📢 偽の霊能結果を **【${reportedRole}】** に設定しました。（明日の朝、自動公表されます）`, ephemeral: true });
            return;
        }

        if (interaction.customId === 'coroner_publish') {
            if (game.state !== 'playing') return interaction.reply({ content: '⚠️ 現在ゲームは進行していません。', ephemeral: true });
            const currentPlayer = game.players.find((p: Player) => p.id === interaction.user.id);
            if (!currentPlayer || currentPlayer.role !== '検死官') return interaction.reply({ content: '⚠️ あなたは検死官ではありません。', ephemeral: true });

            await interaction.message.edit({ components: [] });
            await interaction.reply({ content: '📢 検死結果を公表しました。', ephemeral: true });
            
             if (game.channel && game.coronerReport) {
                const embed = new EmbedBuilder()
                    .setTitle('🔍 検死官の報告')
                    .setDescription(`**${currentPlayer.name}**: 「死者たちの本当の役職が判明した…！」\n\n${game.coronerReport}`)
                    .setColor(0x9B59B6);
                await game.channel.send({ embeds: [embed] });
                 if (!game.chatLog) game.chatLog = [];
                game.chatLog.push({ id: currentPlayer.id, name: currentPlayer.name, content: `検死結果公表`, day: game.dayCount });
                if (!game.evidence) game.evidence = [];
                game.evidence.push({ type: 'coroner_co', day: game.dayCount, from: currentPlayer.id, target: 'all', result: true, visible: true });
            }
            return;
        }

if (interaction.customId === 'fakecoroner_open_modal') {
            if (game.state !== 'playing') return interaction.reply({ content: '⚠️ 現在ゲームは進行していません。', ephemeral: true });
            
            const currentPlayer = game.players.find((p: Player) => p.id === interaction.user.id);
            if (!currentPlayer || !currentPlayer.alive || !['狂人', '狂信者', '人狼', '妖狐', 'テルテル', '妖術師'].includes(currentPlayer.role)) {
                await interaction.message.edit({ components: [] }).catch(e => console.error('Silent Error:', e.message));
                return interaction.reply({ content: '⚠️ 権限エラー：このボタンは過去の試合のものです。', ephemeral: true });
            }

            const alreadyDivining = game.actions?.some((a: any) => a.from === currentPlayer.id && a.type === 'divine') || 
                                    game.evidence?.some((e: any) => e.from === currentPlayer.id && e.type === 'divine');
            const alreadyMedium = game.evidence?.some((e: any) => e.from === currentPlayer.id && e.type === 'medium_co');

            if (alreadyDivining || alreadyMedium) {
                await interaction.message.edit({ components: [] }).catch(e => console.error('Silent Error:', e.message));
                return interaction.reply({ content: '⚠️ 既に別の役職（占い師や霊能者）として行動しているため、検死官を騙ることはできません！', ephemeral: true });
            }

            const deadPlayers = game.players.filter((p: Player) => !p.alive);
            if(deadPlayers.length === 0) return interaction.reply({ content: '死者がいません。', ephemeral: true });

            const modal = new ModalBuilder().setCustomId('fakecoroner_modal').setTitle('🔍 偽の検死レポート作成');
            const targets = deadPlayers.slice(0, 5); 

            targets.forEach((dead: any, i: number) => {
                const textInput = new TextInputBuilder()
                    .setCustomId(`fake_role_${i}`)
                    .setLabel(`${dead.name} の偽役職 (例: 村人, 占い師)`)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(textInput));
            });
            await interaction.showModal(modal);
            return;
        }

if (interaction.isModalSubmit() && interaction.customId === 'fakecoroner_modal') {
            if (game.state !== 'playing') return interaction.reply({ content: '⚠️ 現在ゲームは進行していません。', ephemeral: true });
            
            const currentPlayer = game.players.find((p: Player) => p.id === interaction.user.id);
            if (!currentPlayer || !currentPlayer.alive || !['狂人', '狂信者', '人狼', '妖狐', 'テルテル', '妖術師'].includes(currentPlayer.role)) {
                return interaction.reply({ content: '⚠️ 権限エラー：このアクションは現在実行できません。', ephemeral: true });
            }

            const deadPlayers = game.players.filter((p: Player) => !p.alive);
            const targets = deadPlayers.slice(0, 5);

            let fakeReport = "🔍 **検死レポート**\n昨晩の死者の正体は以下の通りです：\n";
            targets.forEach((dead: any, i: number) => {
                const inputRole = interaction.fields.getTextInputValue(`fake_role_${i}`);
                const safeRole = inputRole.replace(/[【】\[\]\s]/g, ''); 
                fakeReport += `▪ ${dead.name} ➔ **【${safeRole}】**\n`; 
            });

            await interaction.message.edit({ components: [] }).catch(e => console.error('Silent Error:', e.message));
            await interaction.reply({ content: '📢 指定した役職で、完璧な偽の検死結果を公表しました。', ephemeral: true });
            
            if (game.channel) {
                const embed = new EmbedBuilder()
                    .setTitle('🔍 検死官の報告')
                    .setDescription(`**${currentPlayer.name}**: 「死者たちの本当の役職が判明した…！」\n\n${fakeReport}`)
                    .setColor(0x9B59B6);
                await game.channel.send({ embeds: [embed] });
                if (!game.chatLog) game.chatLog = [];
                game.chatLog.push({ id: currentPlayer.id, name: currentPlayer.name, content: `検死結果公表`, day: game.dayCount });
                if (!game.evidence) game.evidence = [];
                game.evidence.push({ type: 'coroner_co', day: game.dayCount, from: currentPlayer.id, target: 'all', result: false, visible: true });
            }
            return;
        }

        if (interaction.customId === 'cupid_select') {
            const selectedIds = interaction.values;
            if (selectedIds.length !== 2) return interaction.reply({ content: '2人選んでください。', ephemeral: true });
            game.lovers = selectedIds; 

            const p1 = game.players.find((p: Player) => p.id === selectedIds[0]);
            const p2 = game.players.find((p: Player) => p.id === selectedIds[1]);

            if (!p1 || !p2) {
                return interaction.reply({ content: 'プレイヤーが見つかりませんでした。', ephemeral: true });
            }

            if(!p1.isNpc) p1.user?.send(`💘 恋人に選ばれました！相手: ${p2.name}`).catch(e => console.error('Silent Error:', e.message));
            if(!p2.isNpc) p2.user?.send(`💘 恋人に選ばれました！相手: ${p1.name}`).catch(e => console.error('Silent Error:', e.message));
            
            await interaction.update({ content: `💘 **カップル成立**: ${p1.name} と ${p2.name}`, components: [] });
            return;
        }

        if (game.state === 'recruiting') {
            const updatePublicLobby = async () => {
                if (game.lobbyMessage) await game.lobbyMessage.edit(await Messages.getLobbyPayload(game, game.hostId, interaction.member)).catch(e => console.error('Silent Error:', e.message));
            };

            const hostOnlyActions = [
                'open_settings', 'setting_roles', 'setting_wolves', 
                'setting_time', 'setting_advanced', 'setting_back', 
                'game_start', 'lobby_cancel', 'lobby_preset',
                'npc_add', 'npc_remove', 'setting_vote_transparency',
                'setting_tie_vote', 'setting_continuous_guard',
                'setting_first_night', 'setting_match_type'
            ];

            if (hostOnlyActions.includes(interaction.customId)) {
                if (interaction.user.id !== game.hostId) {
                    return interaction.reply({ 
                        content: `⚠️ **権限がありません！**\n設定変更やNPCの操作は、募集者（ホスト）のみが行えます。`, 
                        ephemeral: true 
                    });
                }
            }
            
            if (interaction.customId.startsWith('lobby_preset')) {
                const preset = interaction.values[0];
                let targetTotal = 0;

                if (preset.startsWith('load_preset_')) {
                    const presetName = preset.replace('load_preset_', '');
                    const userPresets = await DB.getPresets(interaction.user.id);
                    const targetPreset = userPresets.find(p => p.name === presetName);
                    if (targetPreset) {
                        game.settings = targetPreset.settings;
                        
                        const s = targetPreset.settings;
                        const roleCount = s.roles ? s.roles.length : 1;
                        const wolfCount = s.wolfMode === 'auto' ? 1 : (typeof s.wolfMode === 'number' ? s.wolfMode : 1);
                        const extraMasons = s.roles && s.roles.includes('freemason') ? 1 : 0;
                        
                        targetTotal = s.playerCount ?? (roleCount + extraMasons + wolfCount + 1);
                        if (targetTotal < 4) targetTotal = 4;
                    }
                } else if (preset === 'preset_standard') {
                    game.settings.roles = ['seer'];
                    game.settings.wolfMode = 'auto';
                    game.settings.continuousGuard = false;
                    game.settings.tieVoteHandling = 'random';
                    game.settings.voteTransparency = 'public';
                    game.settings.firstNightPeace = false;
                    game.settings.matchType = 'casual';
                    targetTotal = 0;
                } else if (preset === 'preset_ranked_5') {
                    game.settings.roles = ['seer', 'madman'];
                    game.settings.wolfMode = 1; 
                    game.settings.continuousGuard = false;
                    game.settings.tieVoteHandling = 'random';
                    game.settings.voteTransparency = 'public';
                    game.settings.firstNightPeace = true; // 競技ルール：初日襲撃なし
                    game.settings.matchType = 'ranked';
                    targetTotal = 5;
                } else if (preset === 'preset_ranked_7') {
                    game.settings.roles = ['seer', 'guard']; // 霊能なし
                    game.settings.wolfMode = 2; // 2狼
                    game.settings.continuousGuard = false;
                    game.settings.tieVoteHandling = 'random';
                    game.settings.voteTransparency = 'public';
                    game.settings.firstNightPeace = true;
                    game.settings.matchType = 'ranked';
                    targetTotal = 7;
                } else if (preset === 'preset_ranked_9') {
                    game.settings.roles = ['seer', 'medium', 'guard', 'madman'];
                    game.settings.wolfMode = 2; 
                    game.settings.continuousGuard = false;
                    game.settings.tieVoteHandling = 'random';
                    game.settings.voteTransparency = 'public';
                    game.settings.firstNightPeace = true;
                    game.settings.matchType = 'ranked';
                    targetTotal = 9;
                } else if (preset === 'preset_ranked_13') {
                    game.settings.roles = ['seer', 'medium', 'guard', 'madman', 'freemason'];
                    game.settings.wolfMode = 3; // 3狼
                    game.settings.continuousGuard = false;
                    game.settings.tieVoteHandling = 'random';
                    game.settings.voteTransparency = 'public';
                    game.settings.firstNightPeace = true;
                    game.settings.matchType = 'ranked';
                    targetTotal = 13;
                }

                const presetLabelMap: Record<string, string> = {
                    'preset_standard':     '【スタンダード】',
                    'preset_ranked_5':     '【5人村】狂人の騙り合い',
                    'preset_ranked_7':     '【7人村】2狼の脅威',
                    'preset_ranked_9':     '【9人村】ランクマッチ標準',
                    'preset_ranked_13':    '【13人村】共有者の導き',
                };

                (game as any).currentPresetName = presetLabelMap[preset] ?? null;

                if (targetTotal > 0) {
                    const currentHumans = game.players.filter((p: Player) => !p.isNpc).length;
                    game.npcCount = Math.max(0, targetTotal - currentHumans);
                }
                
                await interaction.update(await Messages.getLobbyPayload(game, game.hostId, interaction.member));
                return;
            }

            if (interaction.customId === 'lobby_cancel') {
                resetGame(interaction.channel.id, true);
                if (game.lobbyMessage) await game.lobbyMessage.delete().catch(e => console.error('Silent Error:', e.message));
                await interaction.reply({ content: '🚫 募集を中止しました。', ephemeral: false });
                return;
            }
            
            if (interaction.customId === 'join_leave') {
                const idx = game.players.findIndex((p: Player) => p.id === interaction.user.id);
                
                if (idx === -1) {
                    const existingGame = findGameByUserId(interaction.user.id);
                    if (existingGame && existingGame.channel?.id !== game.channel?.id) {
                        return interaction.reply({ 
                            content: `⚠️ あなたは既に別の村（<#${existingGame.channel?.id}>）に参加しています。\nあちらの村を退出するか、ゲームが終了してから参加してください。`, 
                            flags: ['Ephemeral'] 
                        });
                    }
                    if (game.players.length + game.npcCount >= 15) return interaction.reply({ content: '⚠️ 参加人数の上限に達しています。', flags: ['Ephemeral'] });

                    game.players.push({ id: interaction.user.id, user: interaction.user, name: interaction.user.username, isNpc: false, settings: undefined });
                } else {
                    game.players.splice(idx, 1);
                }
                
                await interaction.update(await Messages.getLobbyPayload(game, game.hostId, interaction.member));
                return;
            }

            if (interaction.customId.startsWith('tab_')) {
                game.settingsTab = interaction.customId.replace('tab_', '');
                const isPremium = await DB.isPremiumUser(interaction.user.id);
                await interaction.update({ components: Messages.getSettingsComponents(game.settings, game.settingsTab, isPremium) });
                return;
            }

            if (interaction.customId === 'setting_match_type') { 
                game.settings.matchType = interaction.values[0]; 
                
                if (game.settings.matchType === 'ranked') {
                    const banned = ['teruteru', 'cupid', 'cat', 'thief', 'sorcerer', 'baker', 'psycho', 'ninja', 'fox']; // ★修正: 禁止役職を追加
                    game.settings.roles = game.settings.roles.filter((r: string) => !banned.includes(r));
                    if (game.settings.roles.length === 0) game.settings.roles = ['seer'];
                }
                
                const isPremium = await DB.isPremiumUser(interaction.user.id);
                await interaction.update({ components: Messages.getSettingsComponents(game.settings, game.settingsTab, isPremium) }); 
                await updatePublicLobby(); 
                return; 
            }
            if (interaction.customId === 'setting_vote_transparency') { game.settings.voteTransparency = interaction.values[0]; const isPremium = await DB.isPremiumUser(interaction.user.id); await interaction.update({ components: Messages.getSettingsComponents(game.settings, game.settingsTab, isPremium) }); await updatePublicLobby(); return; }
            if (interaction.customId === 'setting_tie_vote') { game.settings.tieVoteHandling = interaction.values[0]; const isPremium = await DB.isPremiumUser(interaction.user.id); await interaction.update({ components: Messages.getSettingsComponents(game.settings, game.settingsTab, isPremium) }); await updatePublicLobby(); return; }
            if (interaction.customId === 'setting_continuous_guard') { game.settings.continuousGuard = interaction.values[0] === 'true'; const isPremium = await DB.isPremiumUser(interaction.user.id); await interaction.update({ components: Messages.getSettingsComponents(game.settings, game.settingsTab, isPremium) }); await updatePublicLobby(); return; }
            if (interaction.customId === 'setting_first_night') { game.settings.firstNightPeace = interaction.values[0] === 'true'; const isPremium = await DB.isPremiumUser(interaction.user.id); await interaction.update({ components: Messages.getSettingsComponents(game.settings, game.settingsTab, isPremium) }); await updatePublicLobby(); return; }

            if (interaction.customId === 'npc_add') { 
                if (game.players.length + game.npcCount >= 15) return interaction.reply({ content: '⚠️ 人数上限に達しています。', ephemeral: true });
                game.npcCount++; 
                await interaction.update(await Messages.getLobbyPayload(game, game.hostId, interaction.member)); 
                return; 
            }
            if (interaction.customId === 'npc_remove') { if (game.npcCount > 0) game.npcCount--; 
                await interaction.update(await Messages.getLobbyPayload(game, game.hostId, interaction.member)); 
                return; 
            }
            
            if (interaction.customId === 'open_settings') { 
                const isPremium = await DB.isPremiumUser(interaction.user.id);
                await interaction.reply({ content: '🛠️ **ゲーム設定メニュー**\n変更すると、自動で募集画面にも反映されます。', components: Messages.getSettingsComponents(game.settings, game.settingsTab || 'basic', isPremium), ephemeral: true }); 
                return; 
            }
            if (interaction.customId === 'setting_roles') { 
                game.settings.roles = interaction.values; 
                const isPremium = await DB.isPremiumUser(interaction.user.id);
                await interaction.update({ content: `🛠️ **ゲーム設定メニュー**\n✅ 役職を更新しました！`, components: Messages.getSettingsComponents(game.settings, game.settingsTab, isPremium) }); 
                await updatePublicLobby(); return; 
            }
            if (interaction.customId === 'setting_wolves') { 
                const val = interaction.values[0]; game.settings.wolfMode = val === 'auto' ? 'auto' : parseInt(val); 
                const isPremium = await DB.isPremiumUser(interaction.user.id);
                await interaction.update({ content: `🛠️ **ゲーム設定メニュー**\n✅ 人狼の数を更新しました！`, components: Messages.getSettingsComponents(game.settings, game.settingsTab, isPremium) }); 
                await updatePublicLobby(); return; 
            }
            if (interaction.customId === 'setting_time') { 
                game.settings.discussionTime = parseInt(interaction.values[0]); 
                const isPremium = await DB.isPremiumUser(interaction.user.id);
                await interaction.update({ content: `🛠️ **ゲーム設定メニュー**\n✅ 議論時間を更新しました！`, components: Messages.getSettingsComponents(game.settings, game.settingsTab, isPremium) }); 
                await updatePublicLobby(); return; 
            }
            if (interaction.customId === 'setting_advanced') { 
                const vals = interaction.values; game.settings.autoFinishVoting = vals.includes('autofinish'); game.settings.gayaMode = vals.includes('gaya'); game.settings.willMode = vals.includes('will'); game.settings.loquaciousMode = vals.includes('loquacious');
                const isPremium = await DB.isPremiumUser(interaction.user.id);
                await interaction.update({ content: `🛠️ **ゲーム設定メニュー**\n✅ 詳細ルールを更新しました！`, components: Messages.getSettingsComponents(game.settings, game.settingsTab, isPremium) }); 
                await updatePublicLobby(); return; 
            }
            
            if (interaction.customId === 'setting_back') {
                await interaction.update({ content: '✅ 設定を完了しました。(このメッセージは消去して構いません)', components: [] });
                return;
            }
            
            if (interaction.customId === 'game_start') {
                const total = game.players.length + game.npcCount;
                if (total < 4) return interaction.reply({ content: '⚠️ 人数不足です (最低4人)。', ephemeral: true });
                
                let wolfCount = game.settings.wolfMode === 'auto' ? (total >= 9 ? 3 : (total >= 6 ? 2 : 1)) : game.settings.wolfMode;
                if (wolfCount >= total / 2) wolfCount = Math.floor((total - 1) / 2) || 1;
                
                let requiredRolesCount = wolfCount;
                game.settings.roles.forEach((r: string) => {
                    // ▼▼ 修正: 饒舌な人狼を除外 ▼▼
                    if (r !== 'loquacious') {
                        requiredRolesCount += 1;
                        if (r === 'freemason') requiredRolesCount += 1;
                    }
                    // ▲▲ 修正 ▲▲
                });

                if (requiredRolesCount > total) {
                    return interaction.reply({ 
                        content: `⚠️ **設定エラー**\n役職の枠数（${requiredRolesCount}枠）が、現在の参加人数（${total}人）をオーバーしています。\n設定から役職を減らすか、参加者（またはNPC）を増やしてください。`, 
                        ephemeral: true 
                    });
                }

                const humanCount = game.players.filter((p: Player) => !p.isNpc).length;
                if (game.settings.matchType === 'ranked' && humanCount < 2) {
                    game.settings.matchType = 'casual';
                    (game as any).downgradeMessage = true;
                }

                game.state = 'playing';
                
                // 3秒ルール回避のために「待機」を送る
                await interaction.deferUpdate();
                await interaction.editReply({ content: '**🐺 ゲームを開始します...**', components: [], embeds: [] });
                
                // エラーで止まらないように catch をつける
                startGame(game, interaction).catch(e => console.error('startGameエラー:', e));
                return;
            }
        }
   } catch (error: any) {
        console.error('Interaction Error:', error);
        const errorMsg = `⚠️ **システム内部エラーが発生しました**: ${error.message}\n(再デプロイ等の影響の可能性があります)`;
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMsg, ephemeral: true }).catch(() => {});
        } else {
            await interaction.reply({ content: errorMsg, ephemeral: true }).catch(() => {});
        }
    }
}

async function startGame(game: GameState, interaction: any) {
    // スレッド作成処理を全削除し、元のチャンネルをそのまま使用します。

    const finalPlayers = [...game.players];
    for (let i = 0; i < game.npcCount; i++) {
        const personality = PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
        finalPlayers.push({
            id: `npc_${game.channel?.id}_${i}`, user: null, name: `🤖NPC${i + 1}`, isNpc: true, personality: personality,
            settings: undefined
        });
    }

    const streakPromises = finalPlayers.map(async p => { 
        if (p.isNpc) return null; 
        const s = await DB.getCurrentStreak(p.id); 
        if (s >= 2) {
            return `🔥 **${p.name}** は現在 **${s}連勝中** です！`;
        }
        return null;
    });
    const streakResults = await Promise.all(streakPromises);
    const validStreaks = streakResults.filter(res => res !== null);
    const streakAnnounce = validStreaks.length > 0 ? `\n${validStreaks.join('\n')}\n` : '';

    const total = finalPlayers.length;
    const rolesSource = Phases.decideRoles(game, total);

    const roleCounts: any = {};
    rolesSource.forEach((r: any) => { roleCounts[r] = (roleCounts[r] || 0) + 1; });
    const roleOrder = ['人狼', '狂信者', '狂人', '妖狐', '妖術師', 'テルテル', 'キューピッド', '猫又', '怪盗', '占い師', '霊能者', '騎士', 'パン屋', '共有者', '逃亡者', '検死官', '市長', 'タフガイ', '村人'];
    const roleBreakdown = Object.entries(roleCounts)
        .sort((a, b) => {
            const idxA = roleOrder.indexOf(a[0]);
            const idxB = roleOrder.indexOf(b[0]);
            if (idxA === -1) return 1; 
            if (idxB === -1) return -1;
            return idxA - idxB;
        })
        .map(([r, c]) => `${r}**${c}**`)
        .join(' / ');

    for (let i = rolesSource.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rolesSource[i], rolesSource[j]] = [rolesSource[j], rolesSource[i]]; }

    game.players = finalPlayers.map((p, i) => ({ 
        ...p, role: rolesSource[i], alive: true, isFakeSeer: false, knownWolf: null, isHiding: false, hideStrategy: false 
    }));
    Phases.setupSpecialRoles(game, total);

    if ((game as any).downgradeMessage) {
        await game.channel?.send('⚠️ **人数が足りないため、自動的に「練習試合」として開始します。**\n(ランクマッチには人間プレイヤーが最低2人必要です)');
        delete (game as any).downgradeMessage;
    }

    // ★ 全員にDMで役職を通知する処理
    game.players.forEach((p: Player) => {
        if (!p.isNpc) {
            let alliesNames: string[] = [];
            const isWolf = Roles.ROLE_CATALOG[p.role as string]?.isWolfCount;
            if (isWolf || p.role === '狂信者') {
                alliesNames = game.players
                    .filter((x: Player) => Roles.ROLE_CATALOG[x.role as string]?.isWolfCount && x.id !== p.id)
                    .map((x: Player) => x.name);
            }

            let partnerName = null;
            if (game.lovers && game.lovers.includes(p.id)) {
                const partnerId = game.lovers.find((l: string) => l !== p.id);
                const partner = game.players.find((pl: Player) => pl.id === partnerId);
                if (partner) partnerName = partner.name;
            }

            const roleEmbed = Messages.createRoleCard(p, alliesNames, partnerName);
            p.user?.send({ embeds: [roleEmbed] }).catch(e => console.error('DM Error:', e.message));
        }
    });

    const startText = `🌙 **ゲーム開始**\n参加: ${total}名\n📜 **内訳**: ${roleBreakdown}${streakAnnounce ? streakAnnounce : ''}`;

    await game.channel?.send({ content: startText });

    // ★ 人狼専用チャットの作成 (startGame 関数内)
    const wolfTeamIds = game.players
        .filter((p: Player) => !p.isNpc && (Roles.isActualWolf(p.role as string) || p.role === '分断者'))
        .map((p: Player) => p.id);

    if (wolfTeamIds.length > 0 && game.channel?.guild) {
        try {
            game.wolfChannel = await game.channel.guild.channels.create({
                name: '🐺人狼の隠れ家',
                type: ChannelType.GuildText,
                parent: game.channel.parentId, // 元の村と同じカテゴリに作成
                permissionOverwrites: [
                    { id: game.channel.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: game.channel.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    ...wolfTeamIds.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }))
                ]
            });
               await Messages.safeSend(game.wolfChannel, '🌑 **【秘匿通信回線：確立】**\nここは人狼と分断者のみがアクセスできる裏のチャンネルだ。死者は自動的に追放される。存分に陰謀を企てるがいい……。');
        } catch (e) {
            console.error("人狼チャット作成エラー:", e);
        }
    }

    Phases.startDayPhase(game);
}

export async function showStats(userId: string, interaction: any) { await DB.showStats(userId, interaction); }
